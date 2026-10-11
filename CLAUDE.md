# Busybody: developer guide

For Claude working ON the engine (the tools, hooks, skills and templates). If you are running a workspace with it, read the
workspace's own `CLAUDE.md` instead; `templates/workspace-CLAUDE.md` is what `busybody init` gives a new one.

Busybody is a Claude Code plugin plus a set of bash and python tools (`busybody <cmd>`) that run an "office" of Claude sessions
(rooms) around GitHub issues. It is generic: it holds no organisation, repo name or tracker. All of that comes from the
workspace's `office.json`.

## Layout

```
.claude-plugin/              plugin.json (the manifest) and marketplace.json (so the repo itself installs: /plugin install busybody --marketplace jwprichard/busybody)
.land-checks                 what bin/land runs at every commit: the self-tests, the default recipes, the plugin checks
bin/                         the tools, each executable and each with a --self-test; `busybody <cmd>` runs bin/<cmd>
  busybody                   the dispatcher (lists every executable in bin/)
  init                       sets up a workspace folder
  rooms role status room-cost room-cost-timer team land pr-watch lead-start end-session gh-usage gh-wrapper handoff repo
  lib/                       shared helpers: officeroot.{sh,py} (finding roots), officeconfig.{sh,py} (office.json),
                             minutes.py (the cached issue reader), tracker.py, costlib.py, prcache.py, sessions.py,
                             evidencelib.sh, pre-push-seatbelt (hook template), role-memory-check, pre-commit-role-memory
hooks/                       hooks.json (SessionStart) and the TypeScript office band (hooks/office, register.tsx)
skills/                      debate-panel, standing-role, workstream-lead: judgement the tools cannot hold
templates/                   lead-brief.md, role-*.md, room-settings.json, prices.json, workspace-CLAUDE.md, teams/ (default recipes init seeds)
fixtures/                    test data: office.json (a made-up "acme" workspace), roles/, rooms/, room-cost/, teams/
tests/                       bun tests for the office band (logic.test.ts, office.test.ts)
docs/                        design.md, room-lifecycle.md, team-recipes.md
types/                       type declarations for the band; .claude-plugin/types/ is laid at load and gitignored
```

## Two roots

Every script derives two roots, and mixing them up is the commonest bug:
- **ENGINE_ROOT**: the script's own location (`$(dirname "$0")/..`). Templates, `bin/lib`, skills.
- **WORKSPACE_ROOT**: `$BUSYBODY_WORKSPACE`, else the nearest parent of the cwd holding `office.json`, else ENGINE_ROOT. Roles,
  `.cache/`, `office.json`, `teams/`, `evidence/`, the child repo clones.

Bash: `. "$ENGINE_ROOT/bin/lib/officeroot.sh"` sets WORKSPACE_ROOT and DATA_ROOT. Python: `officeroot.py`. `$CLAUDE_PLUGIN_ROOT`
is not set in Bash, so never rely on it; `busybody init` writes a shim at `<workspace>/bin/busybody` with the engine's absolute path (the engine is a clone inside the workspace: a plugin cannot load from outside its marketplace).
A worktree of the workspace repo holds its own `office.json` and so counts as a workspace; `DATA_ROOT` falls back to the main checkout's clones and `.cache`.

## Conventions

- **No literals.** No organisation, repo name, host, account id, board or product name in code, templates, fixtures or docs. Repo names, GitHub slugs,
  the minutes repo, branch prefixes, protected branches, merge mode, tracker and room rules come from `office.json` through `officeconfig`
  (`office_*` functions in bash, `Office` in python). A missing required field stops the script with one line a person can act on.
- **Environment:** `BUSYBODY_WORKSPACE`, `BUSYBODY_CONFIG`, `BUSYBODY_CONTROLLER`, and the test hooks `BUSYBODY_ROLE_WS`,
  `BUSYBODY_ROLE_AGENTS_JSON`, `BUSYBODY_CLAUDE_PROJECTS`. The old `OFFICE_*` and `SCH_*` names are read as aliases through `bb_env`; new names are `BUSYBODY_*` only.
- **State is GitHub issues.** Readers go through `lib/minutes.py` (cached REST reads with ETags, stale on error, never empty). Tools never
  keep their own status files; nothing parses issue comments for state.
- **Link, don't paste.** Nothing the engine writes (issue comments, briefs, fixtures) carries secrets, hostnames, account ids, customer data or pasted logs.
- **Style:** bash with `set -euo pipefail` and `die`/`say` helpers, python through `python3 -I` for helpers; match the neighbouring script (comment density, flags, `usage` from the header comment).
- **Safety is layered:** per-room deny rules and the pre-push hook come from `lead-start` and `templates/room-settings.json`; the top-level ones from `init`. Deny rules beat allow rules. A new tool a room must not run needs a deny line.
- **Commits:** Conventional Commits (`feat(init): ...`), one logical change each, every commit building and passing on its own, ordered to keep the tree green. Never rewrite pushed history.

## Testing

Each tool tests itself offline with stub `gh` and scratch repos; none of them reads the real workspace's `office.json`.

```sh
for s in init rooms role room-cost pr-watch land status handoff repo; do bin/$s --self-test; done   # per-tool self-tests (.land-checks runs them all)
bin/team check                          # every team recipe (team.json) is sound
python3 -I bin/lib/officeconfig.py --self-test
claude plugin validate .                # the manifest
claude plugin test .                    # bun tests in tests/ (the band's logic)
```

- Self-tests run against `fixtures/office.json` (acme) with `BUSYBODY_CONFIG`/`BUSYBODY_WORKSPACE` pointed at scratch dirs. A new config field means updating that fixture and `officeconfig.py --self-test`.
- A workspace's own rules (its evidence executables, its real config) are tested by the workspace, e.g. a `tests/*-selftest` there, not here.
- A new tool: executable, a header comment that `--help` prints (init, land and lead-start print their own lines 2-5), a `--self-test` that is offline and cleans its temp dir, the tool added to the loop in `.land-checks`, and a line in `README.md`.
- Do not mock what a scratch git repo can do for real (land, init and the hook tests use real repos and a bare remote).

## Landing a change

The engine repo takes pull requests (owner, 2026-10-10). Branch `feat/`, `fix/` or `docs/` off `main`, atomic Conventional Commits, and open a PR; run `./.land-checks`,
`claude plugin validate .` and `claude plugin test .` first. The `checks` workflow (`.github/workflows/checks.yml`) runs `.land-checks` on every PR and push to `main`; it
has no Claude Code CLI, so the two plugin checks run only locally. The owner (or the controller on their say-so) merges with a merge commit. Never force-push or rewrite pushed history, and never push `main` by hand from a room (the pre-push seatbelt refuses).
`bin/land` stays as a tool for workspaces that use the `land` merge mode; the engine itself no longer changes that way. Edits hot-reload in a workspace that loads the plugin in place (`/reload-plugins`).
When a change touches how a workspace is set up (`office.json` fields, `init`, `templates/workspace-CLAUDE.md`), say so in the commit body: existing workspaces do not update themselves.
