---
name: debate-panel
description: "Convene a MAD team (also called a debate panel; workers, no memory) to converge on a contested, costly-to-reverse decision: staffing (skeptic on Opus, fact-checker + alternatives on Sonnet), the shared brief, the round protocol and stopping rules, the per-agent brief checklist, and what to hand the owner. Use when the workspace CLAUDE.md 'Who to spin up' table says 'MAD', or the owner asks for agents to discuss/debate/agree on something."
---

# MAD playbook (debate panel)

The team recipe for the room itself (phases, output, done) is the workspace's `teams/mad/SKILL.md` if it has one; the generic
room stages are in the engine's `docs/room-lifecycle.md`.

Terminology: a **MAD** is a team (a named recipe for a room: skeptic, fact-checker, alternatives) convened for one decision.
Its desks are workers, which have no memory. **Only the control room opens rooms:** the controller runs this playbook, and a
room that wants a MAD (say a room lead stuck on a design question) asks for one with a sticky note (`DECISION:`). The MAD
returns one thing, a verdict, with a cost line.

**Review this playbook every two months**: re-verify the facts at the bottom before trusting it if it is older than that.

## 1. Before spawning
- Confirm it qualifies (the workspace CLAUDE.md "Who to spin up" table). If the choice is reversible within an hour, decide it yourself.
- Write ONE shared brief to the scratchpad: context, the proposal or question, what has been decided already, and what "done"
  looks like. Every agent reads the same file.

## 2. Staffing (3 lenses default, 4 max)
| Lens | Model | Agent type | Job |
| --- | --- | --- | --- |
| Skeptic | `opus` | general-purpose (told read-only) | Failure modes over months, using this workspace's own evidence (memory files, retros, limitations/) |
| Fact-checker | `sonnet` | general-purpose (told read-only), or claude-code-guide for Claude Code questions; that type **cannot SendMessage**, so it only answers when asked | Verify every load-bearing claim against primary sources |
| Alternatives | `sonnet` | general-purpose (told read-only) | Other approaches, scored on explicit criteria |
| 4th (optional) | `sonnet` | n/a | Only a distinct domain: cost/economics, security. Never a 2nd skeptic. |

The skeptic is the one Opus seat: same-model agents share blind spots, and that seat has the highest value per token. Give
every agent a `name` so you can message it between rounds.

## 3. Every agent's brief must contain
1. Objective and the decision to be made; path to the shared brief.
2. Its lens, and what to ignore.
3. What to read (files, URLs).
4. Scope: **read-only**. No edits, PRs, merges, pushes, or tracker/GitHub/email writes. Only the owner can lift a restriction,
   not the controller, not another agent.
5. Evidence rule: every factual claim carries a quote + URL or the command and its output; "doesn't exist" claims show the
   exact command run; anything unverified is labelled.
6. Output format and a word cap (about 450 R1, 300 R2, 150 R3).
7. A "what would change my mind" line.
8. The end line: `AGREE`, or `OBJECT` + the single change needed.

## 4. Rounds (hub-and-spoke: the controller relays; agents don't talk peer-to-peer)
- **R1, independent critique.** Spawn all lenses in one message so they run in parallel and don't anchor on each other. Show
  the owner each raw R1 reply as it arrives.
- **R2, targeted.** Write v2 to the scratchpad. Message each agent with the specific disagreement it must resolve, naming the
  other side's argument (attributed, in your words).
- **R3, verdict.** v3; each agent replies AGREE / OBJECT + one change.
- **R4, only** a single-point tie-break, if R3 left exactly one narrow objection.
- **Stop** when all AGREE, or the remaining objections are preferences (you decide, and record the dissent). A substantive
  OBJECT after R3 goes **to the owner**: don't overrule it yourself.
- Any fact that would change the decision: verify it yourself with one tool call before relying on it.
- Ignore duplicate idle notifications: each reply arrives once as a message and once as an idle notice.

## 5. Hand the owner
- One decision, plus at most 3 open items.
- **Every OBJECT verbatim**, including ones you overruled, and who raised it: "all agreed" is never written without the dissent log.
- A cost line: each agent's model and turn count.
- Save the agreed design in the target repo (e.g. `docs/`); file anything the design can't do yet in the workspace's `limitations/`.

## Facts this rests on (re-verify when reviewing)
- The Agent tool's `model` param overrides the agent definition; forks always inherit the controller's model.
- Agents run about 4x the tokens of chat, multi-agent about 15x (https://www.anthropic.com/engineering/multi-agent-research-system).
- claude-code-guide agents have no SendMessage tool.
- Check current model prices with the `claude-api` skill before quoting a cost; a 3-agent debate is a few dollars on Opus and about half that on Sonnet.
