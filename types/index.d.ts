// The Busybody band's type contract: the shapes it keeps in $.state, and the
// office document it reads from `bin/rooms --json` (camel-cased on parse).

export type OfficeLeadStatus = 'busy' | 'idle' | 'needs_input' | 'missing'

export type OfficeLatest = {
  verb: string
  /** From the new header `**TYPE** · who · where`; empty for the old `TYPE:` form. */
  who: string
  where: string
  /** The one-line summary under the header (new format); empty when unknown. */
  summary: string
  firstLine: string
  url: string
  ageS: number | null
  body: string
}

export type OfficeCost = {
  today: number
  total: number
  mix: Record<string, number>
  softPct: number
  hardPct: number
  soft: number
  hard: number
}

export type OfficeRoom = {
  name: string
  issue: number
  title: string
  url: string
  repo: string
  branch: string
  worktree: string
  model: string
  latest: OfficeLatest | null
  /** The room's PR, looked up by the engine through its shared cache (null: none, or the repo has no GitHub remote). */
  pr: OfficePrInfo | null
  /** When the engine last asked about it SUCCESSFULLY, seconds since the epoch. */
  prCheckedAt: number | null
  /** True when the last lookup failed or ran out of time: `pr` is then the last known one. */
  prStale: boolean
  /** agentId: the short id `claude agents` lists and `claude stop`/`attach` take. */
  lead: { status: OfficeLeadStatus; sessionId: string | null; agentId: string | null; state: string | null }
  cost: OfficeCost | null
  statusLine: string
  capped: boolean
  /** bin/rooms `state` (needs_input, capped, done, waiting, working, idle), or null when absent. */
  state?: string | null
  openDecisions: number
  /** The room's recipe (team) name from bin/rooms; '' when an older bin/rooms sent none. */
  team: string
  /** The recipe's phases, in order ([] when unknown) and the room's current one (null when unknown). */
  phases: string[]
  phase: string | null
}

export type OfficeDecision = {
  /** The DECISION comment's URL: unique, and the key of its draft. */
  key: string
  firstLine: string
  body: string
  url: string
  room: string
  issue: number
  repo: string
}

export type OfficeRoleStatus = 'probation' | 'kept' | 'disabled'

/** A standing role (memory-backed agent), from `bin/role status --json` via `bin/rooms`. */
export type OfficeRole = {
  name: string
  status: OfficeRoleStatus
  enabled: boolean
  goal: string
  issue: number | null
  useCount: number
  /** Pilot target and progress; null once kept or when none was set. */
  pilot: { uses: number; weeks: number; days: number } | null
  /** `YYYY-MM-DD` of the latest `role(<name>): use N` commit, or null. */
  lastUse: string | null
  /** ISO time of the role's latest transcript activity, or ''. */
  lastActivity: string
  memory: { indexBytes: number; totalBytes: number; capIndex: number; capRole: number; staleLines: number; datedLines: number }
  cost: { month: number; budget: number | null; contractorsMonth: number; contractorsBudget: number | null }
  drafts: { approved: number; unedited: number }
  flags: string[]
  /** A memory diff is waiting for the person's accept or reject. */
  memoryPending: boolean
  pendingFiles: number
  disabledReason: string | null
}

export type OfficeRating = 'saved-time' | 'useful' | 'no-value'

/** A running role session (`role-<role>-*`): what an answer to its question is nudged to. */
export type OfficeRoleSession = {
  name: string
  role: string
  issue: number
  lead: OfficeRoom['lead']
}

/** What the office reads from office.json (through `rooms --json`): who it is for, where minutes go, which repos, which tracker. */
export type OfficeWorkspace = {
  /** The workspace's name for people: `displayName`, else the workspace repo's name. */
  name: string
  /** owner/name of the repo whose issues are the minutes. */
  minutesRepo: string
  /** The name the workspace repo itself goes by in `repos`. */
  workspaceRepo: string
  /** Every configured repo with its GitHub slug; the first is the Start room default. */
  repos: Array<{ name: string; github: string }>
  /** `type: 'none'` (no `cardUrlRegex`) when no tracker is configured. */
  tracker: { type: string; name: string; cardUrlRegex: string | null }
}

/** One tracker row from `bin/rooms` `tasks[]`: an open initiative, already sorted (most complete stage first). */
export type OfficeTask = {
  number: number
  /** `Friendly name (N-issue)`. */
  name: string
  url: string
  /** The issue's `stage:<name>` label (one of the document's `stages`); idea when unlabelled. */
  stage: string
  /** Several or unknown stage labels, else null. */
  stageWarning: string | null
  /** Waiting on the owner: a flag, not a stage. */
  needsYou: boolean
  reason: string
  /** The project room on it, or null. */
  worker: string | null
  working: boolean
  ageS: number | null
}

export type OfficeDoc = {
  generatedAt: string
  rooms: OfficeRoom[]
  /** The stage table from bin/rooms, most complete first, parked last. */
  stages: string[]
  tasks: OfficeTask[]
  decisions: OfficeDecision[]
  roles: OfficeRole[]
  roleSessions: OfficeRoleSession[]
  /** Why `roles` is empty when `bin/role` failed, else null. */
  rolesError: string | null
  /** From office.json; null when the engine printed none (an engine older than the band). */
  workspace: OfficeWorkspace | null
  /** The hour's GraphQL use estimated from the gh usage log (no gh call), when the logging shim is installed; else null. */
  ghUsage: { hourPointsEst: number; limit: number } | null
  totals: { rooms: number; decisions: number; today: number; roles: number; memoryReviews: number; tasks: number; needsYou: number }
}

export type OfficeRefresh = {
  at: number
  ok: boolean
  error: string | null
  ms: number
}

/** A mutating command waiting for the person's "yes". */
export type OfficeConfirm = {
  title: string
  detail: string
  argv: string[]
  cwd: string | null
  /** Streams output into the console (lead-start); otherwise runs once. */
  isLong: boolean
}

export type OfficeOutput = {
  title: string
  command: string
  text: string
  status: 'running' | 'ok' | 'failed'
}

export type OfficeStartForm = {
  repo: string
  slug: string
  model: 'sonnet' | 'opus'
  /** An issue number (`12`, `#12`) or, with a tracker configured, a card URL it recognises; empty means a new issue. */
  ref: string
  liaison: string
}

export type OfficeSend = {
  status: 'sending' | 'sent' | 'failed'
  note: string
}

export type OfficePrInfo = { number: number; url: string; state: string; isDraft: boolean }

export type OfficePrLookup = { pr: OfficePrInfo | null; checkedAt: number; stale?: boolean }

declare module 'claude-code' {
  interface PluginState {
    busybody: {
      workspace: string | null
      doc: OfficeDoc | null
      refresh: OfficeRefresh | null
      drafts: Record<string, string>
      sends: Record<string, OfficeSend>
      confirm: OfficeConfirm | null
      output: OfficeOutput | null
      showForm: boolean
      form: OfficeStartForm
      prs: Record<string, OfficePrLookup>
      notices: Record<string, string>
      /** `bin/role batch <role>` output, for each role with a pending memory diff. */
      roleBatches: Record<string, string>
      /** The yes/no the person gave each batch item, per role. */
      roleItems: Record<string, Record<number, 'yes' | 'no'>>
      /** The two ratings the person picked per role: the drafts' value and the memory's value. */
      roleRatings: Record<string, { draft: OfficeRating | null; memory: OfficeRating | null }>
      /** The result of the last accept/reject press, per role. */
      roleRuns: Record<string, OfficeSend>
    }
  }
}
