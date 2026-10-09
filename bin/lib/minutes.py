"""The `minutes` client: the office's issues and their comments, read over REST from a shared cache.

Issues stay the record (docs/office-engine-split.md, "State layer"). Readers go through this client instead of one `gh issue
list --json comments` per call, so a refresh costs a few conditional requests, not a GraphQL query per issue:
  - each open-issue list (one label, pull requests dropped) and each single issue is fetched with an ETag, so a 304 is free
  - ONE repo-wide `issues/comments?since=` feed brings in new and edited comments; `since` advances only after a full 200 read
  - an issue's comments are refetched whole when the cached count differs from the issue's count (a deletion shrinks it) and
    at least daily (the feed misses deletions)
  - on any failure the last good data is served, marked stale, never empty; the error text and retry-after are logged and
    `retry-after` (or the rate-limit reset) is honoured by not calling GitHub again until it passes
  - one sync at a time per cache (flock); a caller that waited finds the cache fresh and does not repeat it
Output is shaped like `gh issue list --json number,title,body,labels,url,comments` so callers do not change.
Transport is `gh api -i` (the user's own auth); tests inject a fake one.
"""
import fcntl, json, os, re, subprocess, sys, time
from datetime import datetime, timezone

LIST_LIMIT = 50            # what `gh issue list --limit 50` returned
DAILY = 24 * 3600
MIN_AGE = 10               # a sync this recent is reused by whoever waited on the lock
LOCK_WAIT = 20
ERROR_LOG_LINES = 200


class Response:
    def __init__(self, status, headers=None, body=""):
        self.status, self.headers, self.body = status, {k.lower(): v for k, v in (headers or {}).items()}, body


class GhTransport:
    """GET through `gh api -i`: returns a Response for any HTTP status, raises OSError when gh gave no HTTP response."""
    def __init__(self, gh="gh", timeout=60):
        self.gh, self.timeout = gh, timeout

    def __call__(self, path, etag=None):
        argv = [self.gh, "api", "-i", path]
        if etag:
            argv[3:3] = ["-H", f"If-None-Match: {etag}"]
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=self.timeout)
        except subprocess.TimeoutExpired:
            raise OSError(f"gh api timed out: {path}")
        head, _, body = r.stdout.replace("\r\n", "\n").partition("\n\n")
        lines = head.split("\n")
        m = re.match(r"HTTP/\S+\s+(\d+)", lines[0]) if lines else None
        if not m:
            raise OSError((r.stderr or r.stdout).strip()[:200] or f"gh api exit {r.returncode}")
        headers = {}
        for ln in lines[1:]:
            k, _, v = ln.partition(":")
            headers[k.strip()] = v.strip()
        return Response(int(m.group(1)), headers, body)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def issue_number(url):
    m = re.search(r"/issues/(\d+)", url or "")
    return int(m.group(1)) if m else None


