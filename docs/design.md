# Busybody design

The design of the engine as a plugin and of the workspace it serves. Decisions and dissent live in the engine's issues.

## Goal
Make the control-room tooling (rooms, teams, roles, minutes, the office mod) a generic **engine** anyone can install
as a Claude Code plugin and use for any set of repos.

## Two repos per user
- **The engine** (plugin repo): **Busybody**. Skills, hooks, templates, the office band, `bin/`, `init`. **Its issues are the
  engine's backlog**; room minutes stay in the workspace repo's issues. It ships the default team recipes (`templates/teams`: dev-team, mad), which `init` seeds, and never reads anything
  workspace-specific except through `office.json`.
- **The workspace repo**, one per user or organisation. **A setup requirement** : `init` creates it
  or adopts an existing one, and refuses if its issues are off.
  - Its issues are the minutes (initiatives, rooms, role issues).
  - The main (controller) session runs from it.
  - It holds everything workspace-specific: `office.json`, roles and their memory, `decisions/`, workspace
    `limitations/`, `evidence/`, the workspace `CLAUDE.md`, and the child repo clones (gitignored).

## Design (from the verdict)
1. **One plugin, one CLI.** A prefixed `office <cmd>` entrypoint. `init` writes a shim in the workspace that runs the
   engine at the path in `office.json`. Plugin `bin/` on PATH is a bonus, not the contract.
2. **Two roots.** ENGINE_ROOT = the script's own location. WORKSPACE_ROOT = `$BUSYBODY_WORKSPACE` (the old `OFFICE_WORKSPACE` is read as an alias), else walk up to
   `office.json`, else ENGINE_ROOT (today's behaviour). Every script now derives one root from its own path
   (`bin/team`, `rooms`, `room-cost`, `role`, `status`, `lead-start`, the cost lib), which a plugin install breaks.
3. **`office.json`:** `minutesRepo`, engine path, tracker, and per repo: path, branch prefix, commit style, checks,
   evidence.
4. **Tracker adapter (thin):** card-URL regex, `get <url>` → title / description / labels, write-deny and
   authority-level allow patterns. A card tracker spells out its keys; `none` (the default) turns card done-checks off.
5. **Deploy evidence:** an executable per repo, `evidence/<repo> <sha>` → PASS / WAIT / FAIL plus a reason. The
   default when none is named is "PR merged". A workspace's own deploy rules (release tags, apply runs) live in its `evidence/`.
6. **Safety at the top level:** plugin settings can't carry deny rules, so `init` writes the project-scope deny rules,
   env, hooks, `enabledPlugins` and the pre-push hook. Per-room seatbelts stay in `lead-start`.
7. **Two `CLAUDE.md` files:** a plugin's own `CLAUDE.md` is not loaded in a workspace, and nothing is injected at SessionStart. `CLAUDE.md` in this
   repo is the developer guide for working on the engine. `templates/workspace-CLAUDE.md` is the generic "using the tool" guide: `init` writes it into a
   new workspace (display name substituted, only when there is none) and the workspace then owns it.
8. **State layer:** issues stay
   the record. Every reader goes through one `minutes` client in the engine. Writes are `gh issue comment`, with no
   mirror. Reads are REST from a shared `.cache/`: the open `initiative` issue list (dropping items with a
   `pull_request` key) and one repo-wide `issues/comments?since=` feed, both with ETags, so 304s cost nothing
   against the primary limit. Advance `since=` only after a 200. Refetch an issue when its comment count shrinks,
   and at least daily (the feed misses deletions). On any error, serve the last good data marked stale, never
   empty. Single-flight, honour `retry-after`. No local log.
   Built as `bin/lib/minutes.py`; `bin/rooms` reads through it and caches its whole `--json` document for 60 s in
   `.cache/rooms.json` (served stale if a rebuild fails). Errors and `retry-after` go to stderr and `.cache/minutes-errors.log`.
   `bin/status` and `bin/room-cost` still call `gh` directly.
9. **Local use:** a workspace may use an unpinned directory marketplace on a local clone of the engine, so an edit is live after
   `/reload-plugins`; pinning a tag is the fallback if engine `main` breaks. Other installers pin a version.

## Which workspace a script sees
`WORKSPACE_ROOT` is `$BUSYBODY_WORKSPACE`, else the nearest parent of the cwd holding `office.json`, else the engine root. A
worktree of the workspace repo holds its own `office.json`, so a script run from inside that worktree treats the worktree as
the workspace: it sees the worktree's roles, `.cache` and clones (none), not the real workspace's. Room worktrees should
either set `BUSYBODY_WORKSPACE` to the real workspace or call their own worktree's `bin/` knowing it is a self-contained copy.
No code enforces this.

## Caches and worktrees
`.cache/` belongs to the workspace root. A session in a worktree of the workspace repo gets the worktree's own `.cache` (a cold
start: no minutes cache, no capped marks, no queued posts) unless `BUSYBODY_WORKSPACE` points at the real workspace. The cap
backstop and the office read the real workspace's `.cache`, so set `BUSYBODY_WORKSPACE` for anything that should share state. No
code enforces this. `bin/rooms --json --fresh` skips the 60 s document cache and the minutes client's 10 s reuse; the office
mod passes it after an answer, a command or the Refresh button. The document's `minutes` field (`stale`, `age_s`) says when the
GitHub reads behind it were served from cache.

