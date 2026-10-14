# Team recipes

Design of team recipes:
1. A recipe's desks are a **maximum**. The head leaves desks empty for small work.
2. A recipe changes **only through a retro's proposed skill edit** that the owner approves. Nothing
   changes on the fly.
3. The **done check is mechanical wherever possible.** The controller's Resolve runs it
   (`busybody team resolve`); it never relies only on the room's claim.
4. **One launcher, `busybody team start`.** `bin/lead-start` and `busybody role run` stay as working aliases.

A team is `teams/<name>/SKILL.md` (judgement: entry criteria, phases, output, done, escalation) plus
`teams/<name>/team.json` (what the harness reads and enforces). `busybody team check` validates every
recipe; the skill can never loosen the config. Lifecycle: `docs/room-lifecycle.md`.

## `team.json`

```jsonc
{
  "name": "dev-team",                       // = directory name = SKILL.md frontmatter `name`
  "purpose": "Take a Ready card to a merged PR",
  "room": "project",                        // project (room lead + worktree) | staff (a role's pass)
  "head": { "role": "room-lead", "model": "sonnet" },   // staff room: role = a roles/<role>/ name
  "desks": [                                // hot desks (workers). `max` is a ceiling, never a quota
    { "name": "implementer", "model": "sonnet", "max": 2 },
    { "name": "reviewer", "model": "opus", "max": 1, "readOnly": true }
  ],
  "entry": ["card has Ready label", "target repo named"],   // checked at Kickoff (go/no-go)
  "phases": ["work", "draft-pr", "watch"],  // the team's own middle phases, in order
  "output": "merged-pr",                    // verdict | merged-pr | ready-card | report | landed-branch | approved-design
  "done": { "check": "pr-merged" },         // mechanical check run by `busybody team resolve`
  "worktree": true,                         // the room gets a worktree
  "draftPr": true,                          // may `gh pr create --draft` (never ready, never merge)
  "land": false,                            // may `busybody land <branch>` (repos without PRs)
  "caps": { "softUsdPerDay": 15, "hardUsdPerDay": 40 },
  "measures": ["cost", "no-go", "rework", "review-rounds"]
  // optional: "designSystem": "https://…" (the design system's link), "canvas": {"type": "Design", "onePerCard": true},
  // and per desk "phase": "<one of phases>" (the phase the desk works in)
}
```

Rules `busybody team check` enforces:
- `name`, `purpose`, `room`, `head`, `desks`, `entry`, `phases`, `output`, `done`, `worktree`,
  `draftPr`, `land`, `caps`, `measures` all present and of the right type; no unknown keys other than the optional
  `designSystem` (an https URL) and `canvas` (`{type: string, onePerCard: bool}`). A desk may carry `phase`,
  which must be one of the recipe's `phases`.
- `room` is `project` or `staff`. A `staff` head names an existing `roles/<role>/role.json`; a `project`
  head is `room-lead`. A head's model is `sonnet` or `opus` (the launcher accepts only those); a desk's may also be `haiku`.
- Desk names are unique, `max` is a positive integer, `readOnly` (optional) is a boolean.
- `phases` and `entry` are non-empty lists of non-empty strings.
- `output` and `done.check` pair up: verdict → `verdict-posted`, merged-pr → `pr-merged`,
  ready-card → `ready-card`, report → `report-posted`, landed-branch → `landed`, approved-design →
  `card-has-design-link`.
- A recipe may open draft PRs only if `output` is `merged-pr`; it may land only if `output` is
  `landed-branch`. `soft <= hard`, both positive.
- `teams/<name>/SKILL.md` exists, and its frontmatter `name` equals `name`.

## Done checks (`busybody team resolve <initiative>`)

Reports pass or fail with the evidence it found. On a pass it also posts a `RECORD` minute (the check and its evidence link) and closes the issue as
completed, falling back to `gh api` where `gh issue close` errors (Projects classic). It never closes on a fail or undecided, an issue labelled
`project`, or one with open sub-issues (it says why and leaves it open); an already-closed issue passes with no second minute. `--no-close` skips
the minute and the close.
`--check NAME` overrides the recipe's check for a one-off. In a repo whose `merge` is `land` (no PRs) a recipe with `draftPr` is
checked as `landed`, not `pr-merged`, as `busybody team start` makes it land. Only a `DONE` minute whose "who" is
the room's name counts (an old-style `DONE:` never does); an issue with no Room block (a staff pass) needs
`--room NAME`. A `Report:` line needs a URL or a path that exists on the room's branch.