class Minutes:
    def __init__(self, repo, cache_dir, transport=None, now=time.time, err=None):
        self.repo, self.dir, self.now = repo, cache_dir, now
        self.transport = transport or GhTransport()
        self.err = err or (lambda msg: print(msg, file=sys.stderr))
        self.path = os.path.join(cache_dir, "minutes-" + re.sub(r"[^A-Za-z0-9._-]", "_", repo) + ".json")
        self.stale = False
        self.c = self._load()

    # ---- cache ------------------------------------------------------------------------------
    def _load(self):
        try:
            with open(self.path) as f:
                c = json.load(f)
            if isinstance(c, dict):
                return c
        except (OSError, ValueError):
            pass
        return {}

    def _save(self):
        os.makedirs(self.dir, exist_ok=True)
        tmp = self.path + f".{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(self.c, f)
        os.replace(tmp, self.path)

    def _log_error(self, what, resp=None, exc=None):
        retry = resp.headers.get("retry-after") if resp else None
        text = (exc and str(exc)) or (resp and f"HTTP {resp.status} {resp.body.strip()[:150]}") or "unknown"
        msg = f"minutes: GitHub failed on {what}: {text}" + (f" (retry-after {retry}s)" if retry else "")
        self.err(msg)
        try:
            os.makedirs(self.dir, exist_ok=True)
            log = os.path.join(self.dir, "minutes-errors.log")
            lines = (open(log).read().splitlines() if os.path.exists(log) else [])[-(ERROR_LOG_LINES - 1):]
            open(log, "w").write("\n".join(lines + [f"{iso(self.now())} {msg}"]) + "\n")
        except OSError:
            pass

    def _block(self, resp):
        """Honour retry-after, or the rate-limit reset when the budget is spent."""
        wait = 0
        if resp is not None:
            ra = resp.headers.get("retry-after")
            if ra and ra.isdigit():
                wait = int(ra)
            elif resp.headers.get("x-ratelimit-remaining") == "0" and (resp.headers.get("x-ratelimit-reset") or "").isdigit():
                wait = max(0, int(resp.headers["x-ratelimit-reset"]) - int(self.now()))
            elif resp.status in (403, 429):
                wait = 60
        if wait:
            self.c["blocked_until"] = self.now() + wait

    # ---- requests ---------------------------------------------------------------------------
    def _get(self, path, etag=None, also=()):
        """Response for a 200 or 304 (or a status in `also`); None after logging any failure (and noting retry-after)."""
        try:
            r = self.transport(path, etag)
        except OSError as e:
            self._log_error(path.split("?")[0], exc=e)
            return None
        if r.status not in (200, 304) + tuple(also):
            self._log_error(path.split("?")[0], resp=r)
            self._block(r)
            return None
        return r

    def _pages(self, path, etag=None):
        """(first response, all items) following Link: rel=next; (None, None) on any failure. 304 gives (resp, None)."""
        r = self._get(path, etag)
        if r is None or r.status == 304:
            return r, None
        items = list(json.loads(r.body or "[]"))
        cur = r
        while True:
            m = re.search(r'<([^>]+)>;\s*rel="next"', cur.headers.get("link", ""))
            if not m:
                return r, items
            nxt = re.sub(r"^https://api\.github\.com", "", m.group(1))
            cur = self._get(nxt)
            if cur is None or cur.status != 200:
                return None, None
            items += list(json.loads(cur.body or "[]"))

    @staticmethod
    def _record(it):
        return {"number": it["number"], "title": it.get("title") or "", "url": it.get("html_url") or "",
                "labels": [{"name": l["name"] if isinstance(l, dict) else l} for l in it.get("labels") or []],
                "body": it.get("body") or "", "count": it.get("comments") or 0}

    @staticmethod
    def _comment(it):
        return {"id": it["id"], "body": it.get("body") or "", "url": it.get("html_url") or "",
                "createdAt": it.get("created_at") or "", "updatedAt": it.get("updated_at") or it.get("created_at") or ""}

    # ---- sync -------------------------------------------------------------------------------
    def age(self):
        """Seconds since the last good sync, or None if there has been none."""
        at = self.c.get("synced_at")
        return None if at is None else max(0, int(self.now() - at))

    def sync(self, labels=("initiative",), issues=(), force=False):
        """Bring the cache up to date for these open-issue lists and single issues. Never raises; on failure the cache is left
        as it was (plus whatever was merged), `stale` is set and the last good data keeps being served. `force` skips the
        10-second reuse of a very recent sync (not the wait for retry-after)."""
        os.makedirs(self.dir, exist_ok=True)
        with open(os.path.join(self.dir, "minutes.lock"), "w") as lk:
            deadline = time.time() + LOCK_WAIT
            while True:
                try:
                    fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.time() > deadline:
                        self.stale = True
                        self.c = self._load()
                        return
                    time.sleep(0.2)
            self.c = self._load()   # whoever held the lock may have just synced
            wanted = {"lists": sorted(labels), "issues": sorted(issues)}
            if not force and self.now() - self.c.get("synced_at", 0) < MIN_AGE and self.c.get("wanted") == wanted:
                return
            if self.now() < self.c.get("blocked_until", 0):
                self.stale = True
                self.err(f"minutes: waiting out retry-after, {int(self.c['blocked_until'] - self.now())}s left; serving cached data")
                return
            try:
                ok = self._sync(labels, issues)
            except (ValueError, KeyError, TypeError) as e:   # a malformed answer is a failure like any other
                self._log_error("sync", exc=e)
                ok = False
            self.stale = not ok
            if ok:
                self.c["synced_at"] = self.now()
                self.c["wanted"] = wanted
                self.c.pop("blocked_until", None)
            self._save()

    def _sync(self, labels, extra):
        t_start = self.now() - 1
        c = self.c
        recs, lists, comments = c.setdefault("issues", {}), c.setdefault("lists", {}), c.setdefault("comments", {})
        for label in labels:
            ent = lists.get(label) or {}
            # The ETag covers page 1 only, so it is trusted only while the list fits one page.
            etag = ent.get("etag") if ent and not ent.get("paged") else None
            r, items = self._pages(f"/repos/{self.repo}/issues?labels={label}&state=open&per_page=100", etag)
            if r is None:
                return False
            if r.status == 304:
                continue
            items = [it for it in items if "pull_request" not in it]
            nums = []
            for it in items[:LIST_LIMIT]:
                recs[str(it["number"])] = self._record(it)
                nums.append(it["number"])
            lists[label] = {"etag": r.headers.get("etag"), "numbers": nums, "paged": "next" in r.headers.get("link", "")}
            self._save()   # a cold start killed part way keeps what it fetched
        singles = c.setdefault("single_etags", {})
        for n in extra:
            r = self._get(f"/repos/{self.repo}/issues/{n}", singles.get(str(n)), also=(404, 410))
            if r is None:
                return False
            if r.status in (404, 410):   # deleted, transferred or no longer visible: forget it, the rest of the sync goes on
                self.err(f"minutes: issue #{n} is gone (HTTP {r.status}); dropped from the cache")
                for d in (recs, singles, comments, c.setdefault("full_at", {})):
                    d.pop(str(n), None)
                continue
            if r.status == 200:
                it = json.loads(r.body)
                if "pull_request" in it:
                    continue
                recs[str(n)] = self._record(it)
                singles[str(n)] = r.headers.get("etag")
        tracked = {str(n) for e in lists.values() for n in e.get("numbers", [])} | {str(n) for n in extra if str(n) in recs}
        # One repo-wide feed of new and edited comments. `since` moves only after every page was read.
        since = c.get("since")
        if since:
            etag = c.get("feed_etag") if c.get("feed_since") == since else None
            r, items = self._pages(f"/repos/{self.repo}/issues/comments?since={since}&per_page=100", etag)
            if r is None:
                return False
            if r.status == 200:
                newest = since
                for it in items:
                    n = str(issue_number(it.get("issue_url")))
                    if n in tracked:
                        lst = comments.setdefault(n, [])
                        new = self._comment(it)
                        for i, old in enumerate(lst):
                            if old["id"] == new["id"]:
                                lst[i] = new
                                break
                        else:
                            lst.append(new)
                    newest = max(newest, it.get("updated_at") or since)
                c["since"], c["feed_etag"], c["feed_since"] = newest, r.headers.get("etag"), since
        # Whole-issue refetch: nothing cached yet, the count disagrees (a delete shrinks it), or it is a day old.
        full = c.setdefault("full_at", {})
        for n in sorted(tracked):
            have = comments.get(n)
            if have is not None and len(have) == recs[n]["count"] and self.now() - full.get(n, 0) < DAILY:
                continue
            got = self._pages(f"/repos/{self.repo}/issues/{n}/comments?per_page=100")[1]
            if got is None:
                return False
            comments[n] = sorted((self._comment(x) for x in got), key=lambda x: (x["createdAt"], x["id"]))
            full[n] = self.now()
            self._save()
        if not since:
            c["since"] = iso(t_start)
        for n in [k for k in comments if k not in tracked]:   # closed or no longer listed
            del comments[n]
            full.pop(n, None)
        return True

    # ---- reads ------------------------------------------------------------------------------
    def _shape(self, n, keys):
        rec = self.c.get("issues", {}).get(str(n))
        if rec is None:
            return None
        cs = [{"body": x["body"], "url": x["url"], "createdAt": x["createdAt"]} for x in self.c.get("comments", {}).get(str(n), [])]
        full = {"number": rec["number"], "title": rec["title"], "body": rec["body"], "labels": rec["labels"], "url": rec["url"], "comments": cs}
        return {k: full[k] for k in keys}

    def issues(self, label, keys=("number", "title", "body", "labels", "url", "comments")):
        return [d for d in (self._shape(n, keys) for n in (self.c.get("lists", {}).get(label) or {}).get("numbers", [])) if d]

    def issue(self, n, keys=("number", "url", "comments")):
        return self._shape(n, keys)


