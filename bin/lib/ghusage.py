"""The gh usage log: one JSON line per gh call, written by bin/gh-wrapper, read by `busybody gh-usage` and by bin/rooms.

Lives in <workspace>/.cache/gh-usage/YYYY-MM-DD.jsonl: local only, never committed, 7 days kept. Lines hold the command
line (values after body/field/input/header flags and token-looking arguments redacted), never the output.
"""
import datetime, glob, json, os, re, sys

KEEP_DAYS = 7
LIMIT = 5000   # GraphQL points per hour
VALUE_FLAGS = {"--body", "-b", "--body-file", "-F", "-f", "--field", "--raw-field", "--input", "-H", "--header", "--token",
               "--notes", "-n", "--title", "-t", "--subject", "--description", "-m", "--message"}
TOKEN_RE = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|(?i:bearer)\s+\S+|[A-Za-z0-9_\-]{40,})")
GRAPHQL_CMDS = {"pr", "issue", "repo", "project", "search", "status"}


def redact(argv):
    out, skip = [], False
    for a in argv:
        if skip:
            out.append("<redacted>")
            skip = False
            continue
        flag, eq, _val = a.partition("=")
        if a in VALUE_FLAGS:
            out.append(a)
            skip = True
        elif eq and flag in VALUE_FLAGS:
            out.append(flag + "=<redacted>")
        elif re.match(r"^-[bfFHntm].+", a) and a[:2] in VALUE_FLAGS and not a.startswith("--"):   # -fkey=value
            out.append(a[:2] + "<redacted>")
        else:
            out.append(TOKEN_RE.sub("<token>", a))
    return out


def classify(argv):
    """'graphql' or 'rest' (best effort from the command: gh api graphql, or a command family that uses GraphQL)."""
    pos = [a for a in argv if not a.startswith("-")]
    if not pos:
        return "rest"
    if pos[0] == "api":
        return "graphql" if len(pos) > 1 and pos[1] == "graphql" else "rest"
    return "graphql" if pos[0] in GRAPHQL_CMDS else "rest"


def est_points(argv, kind):
    """A rough GraphQL cost: 1 per call, one more per started 100 items asked for with -L/--limit. A floor, not what GitHub charged."""
    if kind != "graphql":
        return 0
    n = 1
    for i, a in enumerate(argv):
        v = argv[i + 1] if a in ("-L", "--limit") and i + 1 < len(argv) else (a.split("=", 1)[1] if a.startswith("--limit=") else None)
        if v and v.isdigit():
            n += max(0, (int(v) - 1) // 100)
    return n


def log_dir(cache_dir):
    return os.path.join(cache_dir, "gh-usage")


def prune(cache_dir, today=None, keep=KEEP_DAYS):
    today = today or datetime.date.today()
    for f in glob.glob(os.path.join(log_dir(cache_dir), "*.jsonl")):
        try:
            d = datetime.date.fromisoformat(os.path.basename(f)[:-6])
        except ValueError:
            continue
        if (today - d).days >= keep:
            try:
                os.remove(f)
            except OSError:
                pass


def append(cache_dir, rec, now=None):
    now = now or datetime.datetime.now()
    d = log_dir(cache_dir)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, now.date().isoformat() + ".jsonl")
    new = not os.path.exists(path)
    with open(path, "a") as f:
        f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    if new:
        prune(cache_dir, now.date())


def read(cache_dir, since_ts):
    """Records at or after `since_ts` (epoch seconds), oldest first."""
    out = []
    for f in sorted(glob.glob(os.path.join(log_dir(cache_dir), "*.jsonl"))):
        try:
            for line in open(f):
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if isinstance(r, dict) and r.get("ts", 0) >= since_ts:
                    out.append(r)
        except OSError:
            pass
    return out


def hour_graphql_points(cache_dir, now_ts):
    """Estimated GraphQL points in the last hour, read from the log (no gh call)."""
    return sum(r.get("points", 0) for r in read(cache_dir, now_ts - 3600))


