"""The PR for a room's branch, looked up at most once per TTL per branch and shared through .cache/room-prs.json.

Used by bin/rooms (every room, behind its shared document cache) and bin/room-cost --enforce, so no viewer or timer asks GitHub itself.
A failed lookup is remembered like a result (the last known PR, or none, with a new time), so an outage is not retried every refresh.
A repo with no `origin` remote is skipped without any gh call. $BUSYBODY_GH names the gh command (a test hook).
"""
import json, os, shlex, subprocess, sys, tempfile, time

TTL = 600
FILE = "room-prs.json"


def _gh_argv():
    return shlex.split(os.environ.get("BUSYBODY_GH") or "gh")


def has_github_remote(repo_dir):
    try:
        r = subprocess.run(["git", "-C", repo_dir, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0 and "github.com" in r.stdout


def _read(path):
    try:
        d = json.load(open(path))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def lookup(repo_dir, github, branch, cache_dir, now=None, ttl=TTL, deadline=None):
    """(pr, checked_at, stale) for the branch's newest PR. `pr` is {'number','url','state','isDraft','updatedAt'} or None.
    `checked_at` is the last SUCCESSFUL check (epoch seconds, None if never); `stale` is True when the latest attempt failed or was
    skipped for want of time, so the PR shown is the last known one. `deadline` (epoch) stops new gh calls once passed."""
    import fcntl
    now = now or time.time()
    path = os.path.join(cache_dir, FILE)
    key = f"{github}#{branch}"
    seen = _read(path).get(key)
    if isinstance(seen, dict) and now - seen.get("at", 0) < ttl:
        return seen.get("pr"), seen.get("ok_at"), bool(seen.get("stale"))
    old = seen if isinstance(seen, dict) else {}
    pr, ok_at, stale = old.get("pr"), old.get("ok_at"), True
    if deadline is not None and time.time() >= deadline:
        return pr, ok_at, True   # out of time for this build: serve what is cached, marked stale, and ask again next time
    if not (branch and github and has_github_remote(repo_dir)):
        pr, ok_at, stale = None, now, False   # nothing to ask GitHub about: conclusive
    else:
        try:
            tmo = 30 if deadline is None else max(1, min(30, deadline - time.time()))
            r = subprocess.run(_gh_argv() + ["pr", "list", "-R", github, "--head", branch, "--state", "all",
                                             "--json", "number,url,state,isDraft,updatedAt", "--limit", "1"], capture_output=True, text=True, timeout=tmo)
            if r.returncode == 0:
                lst = json.loads(r.stdout)
                p = lst[0] if isinstance(lst, list) and lst and isinstance(lst[0], dict) else None
                pr = {"number": p["number"], "url": p["url"], "state": p.get("state", "OPEN"), "isDraft": p.get("isDraft") is True,
                      "updatedAt": p.get("updatedAt", "")} if p else None
                ok_at, stale = now, False
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
            pass   # remembered below as a failed attempt: the last known PR, stale
    try:
        os.makedirs(cache_dir, exist_ok=True)
        with open(os.path.join(cache_dir, FILE + ".lock"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)   # read-modify-write: another writer's entries are kept
            cache = _read(path)
            cache[key] = {"at": now, "ok_at": ok_at, "stale": stale, "pr": pr}
            tmp = path + f".{os.getpid()}"
            json.dump(cache, open(tmp, "w"))
            os.replace(tmp, path)
    except OSError:
        pass
    return pr, ok_at, stale


def self_test():
    bad = []
    with tempfile.TemporaryDirectory() as d:
        repo, cache = os.path.join(d, "r"), os.path.join(d, "cache")
        os.makedirs(repo)
        git = lambda *a: subprocess.run(["git", "-C", repo] + list(a), check=True, capture_output=True)
        git("init", "-q", "-b", "main")
        log = os.path.join(d, "gh.log")
        stub = os.path.join(d, "gh")
        open(stub, "w").write('#!/bin/sh\necho "$*" >> "%s"\n[ -f "%s" ] && exit 1\n'
                              'echo \'[{"number":7,"url":"https://github.com/acme-co/web/pull/7","state":"OPEN","isDraft":true}]\'\n' % (log, os.path.join(d, "down")))
        os.chmod(stub, 0o755)
        os.environ["BUSYBODY_GH"] = stub
        calls = lambda: len(open(log).read().splitlines()) if os.path.exists(log) else 0

        def eq(label, got, want):
            if got != want:
                bad.append(f"{label}: got {got!r}, want {want!r}")
        eq("no origin remote: no gh call, no PR, conclusive", (lookup(repo, "acme-co/web", "b", cache, now=1000), calls()), ((None, 1000, False), 0))
        git("remote", "add", "origin", "https://github.com/acme-co/web.git")
        eq("first lookup asks once", (lookup(repo, "acme-co/web", "b2", cache, now=1000)[0]["number"], calls()), (7, 1))
        eq("inside the TTL the cache answers", (lookup(repo, "acme-co/web", "b2", cache, now=1500)[0]["number"], calls()), (7, 1))
        open(os.path.join(d, "down"), "w").close()
        r1 = lookup(repo, "acme-co/web", "b2", cache, now=1700)
        eq("after the TTL a failing gh keeps the last PR, marks it stale, and checked_at stays the last SUCCESS", (r1[0]["number"], r1[1], r1[2], calls()), (7, 1000, True, 2))
        eq("the failure is not retried inside the TTL", (lookup(repo, "acme-co/web", "b2", cache, now=1800)[1:], calls()), ((1000, True), 2))
        eq("a branch never found stays None, never checked, stale", lookup(repo, "acme-co/web", "b3", cache, now=1800), (None, None, True))
        os.remove(os.path.join(d, "down"))
        eq("a success after a failure clears stale", lookup(repo, "acme-co/web", "b2", cache, now=2400)[1:], (2400, False))
        eq("past the deadline no gh call is made and the cached PR is served stale", (lookup(repo, "acme-co/web", "b9", cache, now=9000, deadline=1)[2], calls()), (True, 4))
        eq("two writers keep each other's entries", sorted(k.split("#")[1] for k in _read(os.path.join(cache, FILE))), ["b", "b2", "b3"])
    if bad:
        print("prcache self-test: FAILED: " + "; ".join(bad))
        return 1
    print("prcache self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
