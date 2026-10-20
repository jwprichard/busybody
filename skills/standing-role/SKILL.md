---
name: standing-role
description: "Standing roles: memory-backed subagents that own an area over time (backlog owner, sprint owner, test lead, later non-dev roles). Covers consulting a role (guard check, spawn, relay, the controller's memory triage and value rating), building one (the interview: owned metric, budget, authority), the cost-vs-value review and culling, disabling and enabling. Use when the owner asks about an area a role owns, asks to build/hire, review, cull, disable or enable a role, or `role status --brief` prints a flag."
---

# Standing roles

A MAD-agreed design plus the owner's additions (cost tracking, build, disable). Tool: `busybody role --help`
(the engine's `role`; below, `role X` means that tool). **Review this playbook every two months.**

A role is a subagent definition, `.claude/agents/<role>.md` (the charter), with `memory: project`.
Its memory is `.claude/agent-memory/<role>/` in git. Its config is `roles/<role>/role.json`, and
`roles/<role>/product.md` holds the owner's goals. A role holds a head desk; a role with memory
has a staff room. Only the control room opens rooms. The role is spawned **only by the controller, on
demand**, and runs no standing process. A MAD gives an independent opinion, a worker or room lead delivers one
thing, and a role holds continuity: judgement shaped by history.

## 1. Consulting a role

Two shapes. **A quick question** (nothing to ask the owner, one answer back) is a subagent spawn,
steps 1-7 below. **A pass that needs the owner's answers** (for example a backlog owner's "refine card 756") runs as a
**role session**, section 1a: the role asks the owner itself and hears the answers, so the
controller is not a relay and nothing is lost to a debrief gap.

Do this when the owner asks about the role's area, or the role is due (its `cadence_days` flag).

1. **Guard:** run `role check`. If it fails, stop and tell the owner to run `role install-hook`.
2. **State:** run `role status <role>`.
   - If the role is disabled, don't spawn it.
   - If a memory diff is already waiting, resolve it first (step 5).
   - If `product.md` still says "NOT WRITTEN YET", say so. The role will answer without goals.
3. **Spawn** with the Agent tool:
   - `subagent_type: "<role>"`, which must equal the charter's `name`.
   - `model:` set to the `role.json` model.
   - Run it in the foreground.

   **Never** brief a `general-purpose` agent to play the role. Memory injection and cost
   attribution (`spawnedAgentType`) both depend on the role's own `subagent_type`.

   The prompt: the owner's question, today's date, and links to anything relevant (issue, card,
   PR). Don't paste state. The role reads `status`, issues and its sources itself.
   - If the role's area needs a metric number, run `roles/<role>/metric` (or the
     `role.json` metric command) and give it the output. The role never stores that number.
   - `.claude/agents/` is committed (holding a `README.txt`), so it exists at session start
     and new or edited charters load within seconds. If `subagent_type` doesn't resolve, the
     session predates the dir: restart it.
4. **Relay** the role's answer, its numbered **proposed edits**, and any **memory items** (at most 5 yes/no; a pass often has none).
   - At authority level 0, the owner applies edits. Don't apply them yourself unless the owner
     asks for that specific edit.
   - Never write to the tracker, email or messaging on the role's behalf without the owner's ask.
