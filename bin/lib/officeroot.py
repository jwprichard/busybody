"""The two roots every bin/ script needs, kept apart.

ENGINE_ROOT is where the engine lives: the script's own checkout (templates/, teams/, fixtures/, bin/lib).
WORKSPACE_ROOT is the user's workspace (roles/, decisions/, child repo clones, .cache, minutes state):
$BUSYBODY_WORKSPACE (the old $OFFICE_WORKSPACE still works), else the nearest parent of the cwd holding office.json, else the folder the tool was launched from when that holds office.json (a compat symlink), else ENGINE_ROOT.
The bash twin is bin/lib/officeroot.sh; `officeroot.py --self-test` checks both agree.
"""
import os, shutil, subprocess, sys, tempfile


def engine_root(script):
    """`script` is the caller's __file__: bin/<script> or bin/lib/<script>."""
    d = os.path.dirname(os.path.realpath(script))   # real path: a script reached through a compat symlink still finds its engine
    return os.path.dirname(d) if os.path.basename(d) == "bin" else os.path.dirname(os.path.dirname(d))


def bb_env(env, key, *legacy):
    """$BUSYBODY_<key>, else $OFFICE_<key>, else any other legacy name given; "" when none is set. The new name wins."""
    env = os.environ if env is None else env
    for k in (f"BUSYBODY_{key}", f"OFFICE_{key}") + legacy:
        if env.get(k):
            return env[k]
    return ""


def data_root(workspace, env=None):
    """Where the clones and `.cache/` live. Normally the workspace itself. A worktree of the workspace repo (its `.git` is a file)
    that holds no clones of its own would otherwise get a cold cache of its own, so it uses the main checkout's, when that holds
    office.json. $BUSYBODY_WORKSPACE, when set, is honoured first and used as it is."""
    if bb_env(env, "WORKSPACE") or not os.path.isfile(os.path.join(workspace, ".git")):
        return workspace
    try:
        # a clone of its own: a visible subfolder with a .git (file or folder), the same rule as officeroot.sh's */.git glob
        if any(not n.startswith(".") and os.path.exists(os.path.join(workspace, n, ".git")) for n in os.listdir(workspace)):
            return workspace
        r = subprocess.run(["git", "-C", workspace, "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return workspace
    common = r.stdout.strip()
    main = os.path.dirname(common) if os.path.basename(common) == ".git" else ""
    return main if main and os.path.isfile(os.path.join(main, "office.json")) else workspace


def selftest_reexec(engine):
    """A script's --self-test runs on the engine's neutral acme fixture (fixtures/office.json), never the workspace's own
    office.json: re-run the script once with BUSYBODY_CONFIG pointing at it. The workspace's own config is checked in the workspace."""
    if "--self-test" in sys.argv[1:] and bb_env(None, "SELFTEST") != "1":
        env = {k: v for k, v in os.environ.items() if k != "OFFICE_CONFIG"}
        env.update(BUSYBODY_SELFTEST="1", BUSYBODY_CONFIG=os.path.join(engine, "fixtures", "office.json"))
        os.execve(sys.executable, [sys.executable, "-I"] + sys.argv, env)


def invoked_root():
    """The folder above the directory this process was started from (sys.argv[0], symlinks NOT resolved): when a workspace's
    bin/<tool> is a symlink into the engine, this is the workspace root."""
    return os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[0])))


