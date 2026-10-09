"""Finding and ending a room's Claude session by its process, not only by `claude stop`.

`claude stop <room>` can report "No job matching" for a session that is still running, and sessions of rooms that already closed come
back after the background daemon restarts. So the room's process is matched by its own command line: the claude binary with
`-n <room>` (the exact name, never a prefix, so another room is never touched), sent SIGTERM, waited for, and SIGKILLed only if it
ignores TERM past the grace period. A live background session runs as `claude bg-spare --bg-spare <sock>` with no `-n`, so the
name is resolved first through `claude agents --json` (each background session lists its pid); the `-n <name>` command-line match
is the fallback for other shapes. A name the agents list knows but whose process cannot be ended is a FAILURE; only a name that is
neither listed nor running is "already gone". $BUSYBODY_AGENTS_JSON (a file of that JSON) replaces `claude agents --json`;
$BUSYBODY_PS_FILE (JSON lines {"pid": N, "argv": [...]}) replaces /proc as the process table
and $BUSYBODY_NO_SIGNAL=1 makes signals no-ops that are only reported (test hooks).
"""
import json, os, re, shlex, signal, subprocess, sys, time

NAME_RE = re.compile(r"^(room|role)-[A-Za-z0-9._-]+$")


def processes():
    """[(pid, argv)] of every process."""
    ps = os.environ.get("BUSYBODY_PS_FILE")
    if ps:
        out = []
        for line in open(ps):
            line = line.strip()
            if line:
                d = json.loads(line)
                out.append((int(d["pid"]), list(d["argv"])))
        return out
    out = []
    for p in os.listdir("/proc"):
        if p.isdigit():
            try:
                argv = [a.decode(errors="replace") for a in open(f"/proc/{p}/cmdline", "rb").read().split(b"\0") if a]
            except OSError:
                continue
            if argv:
                out.append((int(p), argv))
    return out


def agents_list(timeout=5.0):
    """`claude agents --json` as a list of {name, pid, cwd, startedAt, state, ...}; [] when unavailable."""
    f = os.environ.get("BUSYBODY_AGENTS_JSON")
    try:
        if f:
            d = json.load(open(f))
        else:
            r = subprocess.run(shlex.split(os.environ.get("BUSYBODY_CLAUDE") or "claude") + ["agents", "--json"], capture_output=True, text=True, timeout=timeout)
            d = json.loads(r.stdout) if r.returncode == 0 else []
    except (OSError, ValueError, subprocess.SubprocessError):
        return []
    return [a for a in d if isinstance(a, dict)] if isinstance(d, list) else []


def agents_pid_map(cache_dir=None, ttl=60, timeout=1.0):
    """{pid: name} for every listed session with a pid. Cached briefly in <cache_dir>/agents-map.json and never slower than `timeout`."""
    path = os.path.join(cache_dir, "agents-map.json") if cache_dir else None
    try:
        if path:
            c = json.load(open(path))
            if time.time() - c["at"] < ttl:
                return {int(k): v for k, v in c["map"].items()}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    m = {int(a["pid"]): a.get("name") or "" for a in agents_list(timeout) if isinstance(a.get("pid"), int)}
    if path:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            json.dump({"at": time.time(), "map": {str(k): v for k, v in m.items()}}, open(path + ".tmp", "w"))
            os.replace(path + ".tmp", path)
        except OSError:
            pass
    return m


def is_claude(argv):
    return os.path.basename(argv[0]) == "claude" or (len(argv) > 1 and os.path.basename(argv[0]) in ("node", "bun") and os.path.basename(argv[1]) == "claude")


def names_session(argv, name):
    """True when the claude command line carries `-n <name>` (or --name <name> / --name=<name>) with exactly this name."""
    for i, a in enumerate(argv):
        if a in ("-n", "--name") and i + 1 < len(argv) and argv[i + 1] == name:
            return True
        if a == f"--name={name}":
            return True
    return False