# ---- self-test ---------------------------------------------------------------------------------
class FakeGitHub:
    """Just enough of the REST API: ETags, `since`, Link pages, failures and retry-after."""
    def __init__(self):
        self.issues, self.comments, self.calls, self.fail, self.etag_n = {}, [], [], None, 0
        self.version = 0

    def add_issue(self, n, labels=("initiative",), body="", title=None, pr=False):
        self.issues[n] = {"number": n, "title": title or f"T{n}", "body": body, "labels": [{"name": l} for l in labels],
                          "html_url": f"https://github.com/o/r/issues/{n}", "comments": 0}
        if pr:
            self.issues[n]["pull_request"] = {}
        self.version += 1

    def add_comment(self, n, body, cid, when):
        self.comments.append({"id": cid, "body": body, "html_url": f"https://github.com/o/r/issues/{n}#c{cid}", "created_at": when,
                              "updated_at": when, "issue_url": f"https://api.github.com/repos/o/r/issues/{n}"})
        self.issues[n]["comments"] += 1
        self.version += 1

    def delete_comment(self, cid):
        c = next(x for x in self.comments if x["id"] == cid)
        self.comments.remove(c)
        self.issues[issue_number(c["issue_url"])]["comments"] -= 1
        self.version += 1

    def __call__(self, path, etag=None):
        self.calls.append(path)
        if self.fail:
            raise OSError(self.fail) if self.fail == "down" else None
        tag = f'W/"{self.version}-{path.split("?")[0]}"'
        m = re.search(r"since=([^&]+)", path)
        if m:
            tag = f'W/"{self.version}-{m.group(1)}"'
        if etag == tag:
            return Response(304, {"etag": tag})
        if path.startswith("/repos/o/r/issues/comments"):
            since = m.group(1) if m else ""
            body = [x for x in self.comments if x["updated_at"] >= since]
        elif re.fullmatch(r"/repos/o/r/issues/\d+/comments\?per_page=100", path):
            n = int(path.split("/")[5])
            body = [x for x in self.comments if issue_number(x["issue_url"]) == n]
        elif re.fullmatch(r"/repos/o/r/issues/\d+", path):
            body = self.issues[int(path.rsplit("/", 1)[1])]
        else:
            lab = re.search(r"labels=([^&]+)", path).group(1)
            body = [i for i in sorted(self.issues.values(), key=lambda i: -i["number"]) if any(l["name"] == lab for l in i["labels"])]
        return Response(200, {"etag": tag}, json.dumps(body))


