"""A workspace's repo names, GitHub slugs, minutes repo and room rules, read from office.json. The engine holds no defaults
for any of them: a missing minutesRepo stops every script with "no minutesRepo: run `busybody init`".

The file is $BUSYBODY_CONFIG (the old $OFFICE_CONFIG still works), else <workspace root>/office.json.
Defaults that do exist are workspace-relative: the workspace repo's name is its folder's name, and the repo list is just that repo.
The bash twin is officeconfig.sh; `officeconfig.py get|repos|room-json|owner-only|check` is the CLI for launchers.
"""
import contextlib, io, json, os, re, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from officeroot import bb_env  # noqa: E402


class ConfigError(Exception):
    """A missing or malformed office.json field: the message is one line a person can act on."""


DEFAULT_PORT_BASE = 41000
DEFAULT_OWNER_ONLY = ("anything touching prod", "merging, ever", "spending over the cap")
MERGE_MODES = ("pr", "land")
SOURCE_KEYS = ("url", "ref", "sha", "dir", "licence", "vetted")
SOURCE_NAME = re.compile(r"[a-z0-9][a-z0-9-]*")


def _str_list(value, what):
    if not (isinstance(value, list) and all(isinstance(x, str) and x for x in value)):
        raise ConfigError(f"{what}: must be a list of non-empty strings")
    return list(value)