## Deploy evidence contract
`bin/status` asks one executable per repo whether a merged PR has reached production: `evidence/<name>` in the workspace,
where `<name>` is the repo's `evidence` in `office.json`. A repo that names none uses the default, "PR merged" (a merged PR
is done). A repo absent from `office.json` falls back to an executable `evidence/<repo>` if one exists, else it has no rule.
- **Call:** `evidence/<name> <merge-sha>`, run with no cwd guarantee. Environment:
  `BUSYBODY_ENGINE` (engine root; `bin/lib/evidencelib.sh` has `is_ancestor`, `last_success_sha`, `pass`, `wait_for`, `fail`),
  `BUSYBODY_WORKSPACE`, `BUSYBODY_REPO` (name), `BUSYBODY_GITHUB` (owner/name), `BUSYBODY_REPO_DIR` (the clone, already fetched),
  `BUSYBODY_HEAD_SHA` (the PR head) and `BUSYBODY_PR_FILES` (changed paths, one per line). `bin/status` exports the old
  `OFFICE_*` names with the same values, so older executables keep working; `evidencelib.sh` reads either.
- **Stdout:** line 1 is `PASS <what proves it>`, `WAIT <what is missing>` or `FAIL <why it will not arrive>`. A `WAIT` may add
  a second line `has: <what is already proven>`. Anything after that is ignored.
- **Exit code:** 0 with PASS, 1 with WAIT, 2 with FAIL. Any other exit, a verdict that does not match the exit code, or no
  output is reported as "gave no verdict (exit N)" and counts as not deployed.
- **Timeout:** `bin/status` stops the executable after 90 seconds (`BUSYBODY_EVIDENCE_TIMEOUT`, or the old `OFFICE_EVIDENCE_TIMEOUT`) and kills it 5 seconds later, exit 124, no
  verdict. A bare `PASS` or `WAIT` with no reason reads as "no reason given".
- **Stderr:** diagnostics only. `bin/status` discards it, so run the executable by hand to see it.
- **Effect:** PASS makes the step deployed. WAIT and FAIL both leave it merged and not deployed; FAIL is wording, so a
  reader can tell "waiting" from "ran and failed". The executable never writes anything outside its own temp files.
- **Offline test:** `bin/status --self-test` runs every rule against a stub `gh` and throwaway clones and compares the output
  with `fixtures/status/expected.txt`, which was generated by the rules as they were in `bin/status` before they moved.

## Tracker config
`office.json` `tracker` names the card tracker; `bin/lib/tracker.py` is the adapter. Absent or silent, the default is `none`
; the engine fills in nothing for a named type, so a tracker spells out its keys. Keys:
- `type`: `none`, or a tracker name. A type other than `none` needs `cardUrlRegex` and `get`.
- `cardUrlRegex`: finds card URLs in a minute; the first group is the card id.
- `get`: a command template (`{id}`, `{url}`) that prints one JSON object, either the `{name, desc, labels: [{name}]}` shape card trackers use or
  `{title, description, labels: [name]}`. `$TEAM_TRACKER` (or the old `$TEAM_TRELLO`) replaces the command's first word (a test hook only).
- `writeDeny`: the tracker's write patterns, denied to every role session. They expand in place of
  `{{tracker.writeDeny}}` in `templates/role-settings.json`.
- `authorityAllow.<level>`: `undeny` (patterns lifted) and `allow` (patterns added) at that authority level.
- `templates/room-settings.json` holds no tracker pattern, so room settings and the launcher need nothing.
- **`none`:** no write-deny, no authority patterns, and the card done-checks (`ready-card`, `card-has-design-link`) PASS with
  the note "tracker is none, so the card is not checked". They still need a DONE minute from the room.

