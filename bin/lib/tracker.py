"""The tracker adapter: card URLs, `get <url>`, and the write-deny and authority patterns, from office.json's `tracker`.

Type "none" (the default) turns card done-checks off (bin/team passes them with a note). Any other type spells out its keys in
office.json. `get` is a command template with {id} (and {url}); it prints one JSON object: the neutral shape
{title, description, labels: [name]} or the {name, desc, labels: [{name}]} shape card trackers such as Trello use.
$TEAM_TRACKER (else the old $TEAM_TRELLO) replaces the command's first word (a test hook).
"""
import json, os, re, shlex, subprocess, sys


class TrackerError(Exception):
    pass


class Tracker:
    def __init__(self, cfg, env=None):
        self.cfg = cfg or {}
        self.env = os.environ if env is None else env
        self.type = self.cfg.get("type") or "none"
        self.enabled = self.type != "none"
        self.name = self.cfg.get("name") or self.type.capitalize()
        self.card_re = self._compile(self.cfg.get("cardUrlRegex")) if self.enabled else None

    @staticmethod
    def _compile(rx):
        """The card-URL regex, or None when it is missing, does not compile or has no capture group (Office.tracker rejects
        those loudly, so this only guards a Tracker built by hand)."""
        try:
            c = re.compile(rx)
            return c if c.groups >= 1 else None
        except (re.error, TypeError):
            return None

    def ids(self, text):
        """Distinct card ids named in `text`, in order (the regex's first group)."""
        if not self.card_re:
            return []
        return list(dict.fromkeys(self.card_re.findall(text or "")))

    def get(self, ref):
        """`ref` is a card URL or id. Returns {id, title, description, labels: [name]}."""
        m = self.card_re.search(ref) if self.card_re else None
        cid = m.group(1) if m else ref
        cmd = self.cfg.get("get")
        if not self.enabled or not cmd:
            raise TrackerError(f"tracker {self.type} has no get command")
        argv = shlex.split(cmd.replace("{url}", shlex.quote(ref)).replace("{id}", shlex.quote(cid)))
        hook = self.env.get("TEAM_TRACKER") or self.env.get("TEAM_TRELLO")
        if hook:
            argv = shlex.split(hook) + argv[1:]
        r = None
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=60)
            d = json.loads(r.stdout)
            if not isinstance(d, dict):
                raise ValueError
        except (ValueError, OSError, subprocess.TimeoutExpired):
            err = r.stderr if r else ""
            raise TrackerError(f"cannot read {self.name} card {cid}: {(err or '').strip()[:150]}")
        labels = [(x.get("name") if isinstance(x, dict) else x) or "" for x in d.get("labels") or []]
        return {"id": cid, "title": d.get("title") or d.get("name") or "",
                "description": d.get("description") or d.get("desc") or "", "labels": labels}

    @property
    def write_deny(self):
        return list(self.cfg.get("writeDeny") or []) if self.enabled else []

    def level(self, n):
        """(deny patterns to lift, allow patterns to add) at authority level n; ([], []) for none."""
        lv = (self.cfg.get("authorityAllow") or {}).get(str(n)) if self.enabled else None
        lv = lv or {}
        return list(lv.get("undeny") or []), list(lv.get("allow") or [])


def self_test():
    import tempfile
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    from officeconfig import Office, load
    engine = os.path.dirname(os.path.dirname(here))
    bad = []

    def eq(label, got, want):
        if got != want:
            bad.append(f"{label}: got {got!r}, want {want!r}")
    t = Tracker(Office({}, {}).tracker, {})
    eq("default is none", (t.type, t.enabled, t.ids("https://tasks.acme.test/t/77"), t.write_deny, t.level(1)), ("none", False, [], [], ([], [])))
    cards = Tracker({"type": "acme", "cardUrlRegex": r"https://tasks\.acme\.test/t/([A-Za-z0-9]+)", "get": "acme-tasks get {id}"}, {})
    eq("ids are distinct and in order", cards.ids("see https://tasks.acme.test/t/AbC123/x and https://tasks.acme.test/t/AbC123 and https://tasks.acme.test/t/Zz9"), ["AbC123", "Zz9"])
    eq("an enabled tracker without patterns has none", (cards.name, cards.write_deny, cards.level(1)), ("Acme", [], ([], [])))
    for bad_rx in ("https://x/(", "https://x/c/\\d+", 5, None):
        eq(f"invalid cardUrlRegex {bad_rx!r} finds no cards", Tracker({"type": "acme", "cardUrlRegex": bad_rx}, {}).ids("https://x/c/1"), [])
    none = Tracker(load("/nonexistent", {"BUSYBODY_CONFIG": os.path.join(engine, "fixtures", "office.json")}).tracker, {})
    eq("none: disabled, no ids, no deny, no levels", (none.enabled, none.ids("https://tasks.acme.test/t/77"), none.write_deny, none.level(1)), (False, [], [], ([], [])))
    try:
        none.get("x")
        bad.append("none: get must raise")
    except TrackerError:
        pass
    with tempfile.TemporaryDirectory() as d:
        stub = os.path.join(d, "acme-tasks")
        open(stub, "w").write('#!/bin/sh\n[ "$1" = get ] && [ "$2" = 77 ] && echo \'{"title":"T","description":"D","labels":["Ready"]}\' || exit 1\n')
        os.chmod(stub, 0o755)
        acme = Tracker({"type": "acme", "name": "Acme", "cardUrlRegex": r"https://tasks\.acme\.test/t/(\d+)", "get": f"{stub} get {{id}}",
                        "writeDeny": ["Bash(acme-tasks set*)"], "authorityAllow": {"1": {"undeny": ["Bash(acme-tasks set*)"], "allow": ["Bash(acme-tasks set x*)"]}}}, {})
        eq("custom ids", acme.ids("https://tasks.acme.test/t/77 https://other.example/c/AbC123"), ["77"])
        eq("custom get by url", acme.get("https://tasks.acme.test/t/77"), {"id": "77", "title": "T", "description": "D", "labels": ["Ready"]})
        eq("custom deny and level", (acme.write_deny, acme.level(1)), (["Bash(acme-tasks set*)"], (["Bash(acme-tasks set*)"], ["Bash(acme-tasks set x*)"])))
        try:
            acme.get("99")
            bad.append("custom: failing get must raise")
        except TrackerError as e:
            eq("custom error names the tracker", str(e).startswith("cannot read Acme card 99"), True)
        card_stub = os.path.join(d, "acme-cards")
        open(card_stub, "w").write('#!/bin/sh\necho \'{"name":"N","desc":"DD","labels":[{"name":"Ready"}]}\'\n')
        os.chmod(card_stub, 0o755)
        for hook in ("TEAM_TRACKER", "TEAM_TRELLO"):
            eq(f"card-tracker shape and ${hook}", Tracker(cards.cfg, {hook: card_stub}).get("https://tasks.acme.test/t/AbC123/x"),
               {"id": "AbC123", "title": "N", "description": "DD", "labels": ["Ready"]})
    if bad:
        print("tracker self-test: FAILED: " + "; ".join(bad))
        return 1
    print("tracker self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else 2)