def ancestors():
    me = {os.getpid()}
    pid = os.getppid()
    for _ in range(20):
        if pid <= 1:
            break
        me.add(pid)
        try:
            pid = int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return me


def find(name, table=None, agents=None):
    """(pids, listed): the claude processes running the session `name` (never this process or its ancestors), and whether
    `claude agents --json` lists the name. A listed pid counts only if its command line is a claude process; the `-n <name>` match
    on the process table is the fallback for sessions the agents list does not carry."""
    if not NAME_RE.match(name or ""):
        raise ValueError(f"not a room or role session name: {name!r}")
    table = table if table is not None else processes()
    argv_of = dict(table)
    me = ancestors()
    agents = agents if agents is not None else agents_list()
    entries = [a for a in agents if a.get("name") == name]
    pids = {a["pid"] for a in entries if isinstance(a.get("pid"), int) and a["pid"] in argv_of and is_claude(argv_of[a["pid"]])}
    pids |= {p for p, argv in table if is_claude(argv) and names_session(argv, name)}
    return sorted(pids - me), bool(entries)


def alive(pid, table=None):
    if table is not None:
        return any(p == pid for p, _ in table())
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        return open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[0] != "Z"   # a zombie is gone for our purposes
    except OSError:
        return False


def end(name, grace=10.0, poll=0.2, table_fn=None, send=None, agents=None):
    """End the session's process(es). Returns (ok, lines): ok when none is left; lines say what happened (including a SIGKILL).
    Listed by `claude agents --json` but nothing to end is a failure; only a name that is not listed and has no process is gone."""
    send = send or (lambda pid, sig: None if os.environ.get("BUSYBODY_NO_SIGNAL") == "1" else os.kill(pid, sig))
    pids, listed = find(name, table_fn() if table_fn else None, agents)
    if not pids:
        if listed:
            return False, [f"{name}: listed by `claude agents` but no claude process could be matched to end (its pid is missing, gone or not a claude process)"]
        return True, [f"{name}: not listed and no process found (already gone)"]
    lines = []
    for pid in pids:
        try:
            send(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            return False, lines + [f"{name}: not allowed to signal pid {pid}"]
    deadline = time.time() + grace
    left = list(pids)
    while left and time.time() < deadline:
        left = [p for p in left if alive(p, table_fn)]
        if left:
            time.sleep(poll)
    if not left:
        return True, lines + [f"{name}: ended pid {', '.join(map(str, pids))} (SIGTERM)"]
    for pid in left:
        try:
            send(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    time.sleep(min(1.0, poll * 5))
    left = [p for p in left if alive(p, table_fn)]
    lines.append(f"{name}: pid {', '.join(map(str, pids))} ignored SIGTERM for {grace:g}s, so SIGKILL was sent")
    if left:
        return False, lines + [f"{name}: still running after SIGKILL: pid {', '.join(map(str, left))}"]
    return True, lines


def self_test():
    import tempfile
    bad = []

    def eq(label, got, want):
        if got != want:
            bad.append(f"{label}: got {got!r}, want {want!r}")
    # the real shape: a background session is `claude bg-spare --bg-spare <sock>` (no -n); the agents list carries its pid
    table = [(10, ["claude", "bg-spare", "--bg-spare", "/tmp/cc-daemon-1000/x/spare/aa.claim.sock"]),
             (11, ["claude", "bg-spare", "--bg-spare", "/tmp/cc-daemon-1000/x/spare/bb.claim.sock"]),
             (12, ["claude", "bg-spare", "--bg-spare", "/tmp/cc-daemon-1000/x/spare/cc.claim.sock"]),
             (13, ["claude", "--bg", "-n", "room-d", "--model", "sonnet"]), (14, ["claude", "-n", "room-d-2"]),
             (15, ["vim", "bg-spare"]), (16, ["claude", "stop", "room-a"])]
    agents = [{"name": "room-a", "kind": "background", "pid": 10, "state": "done", "status": "idle"},
              {"name": "room-b", "kind": "background", "pid": 11, "state": "working", "status": "busy"},
              {"name": "room-c", "kind": "background", "pid": None, "state": "working"},
              {"name": "room-e", "kind": "background", "pid": 15, "state": "working"},
              {"name": "room-f", "kind": "background", "pid": 99, "state": "done"},
              {"name": "room-b-x", "kind": "background", "pid": 12, "state": "working"}]
    eq("the agents pid map finds a bg-spare process with no -n", find("room-a", table, agents), ([10], True))
    eq("exact names only: room-b is not room-b-x", (find("room-b", table, agents)[0], find("room-b-x", table, agents)[0]), ([11], [12]))
    eq("the -n match is the fallback for non-bg shapes, exact only", (find("room-d", table, [])[0], find("room-d-2", table, [])[0]), ([13], [14]))
    eq("listed but no pid, not claude, or a dead pid: no process, still listed", (find("room-c", table, agents), find("room-e", table, agents), find("room-f", table, agents)), (([], True), ([], True), ([], True)))
    eq("not listed, no process", find("room-zz", table, agents), ([], False))
    try:
        find("main", table, agents)
        bad.append("a non-session name must be refused")
    except ValueError:
        pass
    # end(): TERM then KILL for the one that ignores it, and the output says so
    state = {10: "up", 11: "up"}
    sent = []

    def send(pid, sig):
        sent.append((pid, sig))
        if sig == signal.SIGKILL or pid == 10:
            state[pid] = "gone"
    both = [{"name": "room-a", "pid": 10}, {"name": "room-a", "pid": 11}]
    ok, lines = end("room-a", grace=0.3, poll=0.05, table_fn=lambda: [(p, a) for p, a in table if state.get(p, "up") == "up"], send=send, agents=both)
    eq("TERM then KILL for the one that ignores it", (ok, (11, signal.SIGKILL) in sent, (10, signal.SIGKILL) in sent, any("SIGKILL was sent" in l for l in lines)), (True, True, False, True))
    eq("listed but nothing endable is a failure", end("room-c", table_fn=lambda: table, send=send, agents=agents)[0], False)
    eq("not listed and not running is gone (success)", end("room-zz", table_fn=lambda: table, send=send, agents=agents)[0], True)
    # the agents-pid map is cached briefly
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, "agents.json")
        json.dump([{"name": "room-a", "pid": 10}, {"name": "x", "pid": None}], open(f, "w"))
        os.environ["BUSYBODY_AGENTS_JSON"] = f
        eq("agents pid map", agents_pid_map(d), {10: "room-a"})
        json.dump([], open(f, "w"))
        eq("cached inside the TTL", agents_pid_map(d), {10: "room-a"})
        eq("a fresh read after the TTL", agents_pid_map(d, ttl=0), {})
        os.environ.pop("BUSYBODY_AGENTS_JSON")
        # real processes in the real shape: argv0 claude, subcommand bg-spare, no -n; found through the agents list, ended with TERM
        mine = subprocess.Popen(["bash", "-c", "exec -a claude bash -c 'sleep 60; :' bg-spare --bg-spare /tmp/x.sock"])
        other = subprocess.Popen(["bash", "-c", "exec -a claude bash -c 'sleep 60; :' bg-spare --bg-spare /tmp/y.sock"])
        time.sleep(0.5)
        live = [{"name": "room-real", "pid": mine.pid}, {"name": "room-other", "pid": other.pid}]
        ok, lines = end("room-real", grace=5, poll=0.1, agents=live)
        mine.wait(timeout=5)
        eq("a real bg-spare session is ended by its agents pid; another is untouched", (ok, mine.poll() is not None, other.poll() is None), (True, True, True))
        other.terminate()
        other.wait()
    if bad:
        print("sessions self-test: FAILED: " + "; ".join(bad))
        return 1
    print("sessions self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
