---
name: resume
description: The controller's first move after a compaction. Reads the handoff file, checks its in-flight list against the running sessions and watchers, says what was lost, and prints a short "where we are" for the owner. Use at the start of a session after compaction, or when the owner asks where things stand.
---

# Resume

After a compaction a `SessionStart` hook (matcher `compact`) has already put the handoff file, a `status` summary and a
`rooms --json` summary into context, capped at about 9,000 characters (Claude Code truncates hook output at 10,000). If it
was cut, or you are resuming without a compaction, run `busybody handoff resume`: the same material in full, plus the check below.

1. **Read the handoff.** `busybody handoff resume` prints it and checks each bullet under In flight against the live sessions (`rooms --json` `live_sessions`) and the watcher processes (`pr-watch`). Each is `still running` or `LOST`.
2. **Deal with what was lost.** A lost item is a session or watcher that ended while nothing was watching. Look at its issue or PR (a `DONE`, a merge, a CI result), do what the handoff said to do on finish, or restart the watcher. Say so; never assume it finished.
3. **Run `busybody status`** before any sequencing decision (it is also in the hook output, but may be cached).
4. **Tell the owner where we are**, short: what is running, what finished while away, what is lost, what waits on them (decisions, promises made), what is parked. Then carry on.

No handoff file means no handoff was written: say so, rely on GitHub, and check `rooms --json` for live sessions.