## Config: no built-in defaults
`bin/lib/officeconfig.py` and `.sh` hold no org, minutes repo, repo list or tracker. A missing `minutesRepo` stops every script
with "no minutesRepo: run `busybody init`". The workspace repo is named after its folder, and the repo list defaults to just that
repo. Environment: `BUSYBODY_CONFIG`, `BUSYBODY_WORKSPACE`, `BUSYBODY_CONTROLLER` and the test hooks
`BUSYBODY_ROLE_WS`, `BUSYBODY_ROLE_AGENTS_JSON`, `BUSYBODY_CLAUDE_PROJECTS`; the earlier `OFFICE_*` names (and `SCH_LIAISON_SESSION`, `SCH_ROLE_WS`, `SCH_ROLE_AGENTS_JSON`, `SCH_CLAUDE_PROJECTS`) are read as aliases.
Fields the launcher and the briefs read, from the config:
- `repos.<name>`: `branchPrefix` (required; `""` is allowed), `noPush` (extra protected branches; `main` is always protected),
  `merge` (`"pr"`: draft PRs the owner merges; `"land"`: no PRs, `bin/land` fast-forwards and pushes), optional `doneNote`.
- `room`: `env` (set in every room, may be empty), `deny` (patterns tied to the workspace's own tools), `prodRead` (lifted only by
  `--prod-read`), `portBase` (default 41000), optional `draftNote` (closes the powers' draft-PR line).
- `ownerOnly`: what only the owner may do (default: anything touching prod, merging, spending over the cap).
- CLI for launchers: `python3 -I bin/lib/officeconfig.py get <repo> branchPrefix|noPush|merge|doneNote|github`, `room-json`,
  `owner-only`, `repos`, `check`. Bash twins: `office_branch_prefix`, `office_no_push`, `office_merge`, `office_done_note`,
  `office_room_json`, `office_port_base`, `office_owner_only`, `office_repos`.
Each script's `--self-test` re-runs on `fixtures/office.json` (acme), never the workspace's own config; a workspace tests its own config itself.

## GitHub use (what costs quota, and who pays)
- **One document, one PR cache.** `bin/rooms --json` is built once per 60 s for every viewer (`.cache/rooms.json`). Each room's PR
  comes from `.cache/room-prs.json` (`lib/prcache.py`): one `gh pr list` per branch per ten minutes, none for a repo with no GitHub
  remote, and a failed lookup is remembered (with the last known PR). The band reads `pr` and `pr_checked_at` from the document and
  never calls gh for a PR. `bin/room-cost --enforce` reads its PR from the same cache.
- **One cache per workspace.** A worktree of the workspace repo with no clones of its own uses the main checkout's `.cache/` and
  clones (`data_root` / `DATA_ROOT`); an explicit `BUSYBODY_WORKSPACE` is used as given. The cron and systemd timers set it.
- **Lighter watchers.** `bin/pr-watch` polls every 240 s (`BUSYBODY_PR_WATCH_INTERVAL`, use 180-300) with the light fields only
  (state, draft, url, updatedAt, check rollup); reviews and comments are fetched only when `updatedAt` moved.
- **Seeing it.** `bin/gh-wrapper` is an opt-in `gh` shim: the owner puts a `gh` symlink to it ahead of the real gh on PATH
  (`busybody gh-usage --install-help` prints the commands and runs nothing). Each call appends one JSON line to
  `.cache/gh-usage/YYYY-MM-DD.jsonl` (argv with values after body/field/input/header flags and token-looking arguments redacted,
  never output; GraphQL or REST; exit code; duration; 304 when stderr says so; the session or room from `-n <name>` in the process
  tree; the script; the cwd), 7 days kept, local only. `busybody gh-usage [--since 1h]` reports GraphQL vs REST, failures, retries
  and the top callers by session and script. Points are an estimate (1 per GraphQL call, one more per 100 items asked for); the
  document's `gh_usage` carries the hour's estimate and the band warns past 70% of 5000.

## Ending a session
`claude stop <room>` can report "No job matching" for a session that is still running, and sessions of closed rooms can come back
after the background daemon restarts. `lib/sessions.py` matches the room's process by its own command line (the claude binary
with the exact `-n <name>`; never a prefix), sends SIGTERM, waits (default 10 s) and sends SIGKILL only to a process that ignores
TERM, saying so. `busybody end-session <name>` runs it. `bin/team resolve <issue> --close` runs `claude stop` and then the same
after a PASS (plain `resolve` stays read-only). `bin/rooms --leftovers`, run from the SessionStart hook, lists live `room-*` and
`role-*` sessions that no open issue accounts for (from the cached document, with no per-room gh call), each with its
`busybody end-session` command. It offers; it never ends anything itself.
