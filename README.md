# Busybody

The office engine as a Claude Code plugin: the tools in `bin/` (`busybody <cmd>`), the skills in `skills/`, the templates, the docs in `docs/`, and the office band below.

Commands (`busybody <cmd>`): `init` (set up a workspace), `status`, `rooms`, `role`, `room-cost`, `room-cost-timer`, `team`, `land`, `pr-watch`, `handoff` (carry what GitHub cannot show across a compaction), `repo add <owner/name>` (import a child repo: clone, gitignore, one `office.json` entry, a CLAUDE.md stub; `--dry-run` writes nothing), `gh-usage`
(who spent the GitHub quota; `--install-help` shows how to enable the opt-in logging shim), `end-session <room>` (end a room's
session by its process). See `docs/design.md`; `CLAUDE.md` is the developer guide.

## The office band

The office inside Claude Code: the control room (the owner's whiteboard with
its sticky notes), the staff rooms, the project rooms (each with its room lead
at the head desk, at work or not), spend bars against the caps, the room
controls, and a one-line band above the prompt. Vocabulary:
see `docs/room-lifecycle.md`.

## Install

Busybody runs a **workspace**: one git repo, with its own GitHub repo, whose issues are the minutes. The engine is cloned inside the
workspace folder as `busybody/` (a Claude Code plugin can only load from inside its marketplace folder).

Needs: Claude Code, `git`, `python3`, `jq`, and `gh` logged in (`gh auth status`) with access to the workspace's GitHub repo.

1. **The GitHub repo.** Create `owner/name` with **Issues on** (a private repo is fine), or let `init` create it with `--create` (step 3).
2. **The folder, with the engine inside:**
   ```sh
   mkdir ~/work/acme-office && cd ~/work/acme-office
   git clone https://github.com/jwprichard/busybody.git busybody
   ```
3. **Init:**
   ```sh
   busybody/bin/init . --minutes-repo acme-co/acme-office --name Acme --engine busybody
   ```
   `--name` is the display name; `--create` makes the GitHub repo (private) when it does not exist; `--dry-run` prints what would be written. Nothing is pushed.
4. **Start Claude in the workspace and enable the plugin:**
   ```sh
   claude
   ```
   The plugin is enabled by the committed settings. If it does not load, run `/reload-plugins`. To install it from the published repo instead of the clone, use
   `/plugin install busybody --marketplace jwprichard/busybody`.