def self_test():
    import shutil, tempfile
    bad = []
    here = os.path.dirname(os.path.abspath(__file__))
    engine = os.path.dirname(os.path.dirname(here))
    t = tempfile.mkdtemp()
    try:
        clock = [1_000_000.0]
        errs = []
        gh = FakeGitHub()
        gh.add_issue(1, body="## Room\n- room: room-a\n")
        gh.add_issue(2, labels=("initiative", "blocked"))
        gh.add_issue(3, pr=True)                       # a pull request in the issue list: dropped
        gh.add_issue(4, labels=("refine",))
        for i, (n, who) in enumerate(((1, "one"), (1, "two"), (2, "three"))):
            gh.add_comment(n, f"PROGRESS: {who}", 10 + i, f"2026-10-0{i + 1}T00:00:00Z")

        def client():
            return Minutes("o/r", os.path.join(t, "cache"), gh, lambda: clock[0], errs.append)

        def snap(c):
            return [(i["number"], [x["body"] for x in i["comments"]], [l["name"] for l in i["labels"]]) for i in c.issues("initiative")]
        m = client()
        m.sync()
        eq = lambda label, got, want: bad.append(f"{label}: got {got!r}, want {want!r}") if got != want else None
        eq("first sync", snap(m), [(2, ["PROGRESS: three"], ["initiative", "blocked"]), (1, ["PROGRESS: one", "PROGRESS: two"], ["initiative"])])
        eq("pull requests dropped", [i["number"] for i in m.issues("initiative")], [2, 1])
        eq("shape matches gh issue list", sorted(m.issues("initiative")[0]), ["body", "comments", "labels", "number", "title", "url"])
        eq("comment shape", sorted(m.issues("initiative")[0]["comments"][0]), ["body", "createdAt", "url"])
        eq("role-issue shape", sorted(m.issue(1)), ["comments", "number", "url"])
        # nothing changed: the next sync is all 304s (after MIN_AGE)
        clock[0] += 60
        gh.calls.clear()
        client().sync()
        eq("a quiet refresh makes only conditional list and feed calls", sorted(set(p.split("?")[0] for p in gh.calls)),
           ["/repos/o/r/issues", "/repos/o/r/issues/comments"])
        eq("quiet refresh: no per-issue comment fetches", [p for p in gh.calls if re.search(r"/issues/\d+/comments", p)], [])
        # a new comment arrives through the feed alone
        clock[0] += 60
        gh.add_comment(2, "DONE: four", 20, "2026-10-05T00:00:00Z")
        gh.calls.clear()
        m = client()
        m.sync()
        eq("new comment via the feed", [x["body"] for x in m.issue(2)["comments"]], ["PROGRESS: three", "DONE: four"])
        eq("the feed, not a per-issue fetch, supplied it", [p for p in gh.calls if re.search(r"/issues/\d+/comments\?per_page", p)], [])
        # an edit replaces by id
        gh.comments[0]["body"] = "PROGRESS: one (edited)"
        gh.comments[0]["updated_at"] = "2026-10-06T00:00:00Z"
        gh.version += 1
        clock[0] += 60
        m = client()
        m.sync()
        eq("edited comment replaced", [x["body"] for x in m.issue(1)["comments"]], ["PROGRESS: one (edited)", "PROGRESS: two"])
        # a deletion is not in the feed: the count shrinking forces a whole-issue refetch
        gh.delete_comment(11)
        clock[0] += 60
        gh.calls.clear()
        m = client()
        m.sync()
        eq("deleted comment gone after the shrink refetch", [x["body"] for x in m.issue(1)["comments"]], ["PROGRESS: one (edited)"])
        eq("only the shrunk issue was refetched", [p for p in gh.calls if re.search(r"/issues/\d+/comments\?per_page", p)], ["/repos/o/r/issues/1/comments?per_page=100"])
        # daily refetch
        clock[0] += 25 * 3600
        gh.calls.clear()
        client().sync()
        eq("daily refetch of every issue", sorted(p for p in gh.calls if re.search(r"/issues/\d+/comments\?per_page", p)),
           ["/repos/o/r/issues/1/comments?per_page=100", "/repos/o/r/issues/2/comments?per_page=100"])
        # single issues and other labels
        clock[0] += 60
        m = client()
        m.sync(labels=("initiative", "refine"), issues=(4,))
        eq("other label list", [i["number"] for i in m.issues("refine", ("number",))], [4])
        eq("single issue", m.issue(4)["number"], 4)
        # a single issue that returns 404 is dropped and the sync still runs the feed and advances
        gh.add_issue(9, labels=("blocked",))
        clock[0] += 60
        m = client()
        m.sync(labels=("initiative", "refine"), issues=(4, 9))
        eq("issue 9 cached before it vanishes", m.issue(9) is not None, True)
        del gh.issues[9]
        gh.add_comment(2, "DONE: after 404", 30, "2026-10-07T00:00:00Z")
        base = gh.__call__

        def gone(path, etag=None):
            if path == "/repos/o/r/issues/9":
                gh.calls.append(path)
                return Response(404, {}, '{"message":"Not Found"}')
            return base(path, etag)
        clock[0] += 60
        errs.clear()
        m = Minutes("o/r", os.path.join(t, "cache"), gone, lambda: clock[0], errs.append)
        before = m.c.get("synced_at"), m.c.get("since")
        m.sync(labels=("initiative", "refine"), issues=(4, 9))
        eq("404 on a single issue: not stale, issue dropped", (m.stale, m.issue(9)), (False, None))
        eq("404 on a single issue: the feed still ran", [x["body"] for x in m.issue(2)["comments"]][-1], "DONE: after 404")
        eq("404 on a single issue: since and synced_at advanced", (m.c["synced_at"] > before[0], m.c["since"] > before[1]), (True, True))
        # failure: stale, never empty, error logged, retry-after honoured
        clock[0] += 60
        gh.fail = "down"
        errs.clear()
        m = client()
        m.sync(labels=("initiative", "refine"), issues=(4,))
        eq("stale on failure keeps the last good data", (m.stale, len(m.issues("initiative"))), (True, 2))
        eq("failure text logged", any("down" in e for e in errs), True)

        class Limited(FakeGitHub):
            pass
        calls_before = len(gh.calls)
        gh.fail = None
        orig = gh.__call__

        def throttle(path, etag=None):
            gh.calls.append(path)
            return Response(429, {"retry-after": "120"}, "slow down")
        m = Minutes("o/r", os.path.join(t, "cache"), throttle, lambda: clock[0], errs.append)
        clock[0] += 60
        errs.clear()
        m.sync(labels=("initiative", "refine"), issues=(4,))
        eq("429 logs the text and retry-after", any("slow down" in e and "retry-after 120" in e for e in errs), True)
        eq("429 serves stale data", (m.stale, len(m.issues("initiative"))), (True, 2))
        n_calls = len(gh.calls)
        clock[0] += 30
        m = Minutes("o/r", os.path.join(t, "cache"), throttle, lambda: clock[0], errs.append)
        m.sync(labels=("initiative", "refine"), issues=(4,))
        eq("no call inside retry-after", len(gh.calls), n_calls)
        clock[0] += 200
        m = client()
        m.sync(labels=("initiative", "refine"), issues=(4,))
        eq("recovers after retry-after", (m.stale, len(m.issues("initiative"))), (False, 2))
        # a cold start killed after the first issue keeps its progress
        class Killed(Exception):
            pass
        n_fetch = [0]

        def dying(path, etag=None):
            if re.search(r"/issues/\d+/comments\?per_page", path):
                n_fetch[0] += 1
                if n_fetch[0] == 2:
                    raise Killed()
            return gh(path, etag)
        k = Minutes("o/r", os.path.join(t, "killed"), dying, lambda: clock[0], errs.append)
        try:
            k.sync()
        except Killed:
            pass
        left = Minutes("o/r", os.path.join(t, "killed"), gh, lambda: clock[0], errs.append)
        eq("a killed cold start left its lists and first comments cached", (len(left.c.get("issues", {})) >= 2, len(left.c.get("comments", {}))), (True, 1))
        # a failed first read leaves nothing to serve, but does not raise
        e2 = Minutes("o/r", os.path.join(t, "empty"), lambda p, e=None: (_ for _ in ()).throw(OSError("offline")), lambda: clock[0], errs.append)
        e2.sync()
        eq("no cache and gh down: empty, stale, no crash", (e2.issues("initiative"), e2.stale), ([], True))
        # force bypasses the recent-sync reuse; age counts from the last good sync
        gh.calls.clear()
        f = client()
        f.sync(labels=("initiative", "refine"), issues=(4,), force=True)
        eq("force syncs again right away", len(gh.calls) > 0, True)
        eq("age counts from the last good sync", (f.age(), Minutes("o/r", os.path.join(t, "nothing"), gh, lambda: clock[0]).age()), (0, None))
        # single flight: a second client started while the lock is held waits, then reuses the fresh sync
        # (covered structurally: sync() re-reads the cache after taking the lock and honours MIN_AGE)
        gh.calls.clear()
        a, b = client(), client()
        a.sync(labels=("initiative", "refine"), issues=(4,))
        n1 = len(gh.calls)
        b.sync(labels=("initiative", "refine"), issues=(4,))
        eq("a sync right after another is reused", len(gh.calls), n1)
        # the transport parses `gh api -i` output
        stub = os.path.join(t, "gh")
        open(stub, "w").write('#!/bin/sh\nprintf \'HTTP/2.0 304 Not Modified\\r\\nEtag: W/"x"\\r\\nRetry-After: 7\\r\\n\\r\\n\'\nexit 1\n')
        os.chmod(stub, 0o755)
        r = GhTransport(stub)("/x", 'W/"x"')
        eq("gh api -i 304", (r.status, r.headers.get("retry-after")), (304, "7"))
        open(stub, "w").write("#!/bin/sh\necho 'gh: not logged in' >&2\nexit 4\n")
        try:
            GhTransport(stub)("/x")
            bad.append("gh with no HTTP response must raise")
        except OSError as e:
            eq("gh failure text", "not logged in" in str(e), True)
        # the fixture issues, served through REST, come back identical to what bin/rooms was given
        fx = json.load(open(os.path.join(engine, "fixtures", "rooms", "issues.json")))
        g2 = FakeGitHub()
        cid = 100
        for it in fx:
            g2.add_issue(it["number"], labels=[l["name"] for l in it["labels"]], body=it["body"], title=it["title"])
            g2.issues[it["number"]]["html_url"] = it["url"]
            for c in it["comments"]:
                cid += 1
                g2.add_comment(it["number"], c["body"], cid, c["createdAt"])
                g2.comments[-1]["html_url"] = c["url"]
        m = Minutes("o/r", os.path.join(t, "fx"), g2, lambda: clock[0], errs.append)
        m.sync(labels=(), issues=[it["number"] for it in fx])
        for it in fx:
            want = {k: it[k] for k in ("number", "title", "body", "labels", "url")}
            want["comments"] = [{k: c[k] for k in ("body", "url", "createdAt")} for c in it["comments"]]
            eq(f"fixture issue #{it['number']} identical through REST", m.issue(it["number"], tuple(want)), want)
    finally:
        shutil.rmtree(t, ignore_errors=True)
    if bad:
        print("minutes self-test: FAILED: " + "; ".join(bad))
        return 1
    print("minutes self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
