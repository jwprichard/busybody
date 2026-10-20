// Pure: turns `bin/rooms --json` output into the typed OfficeDoc, and the
// small formatters the pane and band share. No `$`, no I/O.

import type {
  OfficeDecision,
  OfficeDoc,
  OfficeLatest,
  OfficeLeadStatus,
  OfficePrInfo,
  OfficeRole,
  OfficeRoleSession,
  OfficeRoleStatus,
  OfficeRoom,
  OfficeTask,
  OfficeWorkspace,
} from '../../types'

type Json = Record<string, unknown>

const LEAD_STATUSES: readonly OfficeLeadStatus[] = ['busy', 'idle', 'needs_input', 'missing']

function obj(v: unknown): Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback
}
function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return fallback
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export type MinuteHeader = { verb: string; who: string | null; where: string | null; rest: string }

const MINUTE_VERBS = 'PROGRESS|DECISION|BLOCKED|DONE|ANSWER|WAITING|NOTE|RECORD'
/** New header: `**TYPE** · who · where`, optionally followed by text on the same line. */
const NEW_HEADER = new RegExp(`^\\s*\\*\\*(${MINUTE_VERBS})\\*\\*\\s*·\\s*([^·\\n]*?)\\s*(?:·\\s*([^\\n]*?))?\\s*$`, 'i')
/** Old header: `TYPE:` or `TYPE (from the user):`, text after the colon. */
const OLD_HEADER = new RegExp(`^\\s*\\**(${MINUTE_VERBS})\\b\\**[^:\\n]*:\\**\\s*(.*)$`, 'i')

/** Reads a minute's first line in either format; null when it is neither. */
export function parseMinuteHeader(line: string): MinuteHeader | null {
  const n = NEW_HEADER.exec(line)
  if (n) return { verb: (n[1] ?? '').toUpperCase(), who: (n[2] ?? '').trim() || null, where: (n[3] ?? '').trim() || null, rest: '' }
  const o = OLD_HEADER.exec(line)
  if (o) return { verb: (o[1] ?? '').toUpperCase(), who: null, where: null, rest: (o[2] ?? '').trim() }
  return null
}

function parseLatest(v: unknown): OfficeLatest | null {
  if (v === null || typeof v !== 'object') return null
  const o = obj(v)
  const body = str(o.body)
  const firstLine = str(o.first_line, body.split('\n')[0] ?? '')
  const header = parseMinuteHeader(firstLine)
  const rawVerb = (str(o.verb) || str(o.type)).toUpperCase()
  return {
    verb: rawVerb !== '' && rawVerb !== 'NOTE' ? rawVerb : (header?.verb ?? rawVerb),
    who: str(o.who) || (header?.who ?? ''),
    where: str(o.where) || (header?.where ?? ''),
    summary: str(o.summary),
    firstLine,
    url: str(o.url),
    ageS: typeof o.age_s === 'number' && Number.isFinite(o.age_s) ? o.age_s : null,
    body,
  }
}

function parseRoom(v: unknown): OfficeRoom | null {
  const o = obj(v)
  const name = str(o.name)
  if (name === '') return null
  const room = obj(o.room)
  const lead = obj(o.lead)
  const agent = obj(lead.agent)
  const rawStatus = str(lead.status, 'missing')
  const status = (LEAD_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as OfficeLeadStatus)
    : 'missing'
  const sessionId = str(agent.sessionId) || null
  return {
    name,
    issue: num(o.issue),
    title: str(o.title),
    url: str(o.url),
    repo: str(o.repo, str(room.repo)),
    branch: str(room.branch),
    worktree: str(room.worktree),
    model: str(room.model),
    latest: parseLatest(o.latest),
    lead: { status, sessionId, agentId: str(agent.id) || null, state: str(agent.state) || null },
    pr: parsePr(o.pr),
    prCheckedAt: typeof o.pr_checked_at === 'number' ? o.pr_checked_at : null,
    prStale: o.pr_stale === true,
    capped: o.capped === true,
  }
}

function parseTask(v: unknown): OfficeTask | null {
  const o = obj(v)
  const number = num(o.number, 0)
  const name = str(o.name)
  if (name === '' || number === 0) return null
  return {
    number,
    name,
    url: str(o.url),
    stage: str(o.stage, 'idea'),
    stageWarning: str(o.stage_warning) || null,
    needsYou: o.needs_you === true,
    reason: str(o.reason),
    worker: str(o.worker) || null,
    working: o.working === true,
    ageS: typeof o.age_s === 'number' && Number.isFinite(o.age_s) ? o.age_s : null,
  }
}