5. **Your first room.** Ask the controller (this session) for a piece of work: it opens an initiative issue and starts a room lead
   (`bin/busybody lead-start <repo> <slug> --controller <session name>`, or the band's Start room button). Add repos to `office.json`
   (`repos`, each with `branchPrefix` and `merge`) first; `docs/design.md` lists the fields. The shim is `bin/busybody` and is not on your PATH: run
   `bin/busybody help`, or add the workspace's `bin/` to your PATH.

### What init writes

Each item is skipped when it is already as wanted; a second run changes nothing and says so.
- `office.json` (never overwritten): the minutes repo, the workspace repo as the only repo (branches `feat/`, merged with `bin/land`), tracker `none`
- `bin/busybody`: a shim that runs the engine at its recorded absolute path (a plugin's root is not in Bash)
- `.claude-plugin/marketplace.json` (plugin source `./busybody`) and `.claude/settings.json` (committed, portable): `busybody@<folder>` enabled
  and a small `permissions.deny` (force pushes, `--no-verify`, setting `core.hooksPath`, `gh pr merge|ready`). Existing keys are kept.
  This machine's marketplace path goes into the gitignored `.claude/settings.local.json`.
- `.git/hooks/pre-push`: the seatbelt that stops a room worktree pushing the protected branches `office.json` lists for the workspace repo (`main`). Skipped
  with a note when `core.hooksPath` is set; an existing hook is chained
- `.gitignore` entries for the per-machine files and the `busybody/` clone, and `CLAUDE.md` from `templates/workspace-CLAUDE.md` when there is none
- `teams/dev-team` and `teams/mad` from `templates/teams`, each only when absent
- on GitHub, the `initiative` label on the minutes repo when it is missing (the one GitHub write besides `--create`)

### Update

`git -C busybody pull`, then `/reload-plugins` in the session. Re-run `init` after moving the clone (it rewrites the shim); it never overwrites your `office.json`, `CLAUDE.md` or teams.
On another machine, clone the workspace, clone the engine into `busybody/`, then re-run `init` (it adds this machine's `settings.local.json`).

### Troubleshooting

- **"issues are disabled on owner/name"**: init refuses until the repo's Settings, Features, Issues is on; the minutes are its issues.
- **"cannot reach owner/name"**: check the name and `gh auth status`, or pass `--create`.
- **"the engine ... is outside the workspace"**: clone it into the workspace folder (step 2) and pass `--engine busybody`; a link out of the folder fails at load.
- **"is inside another git repo"**: init never nests a workspace in another repo; pick a folder outside it.
- **"core.hooksPath is set"**: init leaves the hook out; copy `bin/lib/pre-push-seatbelt` into that hooks directory by hand.
- **Plugin not listed**: `claude plugin validate .` in the workspace, then `/reload-plugins`.

## Load it by hand

To load the engine for one session only (no workspace settings), from a folder holding `office.json`:

```sh
claude --plugin-dir busybody
```

Then type `/office`. The band finds the workspace by walking up from the
session's directory to the first folder with `office.json` (or `$BUSYBODY_WORKSPACE`), falling back to the
folder above the plugin. With none found it shows a warning and runs nothing.

Checks, from a clone of this repo (`.land-checks` is what CI runs on every PR, and what `bin/land` runs in a workspace that lands without PRs):

```sh
./.land-checks   # CI runs this; it has no Claude Code CLI, so the next two run only locally
claude plugin validate .
claude plugin test .
tsc -p .   # needs .claude-plugin/types/, which the engine lays at load (gitignored)
```

## What it shows

- **Band above the prompt:** `🏢 N rooms · M sticky notes · $X today`, where N
  counts active rooms only, then `✓ K done` when any room is finished, `R roles`
  (enabled roles), `📝 N memory to review` when any role has a pending memory
  diff, and `✋ needs input` / `⛔ capped` counts when any. Hidden when there are
  no rooms and no memory to review (roles alone don't open it). With memory to
  review but no rooms it reads `🏢 office · R roles · 📝 N memory to review`.
- **Header:** how many project rooms are at work, sticky notes for you, today's spend, and
  when the last refresh ran (or why it failed).
- **Control room (the owner's whiteboard):** every sticky note: an open DECISION
  with no later ANSWER, plus the memory reviews below. The question, numbered options and the recommendation are read from the
  comment; a comment without that shape is shown as written. Each one has a
  text field and **Send**, plus a preview of exactly what will be posted.
- **Staff rooms** (between the control room and the project rooms; initiative
  a standing role's issue): one fixed bordered head desk per **enabled role**, each a staff room (see
  `docs/room-lifecycle.md`; teams are not shown yet, and
  hot desks only as a spend line, because `bin/role` reports no per-worker data). Each desk has the role's sprite (`role:<name>` seeds it), then:
  - at work (green) when the role's transcripts moved in the last 5 minutes,
    else idle (blue); the border is purple while a memory diff waits
  - `pilot 1/6 uses · day 4/21` on probation, `kept` once kept
  - the goal, a memory bar against the 8 KB index cap (red at the cap, amber from
    80%, stale lines noted), a `$` bar against `budget_usd_month`, a hot desks (workers)
    line against `contractor_budget_usd_month`
  - last use, use count, card drafts approved / unedited
  - each `bin/role` flag as a `⚠` warning
  Disabled roles sit on a dim `DISABLED roles` shelf at the bottom of the
  section with their reason. If `bin/role` fails the section is empty and the
  control room says `staff rooms unavailable: <why>`; rooms are unaffected.
- **Memory reviews** (sticky notes of a second kind, in the control room under the decisions): one item per
  role with a pending memory diff, showing the yes/no items `bin/role batch <role>`
  prints (at most 5, each a PROMOTE, ARCHIVE or RESTORE; the overflow waits for
  the next pass). Each item has **yes** / **no**; two rating rows rate the
  drafts and the memory apart (`saved-time` / `useful` / `no-value`). The exact
  `Apply runs:` command is shown and changes with every choice: `bin/role accept
  <role> --expect <hash> --items <the yeses> --rating-draft R --rating-memory R`, or
  `bin/role reject` when every item is no (held-over items stay on disk either
  way). Items are shown whole, wrapped, never cut. With no memory items but
  candidates.md changes, Apply is ratings-only (`accept <role> --expect <hash>
  --rating-draft R --rating-memory R`). `--expect` is the `batch: <hash>` line
  of `bin/role batch`, so `bin/role` itself refuses a changed batch. **Apply** does nothing until every
  item is decided and both ratings are picked. It re-reads the batch first and
  runs nothing if the items moved (resolved elsewhere). The office has no
  accept or reject of its own: it only calls these `bin/role` commands, and
  never decides anything by itself. If `bin/role accept` is refused (the memory
  guard), its message is shown and the items stay.
- **PROJECT ROOMS: one bordered room per initiative:** room name, issue (the minutes), repo, and the room lead at the head desk as a
  sprite whose pose and colour follow its status:
  - working (green): typing, the screen scrolling code
  - idle (blue): leaning back with a coffee, the screen asleep
  - watching (cyan): idle, and its watcher is alive (`.claude/watch.json` in the
    room worktree names a running pid, probed read-only on each refresh): eyes on a PR screen
  - waiting (violet): the last minute is WAITING (`**WAITING** · who · where`, or the old
    `WAITING:`) but no watcher is alive, for example after a restart: asleep on the desk
  - needs input (amber): standing with a hand up and a `!` bubble
  - not running: an empty chair, the screen off
  - capped: red desk, blinking alarm lamp, bold red border

  Minutes are read in the new `**TYPE** · who · where` header (summary on the next line)
  and the old `TYPE:` form; a gone lead that is waiting or watched is not STALLED.

  Each desk also shows its **recipe and phase**, `dev-team · build`, dim after the model (its own line
  in the compact card). `bin/rooms` sends `team` (the Room block's `- team: <name>`, dev-team when
  absent), `phases` (from `teams/<team>/team.json`) and `phase`: the last valid `Phase: <name>` line in the
  room's own PROGRESS/WAITING minutes, else the last phase while a watcher is alive, else the first phase
  while the room has posted at most its first minute. Unknown shows `?`; with no recipe the label is hidden.

  Beside it: the last report line (verb, age, first line), the spend bar
  (filled to today's spend, `│` at the soft cap, `┃` at the hard cap; green,
  amber past soft, red past hard), the model mix, and a capped / needs-input /
  over-soft-cap warning.
- **Room state** (`roomDisplay` in `hooks/office/parse.ts`) comes from the room lead's
  status and the latest report verb together:
  - room lead gone **and** the latest report is `DONE` → **Done · awaiting
    merge/release**: no warning, moved to a dimmed, collapsed "DONE" shelf at
    the bottom of the pane with its `bin/status` line, the PR link and Issue/PR
    buttons only. It isn't counted as an active room.
  - room lead gone **without** a `DONE` → **not running**, with a `STALLED?`
    warning (read the minutes, then Resume).
  - capped → `⛔ CAPPED`; needs input → `✋ NEEDS INPUT`; a running room lead that
    already reported DONE shows `working · reported DONE`.
- **Graphics:** pixel-art sprites drawn with `Raster` (two pixels a cell) when
  the surface is the terminal and it reports true colour (`COLORTERM`,
  `TERM_PROGRAM`, `WT_SESSION`, `TERM`); coloured text-art otherwise (the
  desktop app, 256-colour terminals). The `sprites:` button cycles
  auto → pixel → text. Pixel sprites animate in place with `$.ui.blit` while
  the pane is open.
- **Layout:** two desks a row from 124 columns; one compact card per room
  (status glyph, report, bar, warning, short buttons) under 72 columns or with
  5+ rooms.
- **Console:** the output of the last command run, with Copy and Clear.

## What each button runs

Nothing mutating runs on its own: only a press runs a command, every command
is an argv run by `$.process.run`/`spawn` (no shell), and Stop, Resume and
Start room ask first ("Yes, run it" / "Cancel").

| Button | Runs | Asks first |
| --- | --- | --- |
| Send (sticky note) | `gh issue comment <issue> -R <minutes repo> --body 'ANSWER (from the user): "<exactly what you typed>"'`, then a link-only nudge to the room lead (below) | no: the press is the act; nothing typed sends nothing |
| ■ Stop | `claude stop <session id>`: the short id `claude agents --json` lists (`id`), else the full `sessionId`. `claude stop --help` takes `<id>`, not the room name. Disabled when neither id is known | yes |
| ▶ Resume | `claude --bg --resume <session-id> -n <room>` in the room's worktree. The session id comes from `claude agents --json`, or `claude agents --json --all` (read-only) for a stopped one. Refused for a capped room (it resumes only on a user turn that sets a new cap) and for a running one | yes |
| ⧉ Attach | nothing: shows `claude attach <room>` to copy and run in a terminal | n/a |
| # Issue | `gh issue view <issue> -R <minutes repo> --web` | no (opens a browser) |
| ⇡ PR | `gh pr view <n> -R <repo's github> --web`; the PR is found with `gh pr list -R <repo's github> --head <branch> --state all` (read-only). With no PR the button says so | no (opens a browser) |
| ＋ Start room → Preview (dry run) | `<engine>/bin/lead-start <repo> <slug> --liaison <name> --model <m> [--issue N] --dry-run` (mutates nothing) | no |
| ＋ Start room → Start room… | the same without `--dry-run`, output streamed into the console | yes |
| Apply (memory to review) | `<engine>/bin/role accept <role> --expect <hash> --items <yeses> --rating-draft <R> --rating-memory <R>`, or `bin/role reject <role> --expect <hash> --rating-draft <R> --rating-memory <R>` when every item is no; refuses to run until every item and both ratings are chosen | no: the exact command is shown above the button |
| ↻ Refresh | `<engine>/bin/rooms --json` | no (read-only) |

**The mod never generates or edits answer text.** `buildAnswer` in
`hooks/office/decisions.ts` wraps exactly what was typed (no trimming,
escaping or rewriting) and the tests assert it byte for byte, quotes and
newlines included.

**The nudge.** The Claude Code CLI has no `claude send` (checked `claude
--help` and `claude agents --help` on 2.1.290). The mod uses the plugin API's
`$.session.send`, which the types describe as "the event `session.send`, the
model's SendMessage tool's own call and delivery". Its `to` takes
`{ sessionId }` ("one of the person's own sessions … a session that is not
running now is not delivered to: the result says so") or SendMessage's own
spelling of a name. The mod addresses the room lead by its `sessionId` from
`claude agents --json`, or by the room name (the room lead's `-n` name) when the id
is unknown, and never sends to its own session (`$.session.id()`). The text is
link-only: `ANSWER <room>: <comment URL>`. If the room lead isn't running, the
answer is still posted and the result line says no nudge was sent.
`$.tool.call({ tool: 'SendMessage' })` would reach the same delivery but also
goes through the permission check and its dialog, so the mod doesn't use it.

**Staff-room passes.** A pass (`bin/role run`) has its own issue, titled `<role>: <task>` with
the role's pass label, and posts its DECISION there. `bin/rooms` lists those issues'
open DECISIONs (`decisions[]`, with `role`, `issue` = the pass issue, `room` =
`role-<role>-<slug of task>`) and the running session (`role_sessions[]`, `issue` = the pass
issue). The office posts the ANSWER to `decisions[].issue` and nudges the room by name, so
an answer on pass issue #95 reaches `role-scribe-refine-758` as
`ANSWER role-scribe-refine-758: .../issues/95#issuecomment-…`. DECISIONs still open on the
role issue (older passes, #9) are listed and answered the same way. The mod holds no
issue-number logic of its own.
Delivery to a live background room lead is not tested here: the tests mock
`session.send` underneath the mod.

**Start room and the tracker.** The room launcher has no card flag. With a tracker configured in `office.json`, a card URL that
matches its `cardUrlRegex` is accepted but not passed: the launcher opens a new initiative issue (`<tracker>: none yet`) and the
form tells you to add the card link to it. With no tracker, the field takes an issue number only. The repo list and its default
(the first repo) come from `office.json`, the pane title is its `displayName`, and answers go to its `minutesRepo`.
The controller session field (`--liaison`, env `$BUSYBODY_CONTROLLER`; the old `$SCH_LIAISON_SESSION` is still read) defaults to that variable.

## Refresh and cost

`$.clock` runs `bin/rooms --json` every 120 s through `$.process` (it folds in
`bin/role status --json` as `roles[]`, plus `totals.roles` and
`totals.memory_reviews`), `bin/role batch <role>` for each role with a pending
diff (read-only; skipped while an accept or reject runs; a changed batch drops your old yes/no), and a read-only `gh pr list`
per room at most every 2 minutes. No model turns, so
it's free. State lives in `$.state` (`office.*`, typed in `types/index.d.ts`).

## Files

```
.claude-plugin/plugin.json   manifest (types: ./types/index.d.ts)
hooks/hooks.json             { "modules": ["./register.tsx"] }
hooks/register.tsx           events, refresh, handlers and drawing
hooks/office/parse.ts        bin/rooms → OfficeDoc, band text, spend bar, layout (pure)
hooks/office/decisions.ts    sticky note (DECISION) parsing, ANSWER text and argv, nudge (pure)
hooks/office/roles.ts        role desk text, bars, batch parsing, settle argv, diff and failure text (pure)
hooks/office/commands.ts     button → command mapping, start form → lead-start argv (pure)
hooks/office/sprites.ts      pixel scenes, Raster packing, text-art, graphics detection (pure)
types/index.d.ts             the $.state contract
tests/logic.test.ts          pure modules: parsing, sticky notes, mapping, sprites
tests/office.test.ts         through the engine, with gh/claude mocked beneath the mod
tests/fixture.ts             a made-up bin/rooms document (issues 9001-9003, roles scribe/auditor/retired)
```

The tests mock every host command beneath the mod: nothing real runs, and no
test can post to a real issue or stop a real room.

## Contributing

This repo takes pull requests: branch `feat/`, `fix/` or `docs/` off `main`, atomic Conventional Commits, merge-commit merges, no force-pushes. The `checks` workflow runs `.land-checks` on each PR.
`bin/land` remains for workspaces that land without PRs.