class Office:
    def __init__(self, cfg=None, env=None, workspace=None):
        self.cfg = cfg or {}
        self.env = os.environ if env is None else env
        self.workspace = workspace   # the workspace folder, which names the workspace repo when office.json does not

    @property
    def minutes_repo(self):
        v = self.cfg.get("minutesRepo")
        if not v:
            raise ConfigError("no minutesRepo: run `busybody init`")
        if not (isinstance(v, str) and re.fullmatch(r"[^/\s]+/[^/\s]+", v)):
            raise ConfigError("minutesRepo: must be owner/name")
        return v

    @property
    def workspace_repo(self):
        """The name the Room block and `bin/*` use for the workspace repo itself: `workspaceRepo`, else its folder's name."""
        v = self.cfg.get("workspaceRepo")
        if v:
            return v
        if not self.workspace:
            raise ConfigError("no workspaceRepo and no workspace folder to name it after")
        return os.path.basename(os.path.abspath(self.workspace))

    @property
    def display_name(self):
        """The workspace's name for people (the band's title, the charters): `displayName`, else the workspace repo's name."""
        v = self.cfg.get("displayName")
        if v is None:
            return self.workspace_repo
        if not (isinstance(v, str) and v.strip()):
            raise ConfigError("displayName: must be a non-empty string")
        return v

    def _repo_cfgs(self):
        """`repos` as {name: settings}."""
        repos = self.cfg.get("repos")
        if repos is None:
            return {}
        if not isinstance(repos, dict):
            raise ConfigError("repos: must be an object of repo name -> settings")
        for k, v in repos.items():
            if not isinstance(v, dict):
                raise ConfigError(f"repo {k}: must be an object")
        return repos

    @property
    def repos(self):
        """The configured repos; just the workspace repo when none are listed. The workspace repo is always first."""
        names = list(self._repo_cfgs())
        if self.workspace_repo not in names:
            names.insert(0, self.workspace_repo)
        return tuple(names)

    @property
    def tracker(self):
        """The tracker block. The default is `none`; nothing is implied by a type's name, so a tracker spells out its keys."""
        t = self.cfg.get("tracker")
        if t is None:
            return {"type": "none"}
        if not isinstance(t, dict):
            raise ConfigError("tracker: must be an object")
        t = dict(t)
        kind = t.get("type") or "none"
        if not isinstance(kind, str):
            raise ConfigError("tracker.type: must be a string")
        t["type"] = kind
        if kind != "none":
            rx = t.get("cardUrlRegex")
            try:
                ok = isinstance(rx, str) and re.compile(rx).groups >= 1
            except re.error:
                ok = False
            if not ok:
                raise ConfigError(f"tracker {kind}: cardUrlRegex must be a regex with a capture group (the card id)")
            if not isinstance(t.get("get"), str) or not t["get"]:
                raise ConfigError(f"tracker {kind}: no get command")
            if "writeDeny" in t:   # these are seatbelts: a wrong shape is an error, not "off"
                _str_list(t["writeDeny"], f"tracker {kind}: writeDeny")
            aa = t.get("authorityAllow", {})
            if not (isinstance(aa, dict) and all(isinstance(v, dict) for v in aa.values())):
                raise ConfigError(f"tracker {kind}: authorityAllow must be an object of level -> {{undeny, allow}}")
            for v in aa.values():
                for k in ("undeny", "allow"):
                    if k in v:
                        _str_list(v[k], f"tracker {kind}: authorityAllow {k}")
        return t

    def _repo_cfg(self, repo):
        cfgs = self._repo_cfgs()
        if repo not in cfgs:
            raise ConfigError(f"repo {repo}: not listed in office.json repos")
        return cfgs[repo]

    def branch_prefix(self, repo):
        """The prefix of a room's branch in `repo` ("" is allowed); a repo without one is a loud error."""
        v = self._repo_cfg(repo).get("branchPrefix")
        if not isinstance(v, str):
            raise ConfigError(f"repo {repo}: no branchPrefix (a string, \"\" for none)")
        return v

    def no_push(self, repo):
        """Branches rooms may never push in `repo`: `main` always, then the repo's own `noPush` list."""
        extra = self._repo_cfg(repo).get("noPush")
        extra = [] if extra is None else _str_list(extra, f"repo {repo}: noPush")
        return ["main"] + [b for b in dict.fromkeys(extra) if b != "main"]

    def merge(self, repo):
        """"pr" (draft PRs the owner merges) or "land" (no PRs: bin/land fast-forwards and pushes)."""
        v = self._repo_cfg(repo).get("merge")
        if v not in MERGE_MODES:
            raise ConfigError(f"repo {repo}: merge must be \"pr\" or \"land\"")
        return v

    def done_note(self, repo):
        """Text appended to the generic "Done means" in a room brief; "" when none."""
        v = self._repo_cfg(repo).get("doneNote")
        if v is None:
            return ""
        if not isinstance(v, str):
            raise ConfigError(f"repo {repo}: doneNote must be a string")
        return v

    def _room(self):
        r = self.cfg.get("room")
        if r is None:
            return {}
        if not isinstance(r, dict):
            raise ConfigError("room: must be an object")
        return r

    @property
    def room_env(self):
        """Env vars set in every room (may be empty)."""
        v = self._room().get("env", {})
        if not (isinstance(v, dict) and all(isinstance(k, str) and isinstance(x, str) for k, x in v.items())):
            raise ConfigError("room.env: must be an object of strings")
        return dict(v)

    @property
    def room_deny(self):
        return _str_list(self._room().get("deny", []), "room.deny")

    @property
    def room_prod_read(self):
        """Deny patterns lifted only when a room is started with --prod-read."""
        return _str_list(self._room().get("prodRead", []), "room.prodRead")

    @property
    def draft_note(self):
        """Optional sentence closing the "Draft PRs" line of a room's powers (what a draft does or does not trigger); "" when none."""
        v = self._room().get("draftNote", "")
        if not isinstance(v, str):
            raise ConfigError("room.draftNote: must be a string")
        return v

    def protected_branches(self):
        """Every branch some repo protects, `main` first: what the powers text says rooms never push."""
        names = ["main"]
        for r in self._repo_cfgs():
            names += [b for b in self.no_push(r) if b not in names]
        return names

    @property
    def port_base(self):
        v = self._room().get("portBase", DEFAULT_PORT_BASE)
        if not (isinstance(v, int) and not isinstance(v, bool) and 1024 <= v <= 65000):
            raise ConfigError("room.portBase: must be a port number between 1024 and 65000")
        return v

    @property
    def owner_only(self):
        """What only the owner may do, as one-line strings (a short generic default)."""
        v = self.cfg.get("ownerOnly")
        return list(DEFAULT_OWNER_ONLY) if v is None else _str_list(v, "ownerOnly")

    @property
    def sources(self):
        """The pinned sources as {name: {url, ref, sha, dir, licence, vetted}}; empty when none are configured.
        Each is a third-party repo cloned (gitignored) at `dir` and pinned to a commit; `ref` is its tag, or None."""
        raw = self.cfg.get("sources")
        if raw is None:
            return {}
        if not isinstance(raw, dict):
            raise ConfigError("sources: must be an object of source name -> settings")
        return {name: self._source(name, raw[name]) for name in raw}

    @staticmethod
    def _source(name, s):
        if not (isinstance(name, str) and SOURCE_NAME.fullmatch(name)):
            raise ConfigError(f"source {name}: name must match [a-z0-9][a-z0-9-]*")
        if not isinstance(s, dict):
            raise ConfigError(f"source {name}: must be an object")
        for k in s:
            if k not in SOURCE_KEYS:
                raise ConfigError(f"source {name}: unknown key {k} (allowed: {', '.join(SOURCE_KEYS)})")
        for k in SOURCE_KEYS:
            if k not in s:
                raise ConfigError(f"source {name}: no {k}" + (" (a tag, or null for a repo with no tags)" if k == "ref" else ""))
        for k in ("url", "vetted"):
            v = s[k]
            if not (isinstance(v, str) and re.fullmatch(r"https://[^\s/]+\S*", v)):
                raise ConfigError(f"source {name}: {k} must be an https URL")
        if not (s["ref"] is None or (isinstance(s["ref"], str) and s["ref"].strip())):
            raise ConfigError(f"source {name}: ref must be a tag, or null for a repo with no tags")
        if not (isinstance(s["sha"], str) and re.fullmatch(r"[0-9a-f]{40}", s["sha"])):
            raise ConfigError(f"source {name}: sha must be 40 lowercase hex characters")
        d = s["dir"]
        if not (isinstance(d, str) and d and not d.startswith("/") and not re.match(r"[A-Za-z]:", d)
                and ".." not in d.replace("\\", "/").split("/")):
            raise ConfigError(f"source {name}: dir must be a relative path inside the workspace (no `..`)")
        if not (isinstance(s["licence"], str) and s["licence"].strip()):
            raise ConfigError(f"source {name}: licence must be a non-empty string")
        return dict(s)

    def source(self, name):
        """One source's settings; a name that is not configured is an error."""
        srcs = self.sources
        if name not in srcs:
            raise ConfigError(f"source {name}: not listed in office.json sources")
        return srcs[name]

    def room_json(self):
        return {"env": self.room_env, "deny": self.room_deny, "prodRead": self.room_prod_read, "portBase": self.port_base}

    def validate(self):
        """Every problem in the config, one line each (empty when it is sound)."""
        errs = []
        checks = [(lambda r=r, f=f: f(r)) for r in self._repo_cfgs() for f in (self.branch_prefix, self.no_push, self.merge, self.done_note)]
        for fn in checks + [self.room_json, lambda: self.owner_only, lambda: self.draft_note, lambda: self.display_name, lambda: self.tracker, lambda: self.sources]:
            try:
                fn()
            except ConfigError as e:
                errs.append(str(e))
        return errs

    def is_workspace(self, repo):
        return repo == self.workspace_repo

    def github(self, repo):
        """owner/name of a repo on GitHub; the workspace repo is the minutes repo."""
        if repo is None or self.is_workspace(repo):
            return self.minutes_repo
        g = self._repo_cfgs().get(repo, {}).get("github")
        if isinstance(g, str) and g:
            return g
        return f"{self.minutes_repo.split('/')[0]}/{repo}"

    def evidence(self, repo):
        """Name of the repo's evidence executable under evidence/; "default" (PR merged) when it names none, None when the repo is not configured."""
        repos = self._repo_cfgs()
        if repo not in repos:
            return None
        ev = repos[repo].get("evidence")
        return ev if isinstance(ev, str) and ev else "default"


