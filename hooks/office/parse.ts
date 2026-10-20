// Pure: turns `bin/rooms --json` output into the typed OfficeDoc, and the
// small formatters the pane and band share. No `$`, no I/O.

import type {
  OfficeCost,
  OfficeDecision,
  OfficeDoc,
  OfficeLatest,
  OfficeLeadStatus,
  OfficePrInfo,
  OfficePose,
  OfficeRole,
  OfficeRoleSession,
  OfficeRoleStatus,
  OfficeRoom,
  OfficeTask,
  OfficeTaskState,
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

/** `soft $15/day, hard $40/day` → { soft: 15, hard: 40 }. */
export function parseCapsText(text: string): { soft: number | null; hard: number | null } {
  const soft = /soft\s*\$?\s*([\d.]+)/i.exec(text)
  const hard = /hard\s*\$?\s*([\d.]+)/i.exec(text)
  return { soft: soft ? Number(soft[1]) : null, hard: hard ? Number(hard[1]) : null }
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

/** What to show after the verb: the new header's `who · where`, or the old text after the colon. */
export function minuteSummary(latest: Pick<OfficeLatest, 'firstLine' | 'body'> & { summary?: string }): string {
  if (latest.summary) return latest.summary
  const h = parseMinuteHeader(latest.firstLine)
  if (h === null) return latest.firstLine
  if (h.rest !== '') return h.rest
  const next = latest.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(1)
    .find(l => l.trim() !== '')
  const who = [h.who, h.where].filter((x): x is string => x !== null && x !== '').join(' · ')
  return (next ?? '').trim() !== '' ? (next ?? '').trim() : who
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

function parseCost(v: unknown, capsText: string): OfficeCost | null {
  if (v === null || typeof v !== 'object') return null
  const o = obj(v)
  const caps = obj(o.caps)
  const fromText = parseCapsText(capsText)
  const soft = num(caps.soft, fromText.soft ?? 15)
  const hard = num(caps.hard, fromText.hard ?? 40)
  const mix: Record<string, number> = {}
  for (const [k, val] of Object.entries(obj(o.mix))) mix[k] = num(val)
  const today = num(o.today)
  return {
    today,
    total: num(o.total, today),
    mix,
    softPct: num(o.soft_pct, soft > 0 ? (today / soft) * 100 : 0),
    hardPct: num(o.hard_pct, hard > 0 ? (today / hard) * 100 : 0),
    soft,
    hard,
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
    cost: parseCost(o.cost, str(room.caps)),
    statusLine: str(o.status_line),
    capped: o.capped === true,
    state: str(o.state) || null,
    openDecisions: num(o.open_decisions),
    team: str(o.team),
    phases: arr(o.phases).filter((p): p is string => typeof p === 'string'),
    phase: str(o.phase) || null,
    watcherAlive: o.watcher_alive === true || obj(o.watcher).alive === true,
  }
}

const TASK_STATES: readonly OfficeTaskState[] = ['needs_you', 'working', 'waiting', 'parked', 'done']

function parseTask(v: unknown): OfficeTask | null {
  const o = obj(v)
  const number = num(o.number, 0)
  const name = str(o.name)
  if (name === '' || number === 0) return null
  const state = str(o.state)
  return {
    number,
    name,
    url: str(o.url),
    worker: str(o.worker) || null,
    state: (TASK_STATES as readonly string[]).includes(state) ? (state as OfficeTaskState) : 'parked',
    reason: str(o.reason),
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
  const today = rooms.reduce((sum, r) => sum + (r.cost?.today ?? 0), 0)
  return {
    ok: true,
    doc: {
      generatedAt: str(o.generated_at),
      rooms,
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
        today: num(totals.today, today),
        roles: num(totals.roles, roles.filter(r => r.enabled).length),
        memoryReviews: num(totals.memory_reviews, roles.filter(r => r.memoryPending).length),
        tasks: num(totals.tasks, tasks.length),
        needsYou: num(totals.needs_you, tasks.filter(t => t.state === 'needs_you').length),
      },
    },
  }
}

export function formatAge(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '?'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Row order and labels of the tracker, owner-first. */
export const TASK_STATE_LABEL: Record<OfficeTaskState, string> = {
  needs_you: 'needs you',
  working: 'working',
  waiting: 'waiting',
  parked: 'parked',
  done: 'done',
}

/** The tracker's headline: how many need the owner first, then the other states that have rows. */
export function trackerHeadline(tasks: readonly OfficeTask[]): string {
  const n = (s: OfficeTaskState) => tasks.filter(t => t.state === s).length
  const parts = TASK_STATES.filter(s => s !== 'needs_you' && n(s) > 0).map(s => `${n(s)} ${TASK_STATE_LABEL[s]}`)
  return [`${n('needs_you')} need${n('needs_you') === 1 ? 's' : ''} you`, ...parts].join(' · ')
}

/**
 * The band's line, or null when there is nothing to show: no task and no
 * memory waiting for review.
 */
export function bandText(doc: OfficeDoc | null): string | null {
  if (doc === null) return null
  const reviews = doc.roles.filter(r => r.memoryPending).length
  const open = doc.tasks.filter(t => t.state !== 'done').length
  if (doc.tasks.length === 0 && reviews === 0) return null
  const parts: string[] = []
  if (doc.tasks.length > 0) {
    parts.push(`🏢 ${plural(open, 'task', 'tasks')}`, `${doc.totals.needsYou} need you`)
    const done = doc.tasks.length - open
    if (done > 0) parts.push(`✓ ${done} done`)
  } else {
    parts.push('🏢 office')
  }
  if (reviews > 0) parts.push(`📝 ${reviews} memory to review`)
  return parts.join(' · ')
}

export type RoomDisplayKind = 'busy' | 'idle' | 'needs_input' | 'done' | 'capped' | 'stalled' | 'watching' | 'waiting'

export type RoomDisplay = {
  kind: RoomDisplayKind
  /** The status words beside the head desk: `working`, `Done · awaiting merge/release`, ... */
  label: string
  /** Still at work, or owed work: everything but a finished room. */
  isActive: boolean
  /** The warning line on the desk, or null for none. */
  warning: { text: string; tone: 'warn' | 'danger' | 'info' } | null
}

/** An idle room: `watching` with its watcher alive, `waiting` when its last minute is WAITING with none, else `idle`. */
function idleKind(room: OfficeRoom): 'idle' | 'watching' | 'waiting' {
  if (room.watcherAlive) return 'watching'
  // bin/rooms room_state skips controller NOTE/RECORD/ANSWER when finding the room's own last minute; prefer it.
  if (room.state) return room.state === 'waiting' ? 'waiting' : 'idle'
  return room.latest?.verb === 'WAITING' ? 'waiting' : 'idle'
}

/** `dev-team · build` on a room desk: the recipe and its current phase (`?` when unknown); '' without a recipe. */
export function recipeLabel(room: OfficeRoom): string {
  if (room.team === '') return ''
  return `${room.team} · ${room.phase ?? '?'}`
}

/** The desk pose for a room: the display kind where it has a pose of its own, else the lead's status. */
export function roomPose(room: OfficeRoom): OfficePose {
  const k = roomDisplay(room).kind
  return k === 'watching' || k === 'waiting' ? k : room.lead.status
}

/**
 * What a room is, from the head desk's status and its latest report: a room lead that
 * is gone after a DONE report is a finished room awaiting merge/release, not
 * a stalled one. Only a missing head desk WITHOUT a DONE warns as stalled.
 */
export function roomDisplay(room: OfficeRoom): RoomDisplay {
  const isGone = room.lead.status === 'missing'
  const saidDone = room.latest?.verb === 'DONE'
  if (isGone && saidDone) {
    return { kind: 'done', label: 'Done · awaiting merge/release', isActive: false, warning: null }
  }
  if (room.capped) {
    return {
      kind: 'capped',
      label: isGone ? 'capped · stopped' : 'capped',
      isActive: true,
      warning: { text: '⛔ CAPPED · hard cap hit, room stopped. Resuming needs a new cap from you.', tone: 'danger' },
    }
  }
  if (isGone && !room.watcherAlive && room.latest?.verb !== 'WAITING') {
    return {
      kind: 'stalled',
      label: 'not running',
      isActive: true,
      warning: { text: '○ STALLED? · the room lead is gone with no DONE report. Read the minutes (issue), then Resume.', tone: 'warn' },
    }
  }
  if (room.lead.status === 'needs_input') {
    return {
      kind: 'needs_input',
      label: 'needs input',
      isActive: true,
      warning: { text: '✋ NEEDS INPUT · the room lead is waiting on a prompt. Attach to see it.', tone: 'warn' },
    }
  }
  const kind: RoomDisplayKind = room.lead.status === 'busy' ? 'busy' : idleKind(room)
  const label = kind === 'watching' || kind === 'waiting' ? kind : saidDone ? `${kind === 'busy' ? 'working' : 'idle'} · reported DONE` : kind === 'busy' ? 'working' : 'idle'
  if (room.cost && room.cost.soft > 0 && room.cost.today >= room.cost.soft) {
    return {
      kind,
      label,
      isActive: true,
      warning: { text: `⚠ over the soft cap (${formatMoney(room.cost.soft)}): expect a sticky note.`, tone: 'warn' },
    }
  }
  if (room.openDecisions > 0) {
    return {
      kind,
      label,
      isActive: true,
      warning: { text: `◆ ${room.openDecisions} sticky note${room.openDecisions === 1 ? "" : "s"} on your whiteboard`, tone: 'info' },
    }
  }
  return { kind, label, isActive: true, warning: null }
}

/** Extra alerts the band appends: rooms needing input, capped rooms. */
export function bandAlerts(doc: OfficeDoc): string[] {
  const needs = doc.rooms.filter(r => r.lead.status === 'needs_input').length
  const capped = doc.rooms.filter(r => r.capped).length
  const out: string[] = []
  if (needs > 0) out.push(`✋ ${needs} needs input`)
  if (capped > 0) out.push(`⛔ ${capped} capped`)
  const gh = doc.ghUsage
  if (gh !== null && gh.limit > 0 && gh.hourPointsEst >= gh.limit * 0.7) {
    out.push(`⚠ GitHub ${Math.round((gh.hourPointsEst / gh.limit) * 100)}% of the hour's GraphQL (est.)`)
  }
  return out
}

export type BarSegment = { text: string; tone: 'ok' | 'warn' | 'over' | 'empty' | 'soft' | 'hard' }

/**
 * A spend bar scaled to the hard cap: filled cells for today's spend, a soft
 * cap marker `│` where the soft cap falls, and a hard cap end `┃`.
 * `width` counts the inside cells (the hard marker is one more).
 */
export function spendBar(today: number, soft: number, hard: number, width: number): BarSegment[] {
  const w = Math.max(4, Math.floor(width))
  const scale = hard > 0 ? hard : Math.max(soft, today, 1)
  const filled = Math.min(w, Math.round((Math.max(0, today) / scale) * w))
  const softAt = soft > 0 && soft < scale ? Math.min(w - 1, Math.round((soft / scale) * w)) : -1
  const tone: BarSegment['tone'] = today >= hard && hard > 0 ? 'over' : soft > 0 && today >= soft ? 'warn' : 'ok'
  const segs: BarSegment[] = []
  const push = (text: string, t: BarSegment['tone']) => {
    const last = segs[segs.length - 1]
    if (last && last.tone === t) last.text += text
    else segs.push({ text, tone: t })
  }
  for (let i = 0; i < w; i++) {
    if (i === softAt) push(i < filled ? '▓' : '│', 'soft')
    else if (i < filled) push('█', tone)
    else push('░', 'empty')
  }
  push('┃', 'hard')
  return segs
}

export type Layout = 'wide' | 'normal' | 'compact'

/** Compact for narrow terminals or 5+ rooms; two rooms a row when wide. */
export function chooseLayout(columns: number, roomCount: number): Layout {
  if (columns < 72 || roomCount >= 5) return 'compact'
  if (columns >= 124 && roomCount >= 2) return 'wide'
  return 'normal'
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
