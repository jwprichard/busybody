---
name: handoff
description: The controller's checklist before compacting a control-room session. Closes the loops on GitHub first (owner answers recorded as ANSWER minutes, PR links on the initiative steps, finished rooms closed, worktrees cleaned up), then writes the handoff file from a template with only what GitHub cannot show, and flags limitations and memory candidates. Use when the owner says to hand off, or before a compaction.
---

# Handoff

Run by the controller before compacting. A compaction keeps a summary, not state: everything GitHub holds survives, so
close what can be closed there, and write down only what it cannot show. The next session gets the file back automatically
(`/busybody:resume`, and a `SessionStart` hook on `compact`).

## 1. Close the loops on GitHub first
Check each with `busybody rooms --json` and `busybody status`; fix what you can, report what you cannot.
1. **Owner answers:** every answer the owner gave in conversation is recorded as an `ANSWER` minute (`**ANSWER** · controller · <where>`, quoting them) on the room's issue.
2. **PR links:** every PR opened this session is a link on its initiative's step line (the body, never ticked by hand).
3. **Finished rooms:** a room whose `DONE` you have spot-checked has a `RECORD` and is resolved (issue closed); its session has ended.
4. **Worktrees:** list each repo's worktrees (`git worktree list`); remove those whose rooms are closed.
5. Anything you cannot fix (a room that will not end, a permission you lack): say so in the handoff's Gotchas.

## 2. Write the handoff file
`busybody handoff path` is where it goes; `busybody handoff template` is the shape. Fill every section, writing `none` for an empty one. Only what GitHub cannot show:
- **In flight:** background work still running, one bullet `- <name>: what to do when it finishes`. Use the room or session name, or `pr-watch <n>`, so resume can check it is alive.
- **Promises to the owner:** anything said that nothing else records ("tell you when X is live").
- **Waiting on the owner** and **Parked:** what is open, what it blocks, what would unpark it.
- **Gotchas:** things learned this session that the next one would trip on.

Do not repeat room state, PR state or decisions: `status` and `rooms --json` give those. Link, don't paste: no secrets, hostnames, account ids or logs. The file is local (`.cache/`), never committed.

## 3. Flag candidates
In the file's Candidates section, name anything that belongs elsewhere: a gap in the tracking design (a file in the workspace's `limitations/`) or a memory item. Do not write them now; the owner decides.

Finish by telling the owner the file's path and that it is safe to compact.
