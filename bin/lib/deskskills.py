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