def workspace_root(engine, env=None, cwd=None, invoked=None):
    env = os.environ if env is None else env
    if bb_env(env, "WORKSPACE"):
        return os.path.abspath(bb_env(env, "WORKSPACE"))
    d = os.path.abspath(cwd or os.getcwd())
    while True:
        if os.path.isfile(os.path.join(d, "office.json")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            if invoked and os.path.isfile(os.path.join(invoked, "office.json")):
                return invoked   # launched through a symlink from a workspace, from a folder outside it
            return engine
        d = parent


def self_test():
    here = os.path.dirname(os.path.abspath(__file__))
    engine = os.path.dirname(os.path.dirname(here))
    sh = os.path.join(here, "officeroot.sh")
    bad = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = os.path.realpath(tmp)
        plain, ws = os.path.join(tmp, "plain"), os.path.join(tmp, "ws", "sub")
        os.makedirs(plain)
        os.makedirs(ws)
        open(os.path.join(tmp, "ws", "office.json"), "w").write("{}")

        def py(env, cwd):
            return workspace_root(engine, env, cwd)

        def bash(env, cwd):
            e = {k: v for k, v in os.environ.items() if k not in ("OFFICE_WORKSPACE", "BUSYBODY_WORKSPACE")}
            e.update(env)
            r = subprocess.run(["bash", "-c", f'ENGINE_ROOT="$1"; . "$2"; printf %s "$WORKSPACE_ROOT"', "x", engine, sh],
                               cwd=cwd, env=e, capture_output=True, text=True)
            return r.stdout
        inv = os.path.join(tmp, "ws")

        def py_inv(env, cwd):
            return workspace_root(engine, env, cwd, inv)
        got = py_inv({}, plain)
        if got != inv:
            bad.append(f"py: launched from a workspace, cwd outside it: got {got!r}, want {inv!r}")
        if workspace_root(engine, {}, ws, os.path.join(tmp, "plain")) != os.path.join(tmp, "ws"):
            bad.append("py: cwd inside a workspace beats the launch folder")
        # a worktree of the workspace repo with no clones uses the main checkout's cache; BUSYBODY_WORKSPACE is used as given
        main = os.path.join(tmp, "main")
        os.makedirs(main)
        open(os.path.join(main, "office.json"), "w").write("{}")
        g = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(g + ["-C", main, "init", "-q", "-b", "main"], check=True, capture_output=True)
        subprocess.run(g + ["-C", main, "add", "."], check=True, capture_output=True)
        subprocess.run(g + ["-C", main, "commit", "-q", "-m", "x"], check=True, capture_output=True)
        wt = os.path.join(tmp, "wt")
        subprocess.run(g + ["-C", main, "worktree", "add", "-q", wt, "-b", "side"], check=True, capture_output=True)
        if data_root(wt, {}) != main:
            bad.append(f"data_root of a bare worktree: {data_root(wt, {})!r}, want {main!r}")
        if data_root(wt, {"BUSYBODY_WORKSPACE": wt}) != wt or data_root(main, {}) != main:
            bad.append("data_root: an explicit workspace and a main checkout are used as they are")
        os.makedirs(os.path.join(wt, ".claude", "worktrees", "room-x", ".git"))   # hidden folders do not count as clones
        if data_root(wt, {}) != main:
            bad.append("data_root: a hidden folder with a .git is not a clone")
        os.makedirs(os.path.join(wt, "clone", ".git"))
        if data_root(wt, {}) != wt:
            bad.append("data_root: a worktree with a clone of its own keeps its own cache")
        shutil.rmtree(os.path.join(wt, "clone"))
        open(os.path.join(wt, "clone2"), "w").close()
        os.makedirs(os.path.join(wt, "clone3"))
        open(os.path.join(wt, "clone3", ".git"), "w").write("gitdir: x\n")   # a .git FILE counts as a clone too
        if data_root(wt, {}) != wt:
            bad.append("data_root: a clone whose .git is a file keeps the worktree's own cache")

        def sh_data():
            env = {k: v for k, v in os.environ.items() if k not in ("OFFICE_WORKSPACE", "BUSYBODY_WORKSPACE")}
            return subprocess.run(["bash", "-c", 'ENGINE_ROOT="$1"; . "$2"; printf %s "$DATA_ROOT"', "x", engine, sh], cwd=wt, env=env, capture_output=True, text=True).stdout
        if sh_data() != data_root(wt, {}):
            bad.append(f"data_root: officeroot.sh says {sh_data()!r}, officeroot.py says {data_root(wt, {})!r} (clone whose .git is a file)")
        shutil.rmtree(os.path.join(wt, "clone3"))
        if sh_data() != data_root(wt, {}) or sh_data() != main:
            bad.append(f"data_root: officeroot.sh and officeroot.py must agree on a worktree with only hidden .git folders: {sh_data()!r} vs {data_root(wt, {})!r}")
        cases = [
            ("default (no env, no office.json) is the engine root", {}, plain, engine),
            ("OFFICE_WORKSPACE overrides", {"OFFICE_WORKSPACE": plain}, ws, plain),
            ("BUSYBODY_WORKSPACE overrides", {"BUSYBODY_WORKSPACE": plain}, ws, plain),
            ("BUSYBODY_WORKSPACE wins over OFFICE_WORKSPACE", {"BUSYBODY_WORKSPACE": plain, "OFFICE_WORKSPACE": ws}, ws, plain),
            ("walks up to office.json", {}, ws, os.path.join(tmp, "ws")),
        ]
        for name, env, cwd, want in cases:
            for lang, fn in (("py", py), ("sh", bash)):
                got = fn(env, cwd)
                if got != want:
                    bad.append(f"{lang}: {name}: got {got!r}, want {want!r}")
        if engine_root(os.path.join(engine, "bin", "team")) != engine or \
                engine_root(os.path.join(engine, "bin", "lib", "costlib.py")) != engine:
            bad.append("engine_root from bin/ and bin/lib")
    if bad:
        print("officeroot self-test: FAILED: " + "; ".join(bad))
        return 1
    print("officeroot self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
