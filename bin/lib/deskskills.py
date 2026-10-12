"""Skills a desk carries: the recipe's `skills` list, where a skill lives in its pinned source, and (for bin/kit) the sanitiser.

A desk's `skills` is a list of {"use": "<source>:<skill>", "at": "<optional one-line heading text>"}. The source is a name from
office.json `sources`; the skill is found at <source dir>/skills/<skill>/ first, else <source dir>/<skill>/ (one rule, used everywhere).
This module holds the recipe-side checks; the build-side reading and sanitising is in `load_skill` below.
"""
import os, re

USE_RE = re.compile(r"[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*")
SKILL_KEYS = ("use", "at")


def shape_errors(skills, where):
    """Problems with one desk's `skills` value, as lines naming `where` (e.g. "desks[0]")."""
    if not isinstance(skills, list):
        return [f"{where}.skills must be a list"]
    errs, seen = [], set()
    for j, s in enumerate(skills):
        w = f"{where}.skills[{j}]"
        if not isinstance(s, dict):
            errs.append(f"{w} must be an object")
            continue
        for k in s:
            if k not in SKILL_KEYS:
                errs.append(f"{w} has unknown key {k} (allowed: use, at)")
        u = s.get("use")
        if not (isinstance(u, str) and USE_RE.fullmatch(u)):
            errs.append(f"{w}.use must be <source>:<skill> (lower-case letters, digits and hyphens)")
        elif u in seen:
            errs.append(f"{where}.skills lists {u} twice")
        else:
            seen.add(u)
        if "at" in s and not (isinstance(s["at"], str) and s["at"].strip() and "\n" not in s["at"]):
            errs.append(f"{w}.at must be a non-empty one-line string")
    return errs


def skill_dir(source_dir, skill):
    """The folder holding `skill` inside a source clone: <dir>/skills/<skill> first, else <dir>/<skill>; None when neither has a SKILL.md."""
    for p in (os.path.join(source_dir, "skills", skill), os.path.join(source_dir, skill)):
        if os.path.isfile(os.path.join(p, "SKILL.md")):
            return p
    return None


def split_use(use):
    return use.split(":", 1)


def recipe_problems(office, desks):
    """(errors, warnings) for the skills of a recipe's desks against office.json: the source must be listed; when its clone is
    present the skill must be in it; an absent clone is only a warning (CI has no clones), and the pin is not judged here."""
    errs, warns = [], []
    for dk in desks:
        for s in dk.get("skills") or []:
            src, skill = split_use(s["use"])
            try:
                srcs = office.sources
            except Exception as e:  # ConfigError: the config's own check reports it
                errs.append(f"{s['use']}: {e}")
                continue
            if src not in srcs:
                errs.append(f"{s['use']}: source {src} is not listed in office.json sources")
                continue
            d = os.path.join(office.workspace or "", srcs[src]["dir"])
            if not os.path.isdir(d):
                warns.append(f"{s['use']}: clone {srcs[src]['dir']} is absent, skill not checked")
            elif skill_dir(d, skill) is None:
                errs.append(f"{s['use']}: no SKILL.md at {srcs[src]['dir']}/skills/{skill}/ or {srcs[src]['dir']}/{skill}/")
    return errs, warns


# ---- build side: read a skill out of its pinned clone and refuse anything that is not plain text -------------------------

FM_KEYS = ("name", "description", "license", "argument-hint", "disable-model-invocation")


class SkillError(Exception):
    """A skill the kit refuses to inline: the message is one line a person can act on."""


def _read(path, label):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read().replace("\r\n", "\n").replace("\r", "\n")
    except (OSError, UnicodeDecodeError):
        raise SkillError(f"{label}: unreadable (not a UTF-8 text file)")


def _inventory(sd, label):
    """The reference files of skill folder `sd`; the folder may hold only SKILL.md and references/*.md (regular files)."""
    refs = []
    for n in sorted(os.listdir(sd)):
        p = os.path.join(sd, n)
        if n == "SKILL.md" and os.path.isfile(p) and not os.path.islink(p):
            continue
        if n == "references" and os.path.isdir(p) and not os.path.islink(p):
            for r in sorted(os.listdir(p)):
                rp = os.path.join(p, r)
                if not (r.endswith(".md") and not r.startswith(".") and os.path.isfile(rp) and not os.path.islink(rp)):
                    raise SkillError(f"{label}: references/{r} is not a plain .md file; only SKILL.md and references/*.md are inlined")
                refs.append(r)
            continue
        raise SkillError(f"{label}: {n} is not allowed in a skill folder; only SKILL.md and references/*.md are inlined")
    return refs


def _body(text, label):
    """SKILL.md without its frontmatter; refuses a missing frontmatter or any key outside FM_KEYS."""
    m = re.match(r"---\n(.*?)\n---[ \t]*(?:\n|$)", text, re.S)
    if not m:
        raise SkillError(f"{label}: SKILL.md has no frontmatter")
    keys = re.findall(r"^([^\s#:][^:]*):", m.group(1), re.M)
    for k in keys:
        if k.strip() not in FM_KEYS:
            raise SkillError(f"{label}: SKILL.md frontmatter key {k.strip()} is not allowed (allowed: {', '.join(FM_KEYS)})")
    return text[m.end():].strip("\n")


def load_skill(office, use, at=None, lenient=False):
    """The markdown section for one `use`, ready to append to a desk's body. Refuses (SkillError) a clone not at its pinned
    commit or with local changes, a missing skill, and anything in the skill folder but SKILL.md and references/*.md.
    With `lenient`, a source whose clone folder is absent gives None (the drift check skips it) instead of an error."""
    src, skill = split_use(use)
    try:
        s = office.source(src)
    except Exception as e:
        raise SkillError(f"{use}: {e}")
    if lenient and office.workspace and not os.path.isdir(os.path.join(office.workspace, s["dir"])):
        return None
    msg = office.check_source(src)
    if msg != "ok":
        raise SkillError(f"{use}: {msg}")
    sd = skill_dir(os.path.join(office.workspace, s["dir"]), skill)
    if sd is None:
        raise SkillError(f"{use}: no SKILL.md at {s['dir']}/skills/{skill}/ or {s['dir']}/{skill}/")
    refs = _inventory(sd, use)
    out = [f"## Skill: {skill} ({src}@{s['ref'] or s['sha'][:12]})"]
    if at:
        out.append(at)
    out.append(_body(_read(os.path.join(sd, "SKILL.md"), use + " SKILL.md"), use))
    for r in refs:
        out.append(f"### {r}\n\n" + _read(os.path.join(sd, "references", r), f"{use} references/{r}").strip("\n"))
    return "\n\n".join(out)


def render_desks(recipes, template, office, lenient=False):
    """(files, skipped): kitlib.render with the skills read from `office`'s pinned clones. Raises SkillError when a skill is refused.
    `lenient` (the drift check) leaves out a skill whose clone is absent and lists that agent file in `skipped`."""
    import kitlib
    skipped = []
    files = kitlib.render(recipes, template, lambda use, at: load_skill(office, use, at, lenient), skipped)
    return files, sorted(set(skipped))