5. **Triage** (yours, the controller's; the owner does not review memory, owner 2026-10-20). Apply the pass's `MEMORY` minute with `role apply <role> <minute-url>`, then run `role triage <role>`:
   a candidate whose evidence is a recorded `ANSWER` minute is promoted at once (one use). Triage checks that the ANSWER is one of the candidate's issue's comments, headed by `office` or the controller (not the legacy `ANSWER (from the user)` form, which goes to the checklist), holds the quote (>= 15 characters, 3 words, verbatim, below the header) and follows a DECISION of the pass. Residual risk: a header name is only text, so a pass that can comment could impersonate `office`; the office flags other authors and your checklist is the backstop; a line marked `repo: <name>` is a repo lesson, so open a CLAUDE.md PR to that repo (nothing is promoted);
   every other candidate prints with the four-point checklist (non-derivable, checkable, cites its source, small): `role triage <role> --accept cN [--link URL2]` (one use) or `--drop cN`.
   For a promotion, archive or restore proposed by hand, `role batch <role>` shows the numbered yes/no items (a cap archive is merged into its promote or restore item; the rest wait for the next pass),
   with `batch: <hash>`: pass it as `--expect <hash>` to accept or reject, which refuses if the items changed since. You decide the items, the **draft** rating and the **memory** rating, each `saved-time` / `useful` / `no-value`.
   Then run one of:
   - `role accept <role> --expect HASH [--items 1,3] --rating-draft R --rating-memory R` (refuses if there is no memory diff — e.g. the owner already accepted it in the office; a use that learned nothing needs `--no-memory`). Add `--confirmed m1,m2 --contradicted m3` for the memory lines the pass cited: the role lists them in its `DONE:`. `role review` flags uses with no such record.
   - `role reject <role> --expect HASH [--redo] --rating-draft R --rating-memory R` (`--redo` restores without recording a use, when the role redoes the pass; plain `reject` keeps held-over items for the next `DONE:`)
   - On an owner contradiction of a `MEMORY.md` line: `role archive <role> mN --because <comment-url>` (commits at once, and works while only `candidates.md` differs).
   - Candidates are never shown as items: a role session proposes them in a `MEMORY` minute and you apply it with `role apply <role> <minute-url>` (one commit per line, through the guard; a line the guard refuses is skipped and reported).

   If the use produced drafts the owner approved (e.g. a backlog role's cards), add
   `--drafts approved=N,unedited=M` so the approved and unedited counts are derived from git.

   Then `git push`. Every use ends in exactly one `role(<role>): use N` commit, even when
   nothing was learned (the commit is empty then). That's how uses are counted.
   - **Only the controller** settles a memory diff (`apply`, `triage`, `accept`). A role session, another agent or a peer session
     can't, and you never edit a role's memory by hand.
   - If you notice a candidate that's derivable (card, PR or release state, versions,
     counts), drop it. That check is the checklist's "non-derivable", and the
     hook doesn't do it.
   - Diffs over 30 lines get truncated. Suggest reject: a use should change little.
6. **Narrative:** the role's issue (`role.json` `issue`) is its **personnel file**: hiring, a
   big call, a reshaped charter, review verdicts, and one `RECORD` line per pass linking the
   initiative issue it ran on. Pass minutes live on that issue and are not summarised back here. Use counts and ratings already live in git.
7. **Workers a role directs (subagent shape only):** a subagent role can't spawn agents, so you hire them, named
   **`<role>-c-<task>`** (e.g. `backlog-c-743`), with `model: "sonnet"`. `role cost`
   bills them to the role's worker line (`contractor_budget_usd_month`) by that name prefix,
   because named spawns are recorded as `spawnedAgentType: general-purpose`. An unnamed
   worker is billed to no role.

### 1a. Role sessions (`role run`)
`role run <role> --issue N "<task>" --controller <this session's name>` starts **one** background session,
`role-<role>-<slug>`, in the workspace checkout, working on initiative issue N (required). It is not a standing process: it ends when the pass
is done. `--dry-run --show-brief` previews it and launches nothing.
- **Guards** (it refuses): memory guard not installed, the role disabled, no `--issue N`. Passes of one role run in parallel.
- **Brief** (the engine's `templates/role-brief.md`): imports the charter and `MEMORY.md` itself, because
  `memory: project` is ignored for a session's main agent. Never brief a different agent to play the role.
- **A pass has no issue of its own**: its minutes (and cost line) land on the initiative issue N it was given. `role run`
  adds one `RECORD` line on the role issue linking N and the session. The minutes are evidence (an
  archive that memory lines, approvals and metrics link to), so don't copy them into the role issue.
- **Questions go to the owner directly.** The role posts one batched `DECISION` minute
  (`**DECISION** · <session> · #<initiative issue>` plus a one-line summary) on the **initiative issue** and nudges you with
  the link. The owner answers in the office (a sticky note from the initiative issue, addressed to the
  `role-<role>-<slug>` session, which nudges it; it posts `**ANSWER** · office · <the DECISION>`) or on GitHub as
  `ANSWER (from the user): "..."` (old form, still read). If the
  office nudge is blocked, nudge the session yourself: `SendMessage(to: "role-<role>-<slug>", message: "ANSWER: <comment URL>")`
  (see the workspace's `limitations/` for nudges blocked in auto mode). Relay the link only, never the answer.
- **Hearing the answers is the debrief.** The role proposes first sightings in one `MEMORY` minute on the initiative issue (it writes no memory file),
  then posts `DONE`. You run `role apply <role> <minute-url>` and promote on the charter's evidence rule. You don't re-send the answers.
- **Workers**: the role spawns its own, named `<role>-c-<task>`. Don't hire for it.
- **Cost**: billed by session name to the role's line (`role cost <role>`); its `<role>-c-*`
  workers to its worker line.
- **Memory triage**: the role's `MEMORY` minute is applied and triaged by you, step 5 as for a subagent. The role session never commits, accepts, applies or triages.
- **Authority** is still level 0. The session's settings deny git writes, `role accept`/`apply`, tracker
  writes and edits to the repo's own files, but only its charter stops a shell redirect: see the workspace's
  `limitations/` on role-session containment.
- Status: `claude agents` lists the session, `claude logs role-<role>-<slug>` shows it, and
  `claude stop <id>` ends it, with the short `id` from `claude agents --json` (the session name is not accepted). Don't leave one idle past the owner's answer.

## 2. Building a role (the interview)

Ask these one at a time, briefly. Refuse to create the role if (b) or (d) has no answer.
**No number, no role.**

- **(a) Outcome.** What does it own, in one sentence? It must be an area that is never
  finished ("the backlog is healthy"), not a deliverable. A deliverable is a room lead's job.
- **(b) The number.** Which number proves the area is healthy, and how is it computed
  **without a model**? Examples: a tracker CLI + `jq` script, or `gh` + `status`. It
  becomes the executable `roles/<role>/metric`, printing one line: score plus breakdown.
- **(c) Inputs.** What does it read? Read access only, unless the owner grants more. Prod
  reads need the owner's yes and go through a read-only path the workspace names.
- **(d) Budget.** USD per month. A good default for a Sonnet role used weekly is about $10–20.
  Check spend per use for similar agents with `role cost` and `room-cost`.
- **(e) Cadence.** How often it should be consulted, if ever (`--cadence-days`). Session start
  flags it when it's due.
- **(f) Model.** Sonnet by default. Opus only if the owner asks, and record why on the issue.

Then:
1. Run `role new <role> --goal "…" --metric-cmd roles/<role>/metric --metric-desc "…" --budget N [--cadence-days N]`.
   This writes the charter, `role.json`, the `product.md` stub and empty memory, and opens a
   `role`-labelled issue.
2. Write `roles/<role>/metric`, make it executable, and run it. It must work from
   `role`'s cwd (the workspace root), take no secrets, and be read-only.
3. Show the owner the charter. Tailor its Inputs and goal sections to the answers above. Keep
   the memory rules and the authority section as they are.
4. **The owner writes `product.md`.** It covers this quarter's goals, who the work is for, and what
   we're deliberately not doing. Offer to draft it from what they say, but they own it. If they
   can't fill half a page, that is a finding: the role has nothing to own yet.
5. Commit the scaffold to `main` (in the repo's commit style) and push.
6. Probation starts on the day the role is created: 3 weeks or 6 uses, whichever comes first.

## 3. Review, culling and authority

- **Session start** runs `role status --brief`, which prints only flagged roles. Raise
  each flag with the owner. A flag only reports; it never acts.
  - **Over budget, or 3 no-value uses in a row:** run `role review <role>` and ask
    the owner keep / reshape / disable.
  - **Pilot window over:** if the role has 3 or more uses, it's the keep / reshape / disable
    verdict. The kill test is whether the owner can name one time its memory saved time against
    a fresh session. With fewer than 3 uses, the pilot is inconclusive; extend it once by
    setting a new `pilot.start` in `role.json`, and commit.
  - **More than 20% stale memory:** spawn the role to re-confirm or prune, then review the
    diff as usual.
  - **Unused for 30 days:** ask whether it's still needed. An idle role costs nothing, but
    it also isn't earning its keep.
  - **Due (cadence):** offer to consult it.
- **Monthly review:** in the first session of a month, run `role review` for every role and
  give the owner one line each: cost against budget, uses, ratings, metric trend, flags.
- **Verdicts:**
  - `role keep <role>` ends probation.
  - Reshape: edit the charter or `role.json`, commit, and comment on the issue. A reshape
    restarts probation.
  - `role disable <role> <reason>` moves the charter to `.claude/agents.disabled/` and
    keeps the memory, frozen.
  - `role enable <role>` brings it back on probation.
  - Deleting a role (its memory and config) happens **only** on the owner's explicit ask.
- **Authority** goes up only by the owner's decision, one level at a time, after probation:
  - **Level 1:** reversible writes, such as labels, duplicate flags, acceptance-criteria
    drafts, and reordering below the top 10.
  - **Level 2:** reordering the top 10, and archive proposals applied.
  - **Never:** scope changes, or speaking for the owner.

  To raise it, set `authority` in `role.json` and the matching charter section, comment on
  the issue, and commit. Test that auto mode allows the write before relying on it; that's
  unverified for tracker writes.

## Limits (read before trusting the numbers)
- Cost leaves out the controller's own tokens and transcripts from other machines, so treat it as
  a floor: the workspace's `limitations/` on role cost.
- The memory guard covers git only, and `--no-verify` bypasses it. The real guard is the
  controller's triage: the workspace's `limitations/` on memory review.
- Only the controller starts a role (a subagent or `role run`). Room leads run in child-repo worktrees and don't load
  the workspace's agents.

## Facts this rests on (re-verify when reviewing)
- `memory: project` → `.claude/agent-memory/<name>/`. The first 200 lines or 25 KB of its
  `MEMORY.md` are injected. It is ignored under `--agent` (code.claude.com/docs/en/sub-agents).
- `subagent_type` must match the charter's `name`. `.claude/agents/` is watched live, except a
  dir created after the session started (sub-agents docs).
- In auto mode, `.md` files in a subagent memory dir are exempt from protected-path checks, in
  sessions not started with `--restricted` (permission-modes docs).
- Subagent `.meta.json` records `spawnedAgentType`. That was observed in this machine's
  transcripts on 2026-10-06, not documented.