def config_path(workspace, env=None):
    env = os.environ if env is None else env
    return bb_env(env, "CONFIG") or os.path.join(workspace, "office.json")


def load(workspace, env=None):
    try:
        with open(config_path(workspace, env)) as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    return Office(cfg if isinstance(cfg, dict) else {}, env, workspace)


def load_or_exit(workspace, prog, env=None):
    """The config for a script: a missing minutesRepo or a malformed tracker/repos block stops it with one line on stderr."""
    o = load(workspace, env)
    try:
        o.minutes_repo, o.workspace_repo, o.repos, o.tracker
    except ConfigError as e:
        sys.exit(f"{prog}: {e}")
    return o


def self_test():
    _GONE = object()   # marks a source key to leave out
    here = os.path.dirname(os.path.abspath(__file__))
    engine = os.path.dirname(os.path.dirname(here))
    fx = os.path.join(engine, "fixtures", "office.json")
    bad = []

    def eq(label, got, want):
        if got != want:
            bad.append(f"{label}: got {got!r}, want {want!r}")
    def err(label, fn, want):
        try:
            fn()
            bad.append(f"{label}: no error")
        except ConfigError as e:
            eq(label, str(e), want)
    silent = Office({}, {}, "/w/acme-office")
    err("no minutesRepo fails loudly", lambda: silent.minutes_repo, "no minutesRepo: run `busybody init`")
    err("github needs a minutesRepo", lambda: silent.github("a"), "no minutesRepo: run `busybody init`")
    err("minutesRepo must be owner/name", lambda: Office({"minutesRepo": "x"}, {}).minutes_repo, "minutesRepo: must be owner/name")
    eq("the workspace repo is named after its folder", (silent.workspace_repo, silent.repos), ("acme-office", ("acme-office",)))
    eq("default tracker is none", (silent.tracker, Office({"tracker": {"type": None}}, {}).tracker["type"]), ({"type": "none"}, "none"))
    eq("a listed repo list always has the workspace repo first", Office({"repos": {"b": {}}}, {}, "/w/acme-office").repos, ("acme-office", "b"))
    eq("minutesRepo and workspaceRepo from the config", (Office({"minutesRepo": "o/m", "workspaceRepo": "wsr"}, {}).minutes_repo, Office({"workspaceRepo": "wsr"}, {}).workspace_repo), ("o/m", "wsr"))
    eq("github: derived owner and the workspace repo is the minutes repo", (Office({"minutesRepo": "o/m", "workspaceRepo": "m"}, {}).github("x"), Office({"minutesRepo": "o/m", "workspaceRepo": "m"}, {}).github("m")), ("o/x", "o/m"))
    eq("the old override variable is gone", Office({"minutesRepo": "o/m"}, {"SCH_WORKSPACE_REPO": "x/y"}).minutes_repo, "o/m")
    with contextlib.redirect_stderr(io.StringIO()) as errout:
        try:
            load_or_exit("/nonexistent", "prog", {})
            bad.append("load_or_exit: no exit")
        except SystemExit as e:
            eq("load_or_exit stops with one line", e.code, "prog: no minutesRepo: run `busybody init`")
    acme = load("/nonexistent", {"OFFICE_CONFIG": fx})
    eq("fixture minutes", acme.minutes_repo, "acme-co/acme-office")
    eq("fixture repos", acme.repos, ("acme-office", "acme-web", "acme-api", "acme-bot"))
    eq("fixture explicit github", acme.github("acme-web"), "acme-co/web-app")
    eq("fixture derived github", (acme.github("acme-api"), acme.github("acme-bot")), ("acme-co/acme-api", "acme-co/acme-bot"))
    eq("fixture workspace github", acme.github("acme-office"), "acme-co/acme-office")
    tr = {"type": "acme", "cardUrlRegex": "https://t/(\\d+)", "get": "acme get {id}"}
    eq("a tracker spells out its keys: nothing is filled in", Office({"tracker": tr}, {}).tracker, tr)
    for key, bad_val in (("cardUrlRegex", "https://t/\\d+"), ("cardUrlRegex", "("), ("cardUrlRegex", 5), ("get", ""), ("writeDeny", "x"), ("writeDeny", [1]), ("authorityAllow", [])):
        try:
            Office({"tracker": dict(tr, **{key: bad_val})}, {}).tracker
            bad.append(f"tracker {key}={bad_val!r}: no error")
        except ConfigError:
            pass
    for bad_repos in ([], ["a"], "a", 3):
        err(f"repos={bad_repos!r} is an error", lambda: Office({"repos": bad_repos}, {}).repos, "repos: must be an object of repo name -> settings")
    err("a repo entry that is not an object is an error", lambda: Office({"workspaceRepo": "w", "minutesRepo": "o/w", "repos": {"a": None}}, {}).github("a"), "repo a: must be an object")
    eq("fixture evidence", [acme.evidence(r) for r in ("acme-web", "nope")], ["default", None])
    eq("fixture branchPrefix", [acme.branch_prefix(r) for r in ("acme-office", "acme-web", "acme-api")], ["feat/", "work/", "feature/"])
    eq("empty branchPrefix is allowed", Office({"repos": {"a": {"branchPrefix": ""}}}, {}).branch_prefix("a"), "")
    eq("fixture noPush: main always, first, once", [acme.no_push(r) for r in ("acme-office", "acme-web", "acme-api")], [["main"], ["main", "release"], ["main"]])
    eq("fixture merge", [acme.merge(r) for r in ("acme-office", "acme-web", "acme-api")], ["land", "pr", "pr"])
    eq("fixture doneNote", [acme.done_note(r) for r in ("acme-web", "acme-api")], ["Done also means the preview deploy is green.", ""])
    eq("fixture room", acme.room_json(), {"env": {"ACME_ENV": "dev"}, "deny": ["Bash(acme-cli deploy*)"], "prodRead": ["mcp__acme-prod__*"], "portBase": 42000})
    eq("fixture protected branches and draftNote", (acme.protected_branches(), acme.draft_note, Office({}, {}).protected_branches()), (["main", "release"], "", ["main"]))
    eq("draftNote", Office({"room": {"draftNote": "x."}}, {}).draft_note, "x.")
    eq("displayName defaults to the workspace repo's name", (Office({"workspaceRepo": "w"}, {}).display_name, Office({"displayName": "Acme", "workspaceRepo": "w"}, {}).display_name), ("w", "Acme"))
    sha = "a" * 40
    src = {"url": "https://example.com/x/y", "ref": "v1.0", "sha": sha, "dir": "sources/y", "licence": "MIT", "vetted": "https://example.com/minutes/1"}
    eq("fixture sources", acme.sources, {"widget-kit": {"url": "https://example.com/widgets/kit", "ref": "v2.1.0", "sha": "0123456789abcdef0123456789abcdef01234567", "dir": "sources/widget-kit", "licence": "MIT", "vetted": "https://example.com/acme-office/issues/7#issuecomment-1"},
                                         "tagless": {"url": "https://example.com/widgets/tagless", "ref": None, "sha": "fedcba9876543210fedcba9876543210fedcba98", "dir": "sources/tagless", "licence": "Apache-2.0", "vetted": "https://example.com/acme-office/issues/7#issuecomment-2"}})
    eq("fixture source(name), none configured", (acme.source("tagless")["ref"], Office({}, {}).sources), (None, {}))
    eq("a valid source", Office({"sources": {"y": src}}, {}).source("y"), src)
    eq("ref null is fine", Office({"sources": {"y": dict(src, ref=None)}}, {}).source("y")["ref"], None)
    def src_err(label, want, **kw):
        s = {k: v for k, v in dict(src, **kw).items() if v is not _GONE}
        err(label, lambda: Office({"sources": {"y": s}}, {}).sources, want)
    src_err("source without sha", "source y: no sha", sha=_GONE)
    src_err("source without ref", "source y: no ref (a tag, or null for a repo with no tags)", ref=_GONE)
    src_err("short sha", "source y: sha must be 40 lowercase hex characters", sha="abc123")
    src_err("upper-case sha", "source y: sha must be 40 lowercase hex characters", sha="A" * 40)
    src_err("absolute dir", "source y: dir must be a relative path inside the workspace (no `..`)", dir="/etc/y")
    src_err("dir with ..", "source y: dir must be a relative path inside the workspace (no `..`)", dir="sources/../../y")
    src_err("http url", "source y: url must be an https URL", url="http://example.com/x/y")
    src_err("non-https vetted", "source y: vetted must be an https URL", vetted="minute 3")
    src_err("unknown key", "source y: unknown key branch (allowed: url, ref, sha, dir, licence, vetted)", branch="main")
    src_err("empty licence", "source y: licence must be a non-empty string", licence="")
    src_err("numeric ref", "source y: ref must be a tag, or null for a repo with no tags", ref=3)
    err("bad source name", lambda: Office({"sources": {"Y_1": src}}, {}).sources, "source Y_1: name must match [a-z0-9][a-z0-9-]*")
    err("sources must be an object", lambda: Office({"sources": []}, {}).sources, "sources: must be an object of source name -> settings")
    err("unknown source", lambda: acme.source("nope"), "source nope: not listed in office.json sources")
    eq("validate reports a bad source", Office({"sources": {"y": dict(src, sha="x")}}, {}, "/w/acme-office").validate(), ["source y: sha must be 40 lowercase hex characters"])
    eq("fixture ownerOnly", acme.owner_only, ["deploying to acme-prod"])
    eq("room defaults", (Office({}, {}).room_json(), Office({}, {}).owner_only),
       ({"env": {}, "deny": [], "prodRead": [], "portBase": 41000}, list(DEFAULT_OWNER_ONLY)))

    def err(label, fn, want):
        try:
            fn()
            bad.append(f"{label}: no error")
        except ConfigError as e:
            eq(label, str(e), want)
    err("no branchPrefix fails loudly", lambda: acme.branch_prefix("acme-bot"), 'repo acme-bot: no branchPrefix (a string, "" for none)')
    err("no merge fails loudly", lambda: acme.merge("acme-bot"), 'repo acme-bot: merge must be "pr" or "land"')
    err("merge must be pr or land", lambda: Office({"repos": {"a": {"merge": "squash"}}}, {}).merge("a"), 'repo a: merge must be "pr" or "land"')
    err("unknown repo", lambda: acme.branch_prefix("nope"), "repo nope: not listed in office.json repos")
    err("noPush must be a list", lambda: Office({"repos": {"a": {"noPush": "x"}}}, {}).no_push("a"), "repo a: noPush: must be a list of non-empty strings")
    err("room.env must be strings", lambda: Office({"room": {"env": {"A": 1}}}, {}).room_env, "room.env: must be an object of strings")
    err("room.deny must be a list", lambda: Office({"room": {"deny": "x"}}, {}).room_deny, "room.deny: must be a list of non-empty strings")
    err("portBase must be a port", lambda: Office({"room": {"portBase": "41000"}}, {}).port_base, "room.portBase: must be a port number between 1024 and 65000")
    err("ownerOnly must be a list", lambda: Office({"ownerOnly": 3}, {}).owner_only, "ownerOnly: must be a list of non-empty strings")
    eq("validate names every bad repo", acme.validate(), ['repo acme-bot: no branchPrefix (a string, "" for none)', 'repo acme-bot: merge must be "pr" or "land"'])
    eq("fixture workspace name", acme.is_workspace("acme-web"), False)
    err("a missing file means no minutesRepo", lambda: load("/nonexistent", {}).minutes_repo, "no minutesRepo: run `busybody init`")
    err("a file that is not JSON means no minutesRepo", lambda: load("/nonexistent", {"BUSYBODY_CONFIG": os.path.join(engine, "README.md")}).minutes_repo, "no minutesRepo: run `busybody init`")
    sh = os.path.join(here, "officeconfig.sh")
    root_sh = os.path.join(here, "officeroot.sh")

    def bash(env, snippet):
        e = {k: v for k, v in os.environ.items() if k not in ("OFFICE_CONFIG", "BUSYBODY_CONFIG", "OFFICE_WORKSPACE", "BUSYBODY_WORKSPACE")}
        e.update(env)
        return subprocess.run(["bash", "-c", f'ENGINE_ROOT=/nonexistent; . "$2"; WORKSPACE_ROOT=/nonexistent; . "$1"; {snippet}', "x", sh, root_sh],
                              env=e, capture_output=True, text=True).stdout.strip()
    eq("sh no minutesRepo fails loudly", bash({}, 'office_minutes_repo 2>&1; echo "rc=$?"'), "no minutesRepo: run `busybody init`\nrc=1")
    eq("sh workspace repo is the folder's name", bash({}, 'WORKSPACE_ROOT=/w/acme-office; office_workspace_repo'), "acme-office")
    eq("sh fixture", bash({"OFFICE_CONFIG": fx}, 'echo "$(office_minutes_repo) $(office_github acme-web) $(office_github acme-api) $(office_github acme-office) $(office_workspace_repo)"'),
       "acme-co/acme-office acme-co/web-app acme-co/acme-api acme-co/acme-office acme-office")
    eq("sh BUSYBODY_CONFIG", bash({"BUSYBODY_CONFIG": fx}, 'echo "$(office_minutes_repo)"'), "acme-co/acme-office")
    eq("sh BUSYBODY_CONFIG wins over OFFICE_CONFIG", bash({"BUSYBODY_CONFIG": fx, "OFFICE_CONFIG": "/nonexistent"}, 'echo "$(office_minutes_repo)"'), "acme-co/acme-office")
    eq("py BUSYBODY_CONFIG wins over OFFICE_CONFIG", load("/nonexistent", {"BUSYBODY_CONFIG": fx, "OFFICE_CONFIG": "/nonexistent"}).minutes_repo, "acme-co/acme-office")
    eq("sh evidence", bash({"OFFICE_CONFIG": fx}, 'echo "$(office_evidence acme-web)|$(office_evidence nope)"'), "default|")
    for bad_json in ('[]', '["a"]', 'null', '"x"'):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
            tf.write('{"minutesRepo": "o/m", "repos": %s}' % bad_json)
        eq(f"sh repos={bad_json} is no repo", bash({"OFFICE_CONFIG": tf.name}, 'echo "$(office_github a)|$(office_evidence a)"'), "o/a|")
        os.unlink(tf.name)
    eq("sh branchPrefix/noPush/merge/doneNote", bash({"BUSYBODY_CONFIG": fx}, 'echo "$(office_branch_prefix acme-web)|$(office_no_push acme-web | paste -sd,)|$(office_merge acme-office)|$(office_done_note acme-web)"'),
       "work/|main,release|land|Done also means the preview deploy is green.")
    eq("sh room and ownerOnly", bash({"BUSYBODY_CONFIG": fx}, 'echo "$(office_port_base)|$(office_room_json | jq -c .prodRead)|$(office_owner_only)|$(office_repos | paste -sd,)"'),
       '42000|["mcp__acme-prod__*"]|deploying to acme-prod|acme-office,acme-web,acme-api,acme-bot')
    eq("sh missing branchPrefix fails", bash({"BUSYBODY_CONFIG": fx}, 'office_branch_prefix acme-bot 2>&1; echo "rc=$?"'),
       'officeconfig: repo acme-bot: no branchPrefix (a string, "" for none)\nrc=1')
    with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
        rcs = (cli(["--config", fx, "get", "acme-web", "merge"], {}), cli(["--config", fx, "check"], {}), cli(["--config", fx, "get", "acme-web", "bogus"], {}))
    eq("cli get ok, check finds acme-bot, unknown field is usage", rcs, (0, 1, 2))
    # every script reads its repo names from the config: load each with the fixture and check what it resolved
    probe = ('import re,sys; sys.dont_write_bytecode=True; p=sys.argv[1]; '
             'src=re.sub(r"^main\\(sys\\.argv\\[1:\\]\\)\\s*$","",open(p).read(),flags=re.M); '
             'g={"__file__":p,"__name__":"probe"}; exec(compile(src,p,"exec"),g); print(g["REPO"])')
    for script in ("team", "rooms", "room-cost", "role"):
        r = subprocess.run([sys.executable, "-I", "-c", probe, os.path.join(engine, "bin", script)],
                           env=dict(os.environ, BUSYBODY_CONFIG=fx, BUSYBODY_ROLE_WS=engine),
                           capture_output=True, text=True)
        eq(f"bin/{script} minutes repo from the fixture", r.stdout.strip(), "acme-co/acme-office")
    if bad:
        print("officeconfig self-test: FAILED: " + "; ".join(bad))
        return 1
    print("officeconfig self-test: ok")
    return 0


