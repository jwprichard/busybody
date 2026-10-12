"""Desks as agent files: render a workspace's project-room recipes into the files of the `desks` plugin, and compare them to disk.

Shared by bin/kit (build, check, shape) and bin/team check (the drift check). Pure functions: no config, no network.
The plugin is `.claude-plugin/plugin.json` plus `agents/<team>-<desk>.md`, and nothing else (no hooks, no .mcp.json, no skills),
because a plugin dir runs outside the room's deny rules.
"""
import json, os, re

PLUGIN_NAME = "desks"
PLUGIN_VERSION = "0.1.0"
# "no edit tools", not read-only: Bash stays available to the desk, so the room's deny rules remain the real fence.
NO_EDIT_TOOLS = "Edit, Write, NotebookEdit"
EDIT_LINE = "You may edit files and commit in the room's worktree."
READONLY_LINE = "You are read-only: you read, run checks and report, and you never edit files, commit or push."


def agent_name(team, desk):
    return f"{team}-{desk}"


def render_agent(recipe, desk, template):
    """One agent file's text. `template` is templates/desk.md."""
    name = agent_name(recipe["name"], desk["name"])
    ro = bool(desk.get("readOnly"))
    desc = (f"{desk['name']} desk of the {recipe['name']} team ({recipe['purpose']}). "
            + ("Read-only: no edit tools. " if ro else "") + f"Runs on {desk['model']}.")
    fm = ["---", f"name: {name}", f"description: {json.dumps(desc)}", f"model: {desk['model']}"]
    if ro:
        fm.append(f"disallowedTools: {NO_EDIT_TOOLS}")
    fm.append("---")
    subs = {"DESK": desk["name"], "TEAM": recipe["name"], "ROLE_LINE": READONLY_LINE if ro else EDIT_LINE}
    body = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: subs.get(m.group(1), m.group(0)), template).strip("\n")
    return "\n".join(fm) + "\n\n" + body + "\n"


def render(recipes, template):
    """{relative path: text} for every desk of every project-room recipe that has desks. Sorted by path when written."""
    files = {}
    for r in sorted(recipes, key=lambda r: r["name"]):
        if r.get("room") != "project" or not r.get("desks"):
            continue
        for d in r["desks"]:
            files[f"agents/{agent_name(r['name'], d['name'])}.md"] = render_agent(r, d, template)
    files[".claude-plugin/plugin.json"] = json.dumps(
        {"name": PLUGIN_NAME, "version": PLUGIN_VERSION,
         "description": "Desk agent types generated from the workspace's team recipes by `busybody kit build`. Do not edit by hand."},
        indent=2) + "\n"
    return files


def shape_problems(d):
    """Files in plugin dir `d` that are not .claude-plugin/plugin.json or agents/*.md (empty list = the shape is right)."""
    bad = []
    for base, dirs, names in os.walk(d):
        dirs.sort()
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(base, n), d)
            if rel != os.path.join(".claude-plugin", "plugin.json") and not (os.path.dirname(rel) == "agents" and n.endswith(".md")):
                bad.append(rel)
    return bad


def drift(d, files):
    """Problems between plugin dir `d` and the rendered `files` (empty list = no drift)."""
    out = [f"unexpected file {p}" for p in shape_problems(d)]
    for rel, text in sorted(files.items()):
        p = os.path.join(d, rel)
        if not os.path.isfile(p):
            out.append(f"missing {rel}")
        elif open(p).read() != text:
            out.append(f"{rel} differs from the recipe")
    for base, _, names in os.walk(os.path.join(d, "agents")):
        for n in sorted(names):
            rel = os.path.join("agents", n)
            if n.endswith(".md") and rel not in files:
                out.append(f"stale {rel}")
    return out
