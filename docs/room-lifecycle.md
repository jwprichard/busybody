# Room lifecycle

How a Busybody room runs. Vocabulary: employees (roles and workers), rooms, teams, briefs, minutes (`**TYPE** · who · where`).
Status: **built** (see "Build"); deploy-evidence gating is deferred.

**Every room runs the same generic stages. Only the middle comes from the team.**

```
GENERIC                                TEAM (from its skill)                       GENERIC
Open → Kickoff (go/no-go) → ────────── the team's own phases ────────── → Close → Resolve → Review
```

## A team is a skill plus a config
| Part | Holds | Honoured by |
| --- | --- | --- |
| **Skill** (`teams/<name>/SKILL.md`) | **entry criteria**, **middle phases**, **output**, **done condition**, when to escalate, and how to read and record memory | the room's role, by judgement |
| **Config** (`teams/<name>/team.json`) | model per desk, permissions, caps, spawn depth, whether a worktree is needed, whether it may open a draft PR | the harness (room settings, cap timer, deny rules). The skill can't loosen them |

## Generic stages (every room)
| Stage | Who | What | Minute |
| --- | --- | --- | --- |
| **Open** | controller | Writes the **brief** (issue body) and opens the room from the team's recipe. Only the control room opens rooms | `NOTE` (scope) |
| **Kickoff** | role | Checks the brief against **the team's entry criteria only**: briefly, read-only, no workers. Never re-refines a Ready card or re-asks what the minutes already answered | `PROGRESS` plan; plan with A1…An; or a no-go `DECISION` saying exactly what's missing |
| *(team phases)* | role + workers | See the teams below | `PROGRESS`, `DECISION`, `BLOCKED`, `WAITING` |
| **Close** | role | Delivers **the team's output**, removes its worktrees, posts `DONE` (output, evidence links, cost line from `busybody room-cost`, retro), then **ends its own session** | `DONE` |
| **Resolve** | controller | Spot-checks the `DONE` against the team's done condition, closes the issue, and moves the room to the DONE shelf. It can reopen if the check fails | `RECORD` |
| **Review** | owner | The retro's sticky notes: a **procedure lesson for the whole team** becomes a proposed skill edit. A lesson about **the owner, or a technique one role uses in its own recurring work** (e.g. a faster tracker call) becomes role memory if it passes the three-test bar (the engine's `templates/role-charter.md`): first a candidate, then promoted on evidence, with the owner accepting the promotion | `ANSWER` |

- A no-go counts against the **brief**, so the no-go rate per team measures brief quality.
- "Better" is measured from data, never from the role's own claim: cost, no-go rate, vetoed
  assumptions, whether the verdict was used, rework after a build.

## Room statuses (the office, every room)
| Status | Means | Desk |
| --- | --- | --- |
| **working** | the role is in a turn | typing |
| **watching** | the role is idle and its **watcher is alive** (`.claude/watch.json`, pid running) | eyes on a PR screen |
| **waiting** | the last minute is `WAITING` but **no watcher is alive** (e.g. after a restart) | asleep. The timer wakes it |
| **idle** | idle, nothing pending | coffee |
| needs input / capped / done | as before | as before |

## Teams: middle phases, output, done
| Team | Entry criteria | Middle phases | Output | Done when |
| --- | --- | --- | --- | --- |
| **dev team** | a Ready card (goal, scope, done-when), the target repo | work → draft PR → watch | merged PR | **merged** (deploy evidence tracked separately by `status`; not a close gate for now) |
| **MAD** | question, options, what's decided, what the answer changes | brief → rounds (≤3, plus a tie-break) → verdict | verdict, every OBJECT verbatim, ≤3 open items | verdict posted |
| **research** | question, scope, form of the answer | plan → search → synthesise | report | report posted |
| **refine** (a backlog role) | a card named by the owner | read → draft → questions → final draft | an approved draft | owner approves |
| **visual POC** | target view, a perf budget | build → screenshots → the owner's look | branch + screenshots | landed with `busybody land` after the owner looks |

### The dev team in full
1. **Work.** Workers build and review. Atomic commits, the branch pushed.
2. **Draft PR.** The role opens a **draft**, which the room config allows. What a draft does or does not
   trigger is the workspace's `room.draftNote`. It posts a `DECISION`: "draft #N is green; promote
   when ready."
3. **Watch.** The role starts `busybody pr-watch #N` as a **background shell**: no model turns while waiting.
   - It wakes the role **only on an event**: promotion to ready, a CI result, a new review or
     comment, or the merge.
   - A CI failure or a review goes to a worker to fix; the push re-arms the watcher.
   - It runs **until merge** (or the PR closes), with a safety cap of **7 days**.
   - GitHub is checked every 60–120 s, about 30–60 API calls an hour.
   - While it runs, `.claude/watch.json` marks the room **watching**.
4. **Merged → Close.** The generic Close stage follows.

**Backstop.** The controller's 5-minute timer (the cap timer, no model turns) checks `WAITING` rooms
that have no live watcher. It restarts the watcher, or nudges the role, when their PR changes. So a
restart or a slept laptop never leaves a room stuck, which is the failure this avoids.

## Where control sits
| Layer | Covers |
| --- | --- |
| **Enforced by the harness** | permissions, caps, spawn depth, no direct push to `main` (only `busybody land`), no opening rooms (deny `claude --bg`, `bin/lead-start` and `busybody role run` in room settings) |
| **Trusted to the skill** | phases, entry criteria, when to escalate, output formats |
| **Checked by the controller** | spot-check at Resolve, cost from transcripts, the backstop timer |
| **Approved by the owner** | promoting and merging PRs, prod, schema, spend over the soft cap, scope, every skill or memory change |

## Delegated to the role
- **Opens draft PRs** for dev teams by default. The owner promotes them; no PR is opened ready.
- **Watches its PR to merge** and routes CI failures and reviews to workers.
- **Lands repos without PRs** (this workspace, local POCs) with **`busybody land <branch>`**. The script
  checks the branch sits directly on top of `main`, runs the repo's checks at every commit, stops
  on the first failure, and only then fast-forwards and pushes `main`. It's the only way a role
  moves `main`.
- **Closes itself:** it removes its worktrees, posts `DONE` and ends its session. The controller then
  resolves the issue.

## Build (built)
- `busybody pr-watch` and the `watch.json` marker.
- The backstop in the cap timer.
- `busybody land`.
- Draft-PR permission in the room config.
- Self-close.
- `busybody status` finding PRs by the room's branch.
- The minute header format and the `WAITING` / `NOTE` / `RECORD` types in the scripts, briefs and office.
- Office statuses watching / waiting.
- `teams/<name>/` for the dev team, MAD, refine, visual-poc and research (`busybody team check` validates them).
- `busybody rooms` and the office show each room's recipe and current phase (the `Phase:` line in its minutes).
- `busybody team start` (opens a recipe's room through the lead or role launcher), `busybody team powers` (the
  powers text in the launch brief) and `busybody team resolve` (the mechanical done check, read-only).
- CLAUDE.md: close at merge for now.

**Deferred:** prod-evidence gating at close (rooms close at merge for now; `busybody status` still tracks
deploys). Known gaps: `limitations/team-start-untested-live.md`.