def parse_since(text):
    m = re.fullmatch(r"(\d+)\s*([smhd])", (text or "1h").strip())
    if not m:
        raise ValueError(f"--since wants a number and s, m, h or d, like 1h (got {text!r})")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def summarise(recs, top=5):
    """The report as a dict: totals, GraphQL vs REST, failures, retries (the same argv again within 60 s after a failure), top callers."""
    tot = {"calls": len(recs), "graphql": 0, "rest": 0, "points_est": 0, "failures": 0, "retries": 0, "not_modified": 0, "ms": 0}
    by = {"session": {}, "script": {}}
    last_fail = {}
    for r in recs:
        k = r.get("kind", "rest")
        tot[k] = tot.get(k, 0) + 1
        tot["points_est"] += r.get("points", 0)
        tot["ms"] += r.get("ms", 0)
        tot["not_modified"] += 1 if r.get("not_modified") else 0
        key = " ".join(r.get("argv", []))
        if r.get("exit", 0) != 0:
            tot["failures"] += 1
            last_fail[key] = r.get("ts", 0)
        elif key in last_fail and r.get("ts", 0) - last_fail[key] <= 60:
            tot["retries"] += 1
        for dim, name in (("session", r.get("session") or "(none)"), ("script", r.get("script") or "(none)")):
            e = by[dim].setdefault(name, {"calls": 0, "graphql": 0, "points_est": 0})
            e["calls"] += 1
            e["graphql"] += 1 if k == "graphql" else 0
            e["points_est"] += r.get("points", 0)
    ranked = {dim: sorted(v.items(), key=lambda kv: (-kv[1]["points_est"], -kv[1]["calls"], kv[0]))[:top] for dim, v in by.items()}
    return {"totals": tot, "top": ranked}


def self_test():
    bad = []

    def eq(label, got, want):
        if got != want:
            bad.append(f"{label}: got {got!r}, want {want!r}")
    eq("body value redacted", redact(["issue", "comment", "9", "--body", "secret text", "-R", "o/r"]), ["issue", "comment", "9", "--body", "<redacted>", "-R", "o/r"])
    eq("-f and --field=", redact(["api", "x", "-f", "a=b", "--field=c=d", "-fe=f"]), ["api", "x", "-f", "<redacted>", "--field=<redacted>", "-f<redacted>"])
    eq("a token-looking arg", redact(["auth", "login", "ghp_" + "a" * 30]), ["auth", "login", "<token>"])
    eq("notes, title, subject, description and message values", redact(["release", "create", "v1", "--notes", "n1", "-t", "T", "--title=T2", "--subject", "s", "--description", "d", "-m", "msg", "--message=m2", "-nX"]),
       ["release", "create", "v1", "--notes", "<redacted>", "-t", "<redacted>", "--title=<redacted>", "--subject", "<redacted>", "--description", "<redacted>", "-m", "<redacted>", "--message=<redacted>", "-n<redacted>"])
    eq("header values", redact(["api", "-H", "Authorization: x", "u"]), ["api", "-H", "<redacted>", "u"])
    eq("kinds", [classify(a) for a in (["api", "graphql", "-f", "q=x"], ["api", "repos/o/r"], ["pr", "list"], ["run", "list"], ["--version"])], ["graphql", "rest", "graphql", "rest", "rest"])
    eq("points", [est_points(["pr", "list", "-L", "250"], "graphql"), est_points(["pr", "view", "1"], "graphql"), est_points(["run", "list"], "rest")], [3, 1, 0])
    eq("since", (parse_since("90m"), parse_since("2h")), (5400, 7200))
    recs = [{"ts": 1, "kind": "graphql", "points": 1, "session": "room-a", "script": "rooms", "argv": ["pr", "list"], "exit": 1, "ms": 5},
            {"ts": 10, "kind": "graphql", "points": 1, "session": "room-a", "script": "rooms", "argv": ["pr", "list"], "exit": 0, "ms": 5},
            {"ts": 11, "kind": "rest", "points": 0, "session": "room-b", "script": "status", "argv": ["api", "x"], "exit": 0, "ms": 5, "not_modified": True}]
    s = summarise(recs)
    eq("summary", (s["totals"]["graphql"], s["totals"]["rest"], s["totals"]["failures"], s["totals"]["retries"], s["totals"]["not_modified"], s["top"]["session"][0][0]), (2, 1, 1, 1, 1, "room-a"))
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        today = datetime.datetime(2026, 10, 20, 12, 0)
        for back in (0, 3, 7, 9):
            day = (today - datetime.timedelta(days=back)).date().isoformat()
            os.makedirs(log_dir(d), exist_ok=True)
            open(os.path.join(log_dir(d), day + ".jsonl"), "w").write(json.dumps({"ts": 5, "points": 1}) + "\n")
        append(d, {"ts": 9, "points": 2}, now=today + datetime.timedelta(days=1))   # a new day's file: older ones go
        left = sorted(os.path.basename(f)[:-6] for f in glob.glob(os.path.join(log_dir(d), "*.jsonl")))
        eq("files 7 or more days old are pruned when a new day starts", left, ["2026-10-17", "2026-10-20", "2026-10-21"])
    if bad:
        print("ghusage self-test: FAILED: " + "; ".join(bad))
        return 1
    print("ghusage self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