| Check | Passes when |
| --- | --- |
| `pr-merged` | the PR for the room's branch (found like `busybody status` does) is merged |
| `verdict-posted` | the room posted a `DONE` minute on the issue whose summary line starts `Verdict:` |
| `ready-card` | each tracker card named in the room's `DONE` minute has the approval label **and** a link to the owner's approval comment in its description |
| `report-posted` | the room posted a `DONE` minute with a `Report:` line holding a link (a doc in the repo or a comment) |
| `card-has-design-link` | each tracker card named in the room's `DONE` minute has a `Design:` line in its description with a claude.ai artifact link **and** a link to the owner's approval comment |
| `landed` | the room's branch has at least one commit of its own (its tip is not where it was created) and its tip is an ancestor of `main` (and of `origin/main` when a remote exists) |

## Powers in the brief

Whatever the recipe lets the room do is written into the launch brief itself, in the session's own
first user turn, so auto mode sees it there and not only in an issue comment (a block seen only in an issue comment is not enough).
`busybody team powers <recipe>` renders that text: draft PRs if `draftPr`, `busybody land` if `land`, how many desks
of which model, whether it has a worktree, the caps, and the standing prohibitions (no `gh pr ready`, no
merging, no opening rooms). The same flags decide the room settings' `allow` list.

## Desks as agent types (`busybody kit`)

A desk is a named agent type, so the room lead spawns it by name and the recipe's model and tools bind it, not the lead's memory of them.
`busybody kit build` writes `<workspace>/desks/`, a plugin named `desks` holding only `.claude-plugin/plugin.json` and one
`agents/<team>-<desk>.md` per desk of each project-room recipe (staff recipes and recipes with no desks are skipped). Each file has
`name`, `description` and the desk's `model`; a `readOnly` desk also gets `disallowedTools: Edit, Write, NotebookEdit`. That is "no
edit tools", not read-only: Bash stays, so the room's deny rules are still the real fence. The body is `templates/desk.md`.

- Commit `desks/`: the output is deterministic, so every desk change shows as a diff the owner reviews. Edit the recipe, never the agent file.
- `busybody kit check` (and `busybody team check`, whenever `desks/` exists) fails if `desks/` differs from the recipes, or holds any
  file other than those two kinds. A workspace that never ran `kit build` is unaffected.
- When `desks/` exists, `busybody lead-start` requires it to have that shape and to be clean in git, launches the room with
  `claude --plugin-dir <workspace>/desks`, denies `Edit` and `Write` on it in the room settings, and the brief names each desk as
  `subagent_type: "desks:<team>-<desk>"`. A plugin dir that grew `hooks/` or `.mcp.json` would run outside the deny rules, which is
  why the shape is checked at every launch.

### Skills on a desk

A desk may carry skills picked from a pinned source (`sources` in `office.json`, see `docs/design.md`). In `team.json`:

```json
{ "name": "implementer", "model": "sonnet", "max": 2,
  "skills": [ { "use": "<source>:<skill>", "at": "optional one-line heading text" } ] }
```

- `use` is `<source>:<skill>` (lower-case letters, digits, hyphens). A desk lists a `use` once. `at` is a non-empty single line.
- The skill is found at `<source dir>/skills/<skill>/`, else `<source dir>/<skill>/`. The folder needs a `SKILL.md`.
- `busybody team check` fails if the source is not listed in `office.json` or, when its clone is present, the skill is not in it. An absent clone only warns, so CI without clones passes.
- `busybody kit build` writes the skill's text into the desk's agent file, after the generic body: `## Skill: <skill> (<source>@<tag or short sha>)`, the `at` line, `SKILL.md` without its frontmatter, then each `references/*.md` under a `### <file>` heading. No plugin, hook or script is loaded: the text is all a desk gets.
- The build refuses, with one line and nothing written: a clone whose HEAD is not the pinned sha or whose tree is dirty; a missing or unreadable skill; any file in the skill folder other than `SKILL.md` and `references/*.md` (so no scripts, hooks, binaries, other file types or other subdirectories, and no symlinks); and any `SKILL.md` frontmatter key outside `name`, `description`, `license`, `argument-hint`, `disable-model-invocation` (so no `allowed-tools`, `hooks`, `context`, `agent`).
- `busybody kit check` regenerates the same way. When a clone it needs is absent it still requires the agent file to exist, skips only the comparison of that file's text and says so in a warning. A clone present but moved or dirty fails the check.
- Commit the generated `desks/`: a changed skill or pin shows up as a diff the owner reviews. Desks with no `skills` generate exactly as before.

## Phase

Each `PROGRESS` minute of a room may carry a `Phase: <name>` line in its body, where `<name>` is one of
the recipe's `phases`. The office shows each room desk's recipe and its current phase: the last valid
`Phase:` line, else inferred (a live `.claude/watch.json` means the last phase; no minutes yet means the
first).