function parseRoleSession(v: unknown): OfficeRoleSession | null {
  const o = obj(v)
  const name = str(o.name)
  if (name === '') return null
  const lead = obj(o.lead)
  const agent = obj(lead.agent)
  const rawStatus = str(lead.status, 'missing')
  return {
    name,
    role: str(o.role),
    issue: num(o.issue),
    lead: {
      status: (LEAD_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as OfficeLeadStatus) : 'missing',
      sessionId: str(agent.sessionId) || null,
      agentId: str(agent.id) || null,
      state: str(agent.state) || null,
    },
  }
}

const ROLE_STATUSES: readonly OfficeRoleStatus[] = ['probation', 'kept', 'disabled']

function optNum(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v, 0)
}

// shortcut: the whole role shape is parsed though the pane shows only name, issue and the memory review; trim when roles get no other use.
function parseRole(v: unknown): OfficeRole | null {
  const o = obj(v)
  const name = str(o.name)
  if (name === '') return null
  const mem = obj(o.memory)
  const cost = obj(o.cost)
  const drafts = obj(o.drafts)
  const pilot = o.pilot !== null && typeof o.pilot === 'object' ? obj(o.pilot) : null
  const rawStatus = str(o.status, 'probation')
  const enabled = o.enabled !== false
  return {
    name,
    status: (ROLE_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as OfficeRoleStatus) : enabled ? 'probation' : 'disabled',
    enabled,
    goal: str(o.goal),
    issue: optNum(o.issue),
    useCount: num(o.use_count),
    pilot: pilot ? { uses: num(pilot.uses), weeks: num(pilot.weeks), days: num(pilot.days) } : null,
    lastUse: str(o.last_use) || null,
    lastActivity: str(cost.last_activity),
    memory: {
      indexBytes: num(mem.index_bytes),
      totalBytes: num(mem.total_bytes),
      capIndex: num(mem.cap_index, 8192),
      capRole: num(mem.cap_role, 16384),
      staleLines: num(mem.stale_lines),
      datedLines: num(mem.dated_lines),
    },
    cost: {
      month: num(cost.month),
      budget: optNum(cost.budget),
      contractorsMonth: num(cost.contractors_month),
      contractorsBudget: optNum(cost.contractors_budget),
    },
    drafts: { approved: num(drafts.approved), unedited: num(drafts.unedited) },
    flags: arr(o.flags).map(f => str(f)).filter(f => f !== ''),
    memoryPending: o.memory_pending === true,
    pendingFiles: num(o.pending_files),
    disabledReason: str(o.disabled_reason) || null,
  }
}

function parseDecisionEntry(v: unknown): OfficeDecision | null {
  const o = obj(v)
  const body = str(o.body)
  const url = str(o.url)
  if (body === '' && url === '') return null
  return {
    key: url || `${str(o.room)}#${str(o.issue)}:${body.slice(0, 40)}`,
    firstLine: str(o.first_line, body.split('\n')[0] ?? ''),
    body,
    url,
    room: str(o.room),
    issue: num(o.issue),
    repo: str(o.repo),
  }
}

export type ParseResult = { ok: true; doc: OfficeDoc } | { ok: false; error: string }

/** Parses the text `bin/rooms --json` printed. Tolerant of missing fields. */
function parsePr(v: unknown): OfficePrInfo | null {
  const p = obj(v)
  if (typeof p.number !== 'number' || typeof p.url !== 'string') return null
  return { number: p.number, url: p.url, state: str(p.state, 'OPEN'), isDraft: p.isDraft === true }
}

function parseGhUsage(v: unknown): { hourPointsEst: number; limit: number } | null {
  const g = obj(v)
  return typeof g.hour_points_est === 'number' && typeof g.limit === 'number' ? { hourPointsEst: g.hour_points_est, limit: g.limit } : null
}

function parseWorkspace(v: unknown): OfficeWorkspace | null {
  const w = obj(v)
  const minutesRepo = str(w.minutes_repo)
  if (minutesRepo === '') return null
  const t = obj(w.tracker)
  return {
    name: str(w.name),
    minutesRepo,
    workspaceRepo: str(w.workspace_repo),
    repos: arr(w.repos)
      .map(r => ({ name: str(obj(r).name), github: str(obj(r).github) }))
      .filter(r => r.name !== '' && r.github !== ''),
    tracker: { type: str(t.type, 'none'), name: str(t.name, 'None'), cardUrlRegex: str(t.card_url_regex) || null },
  }
}

