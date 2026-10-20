# {{DISPLAY_NAME}} workspace (control room)

This folder is {{DISPLAY_NAME}}'s workspace: a git repo that runs the Busybody office engine. A session started here is the
**control room**, headed by the **controller**. It plans work, dispatches per-repo work to workers (subagents) and room leads, and
sequences merges and deploys. Repo-specific conventions live in each repo's own `CLAUDE.md`, which is the authority for work inside it.
The engine's tools run as `bin/busybody <cmd>` (the shim `init` wrote; `bin/busybody help` lists them; `busybody <cmd>` also works from any folder here when `~/.local/bin` is on your PATH); settings are in `office.json`.

Sections marked **(yours)** are for you to fill in or change. Everything else is the engine's generic operating model; edit it only to tighten it for your workspace.

## State and memory

> **Link, don't paste.** Issue comments, decision files and initiative bodies never contain secrets, connection strings,
> hostnames, account IDs, customer data or pasted logs. Link to the PR, run or card instead. No hook can scan issue comments: this rule is the only guard.

- **There is no hand-maintained status.** `bin/busybody status` is the authority for what has shipped. Run it before any sequencing
  decision. A step counts only with **deploy evidence** (per repo, `office.json` names an evidence rule; the default is "PR merged").
- **One GitHub issue per initiative** in the minutes repo (`office.json`'s `minutesRepo`), label `initiative`. Body = goal, tracker link,
  ordered `## Steps` with PR links. Steps are never ticked or annotated by hand. Owner = assignee; blocked = `blocked` label with the
  reason in a comment. Comments are narrative only (progress, handoffs): nothing reads state from them. Close the issue at merge.
- **Open the issue at intake, not later.** When the owner hands over anything that spans repos, takes more than one session, waits on
  something external (a device test, an approval, a person) or produces decisions worth keeping, create the initiative issue before any
  agent starts; its first comment records the findings and dissent. A single-session, single-repo change doesn't need one: its PR is the record.
  `bin/busybody lead-start` does this automatically for room leads.
- **Roles** (`busybody:standing-role` skill) are the one place agents keep memory, and only non-derivable knowledge, in git, triaged
  by the controller (an owner `ANSWER` quoted as evidence promotes a line; repo lessons go to that repo's CLAUDE.md). When the owner asks about an area a role owns, consult the role rather than answering cold. Its uses,
  ratings and cost are derived (`bin/busybody role`); its HR record is its `role`-labelled issue.
- **Decisions** start as an issue comment. Promote to `decisions/` only when it should govern work after the initiative closes; the file links the comment rather than copying it.
- **Many short sessions, not one long one.** Everything a session needs is in GitHub, this repo and `bin/busybody status`. Don't keep initiative status in auto-memory.
- **Record design limitations as you hit them.** When the tracking design can't see, verify or prevent something, add a file to `limitations/` (what, why it matters, the workaround) instead of silently working around it. Check there first before assuming `bin/busybody status` covers a case.

## Orchestration rules

- **Read the target repo's `CLAUDE.md` before acting in it**, and brief every worker to do the same. A repo's `.claude/` (agents, skills, hooks) does not load from this folder: to use them, run a session with that repo as the cwd.
- **Workers (subagents) run on a mid-tier model by default** (`model: "sonnet"` on every Agent call). Use the top model only for the desks the table below names (MAD skeptic, prod reviewer, planner) or when the owner asks, and say why in the spawn. Never fork for cheap work: forks inherit the controller's model.
- **Only the control room opens rooms.** A room lead or role that needs another room (a MAD on a design question, a research team) asks with a sticky note (`DECISION:`); the controller decides and opens it.
- **One repo per worker.** Give it the absolute path of the repo and keep its edits inside that repo. Cross-repo coordination stays with the controller.
- **Worktree isolation is per repo.** Never pass `isolation: "worktree"` from here: it makes a worktree of *this* repo, which contains none of the gitignored child clones. Have the worker create a worktree inside its target repo.
- **Atomic commits, in every child repo.** One logical change per commit; each commit builds and passes on its own; commits are ordered to keep the tree green; no "everything" commits. Put this in every worker and room lead brief; reviewers check `git log origin/main..HEAD` and flag mixed or non-building commits. Unpushed local history may be reshaped; once pushed it is never rewritten.
- **Merging and promoting are the owner's.** A room opens PRs as drafts by default (pre-authorised). Marking ready, merging, pushing a protected branch and force-pushing stay the owner's, never without an explicit ask. `office.json` lists each repo's protected branches and merge mode.
- **Repos without PRs** (this workspace, local experiments; `merge: "land"`): a role lands its branch with **`bin/busybody land <branch>`**, the only way a role moves `main`. It checks the branch sits directly on `main`, runs the repo's checks at every commit, stops on the first failure, then fast-forwards and pushes. The controller may still commit straight to `main`. Never force-push.
- **Room lifecycle** (the engine's `docs/room-lifecycle.md`). Every room runs Open, Kickoff, the team's own phases, Close, Resolve, Review. A team is `teams/<name>/SKILL.md` (phases, output, done) plus `team.json` (the caps the harness enforces). Minutes use the header `**TYPE** · who · where`. Delegated to the room's role: opening draft PRs, watching its PR to merge with `bin/busybody pr-watch` (background, no model turns), landing no-PR repos with `bin/busybody land`, and closing itself (removes its worktrees, posts `DONE`, ends its session); the controller resolves.
- **Sequence cross-repo changes provider-first:** the repo that provides a resource first, deployed; then the consumer; removals in reverse (stop using it, then delete it). Put the order in the initiative's `## Steps` and run `bin/busybody status` before each next step.
- **Prod infra and prod data:** read freely, never mutate without an explicit ask. Rooms never run mutating cloud commands or push protected branches; `office.json` (`room.deny`, `repos.*.noPush`) denies them in every room's settings.

## Who to spin up: employees, teams, rooms

**Terminology.** Everyone is an **employee**: a **role** or a **worker**.
- A **role** holds a head desk, a room's main Claude instance. It may have git-backed memory (the controller triages every proposal), and only a role can raise a decision. Examples: the **controller**, the **room lead**, a standing role such as an analyst.
- A **worker** is a subagent on a hot desk (dev, tester, reviewer, skeptic, explorer). It has no memory and reports only to its own room's role.
- A **team** is a named recipe for a room: which desks, on which models, how they work, what counts as done, the default caps ("a MAD", "a dev team"). The recipe is not a group of agents; the room is the running instance.
- **Rooms** are sessions: the **control room** (head: the controller), a **staff room** (a role with memory) and a **project room** (headed by a room lead, one initiative, a worktree of one repo).
- The **owner** is the user, the only one who signs the minutes. An **initiative** is a piece of work; its **minutes** are its GitHub issue. A **whiteboard** is a room's live conversation. A **sticky note** is a question for the owner (a `DECISION:` with no `ANSWER`).

**How work flows.** The top level (the owner, the controller and any standing role) decides **what** and makes it ready. Once building
starts, anything more than a small task, or anything with more than one PR, goes to a room lead, who hires its workers and runs dev, review, CI and PR shepherding through to deploy evidence. The controller and the owner hear only `DECISION`, `BLOCKED` and `DONE`. The controller never coordinates a team itself: relaying workers' reports fills the context the top level needs. A room returns one thing: a verdict (MAD), DONE with evidence (dev team) or a draft, with a cost line.

Ask "why not do it myself?" before every spawn: a worker costs about 4x the tokens of doing it inline, a MAD or dev team about 15x. Follow-ups on a worker's task go back to the same worker. Pick the smallest shape that fits:

| Situation | Shape | Who |
| --- | --- | --- |
| Known file, small edit, one lookup | Controller alone | none |
| **Small** well-specified fix in one repo: one PR, one worker, done in a sitting | One worker (hot desk), in a worktree inside that repo | Mid-tier implementer; top-tier read-only reviewer after, if it ships to prod |
| Broad independent reads (survey N repos or dirs) | Parallel workers, one scope each | Mid-tier (smallest model for pure grep, count, summarise) |
| Contested decision that's costly to reverse (architecture, tracking design, repo split, cross-repo sequencing) | A **MAD** team: run the `busybody:debate-panel` skill | Skeptic (top tier), fact-checker and alternatives (mid-tier) |
| Same-file edits or tightly coupled code | One worker, never parallel | none |
| Anything bigger than a small task: more than one PR (incl. any stack), a dev team, multi-step, multi-session, or waiting on something external | A project room headed by a room lead: run the `busybody:workstream-lead` skill (`bin/busybody lead-start`). The control room only opens it and relays | Mid-tier room lead by default; its workers per this table |
| An area that should be *owned* over time, with memory | A role with a staff room: run the `busybody:standing-role` skill (`bin/busybody role`). A quick question is a subagent; a pass that needs the owner's answers is a role session (`bin/busybody role run <role> --issue N <task>`, on the initiative's issue N) | Mid-tier by default; the controller triages its memory proposals |

**Never** convene a MAD or dev team for: coding that touches shared files; a choice reversible within an hour; three agents with the same prompt (that's paying 3x for one opinion); the advisor as a MAD member. Every MAD or team result reports each agent's model and turn count, since nothing else tracks cost.

## Your repos (yours)

The child repos are independent clones kept in this folder and gitignored here. List them in `office.json` (`repos`) and describe them here.

To import one, run `bin/busybody repo add <owner/name>` (`--dry-run` first): it clones, gitignores, writes the `office.json` entry and leaves a stub here. Then run the `busybody:repo-onboard` skill to fill the stub in and propose the evidence rule.

| | repo-one | repo-two |
| --- | --- | --- |
| Own guidance | its `CLAUDE.md` | |
| Commits | the commit style | |
| Branches | the branch prefixes | |
| Environments | | |
| Deploy trigger | | |
| Checks | | |

## How your repos connect (yours)

What one repo provides another (names that are hardcoded elsewhere, shared databases, deploy order), so a change in one is checked against its consumers.

## Your rules (yours)

Rules specific to {{DISPLAY_NAME}}: who may merge what, naming, approvals, anything the owner has decided that should bind every session.
