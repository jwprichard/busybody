---
name: mad
description: The MAD team recipe (a debate team of workers with no memory) for one contested, costly-to-reverse decision. A skeptic on Opus, a fact-checker and an alternatives lens on Sonnet, all read-only. Entry criteria, phases (brief, rounds of at most 3 plus a tie-break, verdict), output, done condition, escalation, memory and minute formats. Read by whoever heads the MAD room.
---

# MAD

A team is a skill plus a config (`docs/room-lifecycle.md`). `team.json` fixes the models (skeptic
Opus; fact-checker and alternatives Sonnet), read-only desks, no worktree and no PR. This skill is the
procedure. The staffing detail, brief checklist and facts to re-verify live in the `busybody:debate-panel`
skill; it is the playbook this derives from. **Only the control room opens rooms:** a room that wants a
MAD asks with a `DECISION` sticky note.

## Entry criteria
Checked at Kickoff, briefly. No-go with a `DECISION` naming what is missing if any is absent.
- The **question**, stated as one decision.
- The **options** on the table.
- **What is already decided** (so the MAD doesn't relitigate it).
- **What the answer changes** (so it qualifies: costly to reverse; if reversible within an hour, decide it yourself).

## Middle phases
1. **Brief.** Write ONE shared brief (context, question, options, decided items, what done looks like).
   Every agent gets it plus its own brief: lens, what to read, **read-only** scope, evidence rule (quote
   + URL, or command + output), word cap, a "what would change my mind" line, and the end line
   `AGREE` or `OBJECT` + the single change needed.
2. **Rounds (at most 3, plus a tie-break).** Hub and spoke: the head relays; agents never talk peer-to-peer.
   - R1 independent critique, all lenses in parallel. R2 targeted at each disagreement, attributed.
     R3 AGREE / OBJECT. A tie-break (R4) only if R3 left exactly one narrow objection.
   - Stop when all AGREE, or the remainder are preferences (decide and record the dissent).
   - A substantive OBJECT after R3 goes to the owner; never overrule it.
   - Verify any decision-changing fact with one tool call before relying on it.
3. **Verdict.** One decision, written up and posted.

## Output
- The **verdict**: one decision.
- **Every OBJECT verbatim**, including those overruled, and who raised each. Never "all agreed"
  without the dissent log.
- **At most 3 open items.**
- A cost line: each agent's model and turn count (nothing else tracks it).

## Done condition
**Verdict posted** as a `DONE` minute. Then Close: end the session. The controller resolves.

## When to escalate
- A substantive OBJECT after R3: `DECISION` to the owner with the options.
- The question turns out reversible, mis-framed, or already decided: no-go or `BLOCKED`.
- Spend heading past the soft cap: `DECISION` before continuing.

## Memory
- **Read:** the shared brief, the issue's minutes, and the workspace evidence the lenses are pointed to
  (memory files, retros, `limitations/`).
- **Record:** the agreed design goes in the target repo (`docs/`); what the design can't do yet goes in
  `limitations/`. Procedure lessons are proposed as sticky notes in the retro for the owner to accept.
- **Workers have no memory;** each starts from its brief.

## Minute formats
Line 1 `**TYPE** · who · where`, line 2 a one-line summary, then a free body. Link, don't paste.
```
**DONE** · room-<slug> · #<issue>
Verdict: <one sentence>; 1 OBJECT overruled, 2 open items.
```
- `PROGRESS` per round; `DECISION` for an unresolved OBJECT; `BLOCKED`; `DONE` with the verdict.
- `WAITING` if paused on the owner's answer; `NOTE` and `RECORD` are the controller's; never write `ANSWER`.