export function parseOfficeDoc(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `bin/rooms printed no JSON (${String(err).slice(0, 80)})` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'bin/rooms printed JSON that is not an object' }
  }
  const o = obj(raw)
  const rooms = arr(o.rooms).map(parseRoom).filter((r): r is OfficeRoom => r !== null)
  const decisions = arr(o.decisions)
    .map(parseDecisionEntry)
    .filter((d): d is OfficeDecision => d !== null)
  const tasks = arr(o.tasks).map(parseTask).filter((t): t is OfficeTask => t !== null)
  const roles = arr(o.roles).map(parseRole).filter((r): r is OfficeRole => r !== null)
  const roleSessions = arr(o.role_sessions).map(parseRoleSession).filter((r): r is OfficeRoleSession => r !== null)
  const totals = obj(o.totals)
  return {
    ok: true,
    doc: {
      generatedAt: str(o.generated_at),
      rooms,
      stages: arr(o.stages).filter((x): x is string => typeof x === 'string'),
      tasks,
      decisions,
      roles,
      roleSessions,
      rolesError: str(o.roles_error) || null,
      workspace: parseWorkspace(o.workspace),
      ghUsage: parseGhUsage(o.gh_usage),
      totals: {
        rooms: num(totals.rooms, rooms.length),
        decisions: num(totals.decisions, decisions.length),
        roles: num(totals.roles, roles.filter(r => r.enabled).length),
        memoryReviews: num(totals.memory_reviews, roles.filter(r => r.memoryPending).length),
        tasks: num(totals.tasks, tasks.length),
        needsYou: num(totals.needs_you, tasks.filter(t => t.needsYou).length),
      },
    },
  }
}

/** A stable small hash of a name, for stable UI keys. */
export function nameHash(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function formatAge(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '?'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The tracker's headline: how many need the owner, out of how many tasks. */
export function trackerHeadline(tasks: readonly OfficeTask[]): string {
  const n = tasks.filter(t => t.needsYou).length
  return `${n} need${n === 1 ? 's' : ''} you · ${plural(tasks.length, 'task', 'tasks')}`
}

/** A stage's tone from its place in the engine's table: the first is done, the last is parked, the rest are in flight. */
export function stageTone(stage: string, stages: readonly string[]): 'done' | 'parked' | 'active' {
  const i = stages.indexOf(stage)
  return i === 0 ? 'done' : i === stages.length - 1 && i > 0 ? 'parked' : 'active'
}

/**
 * The band's line, or null when there is nothing to show: no task and no
 * memory waiting for review.
 */
export function bandText(doc: OfficeDoc | null): string | null {
  if (doc === null) return null
  const reviews = doc.roles.filter(r => r.memoryPending).length
  if (doc.tasks.length === 0 && reviews === 0) return null
  const parts: string[] = []
  if (doc.tasks.length > 0) parts.push(`🏢 ${plural(doc.tasks.length, 'task', 'tasks')}`, `${doc.totals.needsYou} need you`)
  else parts.push('🏢 office')
  if (reviews > 0) parts.push(`📝 ${reviews} memory to review`)
  return parts.join(' · ')
}

/** Extra alerts the band appends: the GitHub budget warning. */
export function bandAlerts(doc: OfficeDoc): string[] {
  const gh = doc.ghUsage
  return gh !== null && gh.limit > 0 && gh.hourPointsEst >= gh.limit * 0.7
    ? [`⚠ GitHub ${Math.round((gh.hourPointsEst / gh.limit) * 100)}% of the hour's GraphQL (est.)`]
    : []
}

/** Where to look for the workspace (the folder holding bin/rooms): the
 * session's directory and its parents first, then two above the mod. */
export function workspaceCandidates(cwd: string, pluginRoot: string): string[] {
  const out: string[] = []
  const add = (p: string) => {
    const n = normalizePath(p)
    if (n !== '' && !out.includes(n)) out.push(n)
  }
  let dir = normalizePath(cwd)
  while (dir !== '' && dir !== '/') {
    add(dir)
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
  }
  add(`${pluginRoot}/..`)   // the plugin is the engine clone (busybody/) inside the workspace
  return out
}

export function normalizePath(p: string): string {
  if (p === '') return ''
  const isAbs = p.startsWith('/')
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (isAbs ? '/' : '') + parts.join('/')
}