USAGE = """usage: officeconfig.py [--config FILE] [--workspace DIR] COMMAND
  get REPO branchPrefix|noPush|merge|doneNote|github|path|evidence   one value (noPush: one branch per line)
  repos                  the repo names, one per line
  room-json              {env, deny, prodRead, portBase} as JSON
  display-name           the workspace's name for people (displayName, else the workspace repo's name)
  owner-only             what only the owner may do, one item per line
  check                  every problem in the config, one line each; exit 1 when there is any
  --self-test"""


def cli(argv, env=None):
    env = dict(os.environ if env is None else env)
    argv = list(argv)
    ws = None
    while argv and argv[0] in ("--config", "--workspace") and len(argv) >= 2:
        if argv[0] == "--config":
            env["BUSYBODY_CONFIG"] = argv[1]
        else:
            ws = argv[1]
        argv = argv[2:]
    if not argv:
        print(USAGE, file=sys.stderr)
        return 2
    here = os.path.dirname(os.path.abspath(__file__))
    from officeroot import workspace_root
    o = load(ws or workspace_root(os.path.dirname(os.path.dirname(here)), env), env)
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "get" and len(args) == 2:
            repo, field = args
            if field == "branchPrefix":
                out = o.branch_prefix(repo)
            elif field == "noPush":
                out = "\n".join(o.no_push(repo))
            elif field == "merge":
                out = o.merge(repo)
            elif field == "doneNote":
                out = o.done_note(repo)
            elif field == "github":
                out = o.github(repo)
            elif field == "evidence":
                out = o.evidence(repo) or ""
            elif field == "path":
                out = o._repo_cfg(repo).get("path") or repo
            else:
                print(USAGE, file=sys.stderr)
                return 2
        elif cmd == "repos" and not args:
            out = "\n".join(o.repos)
        elif cmd == "room-json" and not args:
            out = json.dumps(o.room_json())
        elif cmd == "display-name" and not args:
            out = o.display_name
        elif cmd == "owner-only" and not args:
            out = "\n".join(o.owner_only)
        elif cmd == "check" and not args:
            errs = o.validate()
            if errs:
                print("\n".join(errs), file=sys.stderr)
                return 1
            out = "office.json: ok"
        else:
            print(USAGE, file=sys.stderr)
            return 2
    except ConfigError as e:
        print(f"officeconfig: {e}", file=sys.stderr)
        return 1
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else cli(sys.argv[1:]))
