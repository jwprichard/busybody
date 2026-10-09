// Pure: how a standing role shows on its desk, and what the memory-review
// buttons run. No `$`, no I/O. The mod never decides a rating or accepts
// anything itself: the argv is built only for a press of the person's.

import type { OfficeRating, OfficeRole } from '../../types'
import type { BarSegment } from './parse'

export const RATINGS: readonly OfficeRating[] = ['saved-time', 'useful', 'no-value']

/** A role is "at work" when its transcripts moved in the last few minutes. */
export const ROLE_BUSY_MS = 5 * 60_000

export const DIFF_SHOWN_LINES = 12
export const NOTE_MAX_CHARS = 600

const ROLE_NAME = /^[a-z0-9][a-z0-9-]*$/

export function isRating(v: string): v is OfficeRating {
  return (RATINGS as readonly string[]).includes(v)
}

export function isRoleBusy(role: OfficeRole, nowMs: number): boolean {
  if (role.lastActivity === '') return false
  const t = Date.parse(role.lastActivity)
  return Number.isFinite(t) && nowMs - t >= 0 && nowMs - t <= ROLE_BUSY_MS
}

/** `pilot 1/6 uses · day 0/21`, `kept`, or `disabled`. */
export function pilotText(role: OfficeRole): string {
  if (role.status === 'kept') return 'kept'
  if (role.status === 'disabled') return 'disabled'
  if (role.pilot === null) return 'probation'
  const p = role.pilot
  return `pilot ${role.useCount}/${p.uses} uses · day ${p.days}/${p.weeks * 7}`
}

export function lastUseText(role: OfficeRole): string {
  return role.lastUse === null ? 'never used' : `last used ${role.lastUse}`
}

export function draftsText(role: OfficeRole): string | null {
  const d = role.drafts
  return d.approved === 0 ? null : `drafts ${d.approved} approved · ${d.unedited} unedited`
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}`
}

/**
 * A bar of `value` against `cap`: green, amber from 80%, red at or over the
 * cap (the fill is clamped to the width). A missing or zero cap shows empty.
 */
export function ratioBar(value: number, cap: number | null, width: number): BarSegment[] {
  const w = Math.max(4, Math.floor(width))
  if (cap === null || cap <= 0) return [{ text: '░'.repeat(w), tone: 'empty' }]
  const ratio = Math.max(0, value) / cap
  const filled = Math.min(w, Math.round(ratio * w))
  const tone: BarSegment['tone'] = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
  const segs: BarSegment[] = []
  if (filled > 0) segs.push({ text: '█'.repeat(filled), tone })
  if (filled < w) segs.push({ text: '░'.repeat(w - filled), tone: 'empty' })
  return segs
}

export function memoryLine(role: OfficeRole): string {
  const m = role.memory
  const stale = m.staleLines > 0 ? ` · ${m.staleLines}/${m.datedLines} stale` : ''
  return `memory ${formatKb(m.indexBytes)}/${formatKb(m.capIndex)} KB${stale}`
}

export function costLine(role: OfficeRole): string {
  const b = role.cost.budget
  return `$${role.cost.month.toFixed(2)}/${b === null ? '?' : `$${b}`} month`
}

export function contractorsLine(role: OfficeRole): string {
  const b = role.cost.contractorsBudget
  return `hot desks (workers) $${role.cost.contractorsMonth.toFixed(2)}/${b === null ? '?' : `$${b}`}`
}

export type RoleChoice = 'yes' | 'no'
export type RoleRatings = { draft: OfficeRating | null; memory: OfficeRating | null }
export type RoleItem = { n: number; kind: string; label: string }
export type RoleBatch = {
  items: RoleItem[]
  overflow: number
  guard: string | null
  /** The `batch: <hash>` line; `accept|reject --expect <hash>` refuses if the items moved. */
  hash: string | null
  /** Changed candidates.md lines that commit without review, when no memory item is waiting. */
  candidateLines: number
}

/** `bin/role batch <role>`: the one place the pending memory diff is itemised. */
export function roleBatchArgv(workspace: string, role: string): string[] | null {
  return workspace === '' || !ROLE_NAME.test(role) ? null : [`${workspace}/bin/role`, 'batch', role]
}

/**
 * Reads `bin/role batch` output: ` [N] PROMOTE c3 …` item lines (each one full
 * line, never cut), the `batch: <hash>` line, the `(K more item(s) are not
 * shown …)` overflow note, the `guard:` verdict, and with no memory items the
 * `candidates.md has N changed line(s)` note. Anything else (the header, the
 * command hints) is ignored: the office builds its own commands from the
 * choices, never from text it read.
 */
export function parseBatch(text: string): RoleBatch {
  const items: RoleItem[] = []
  let overflow = 0
  let guard: string | null = null
  let hash: string | null = null
  let candidateLines = 0
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (const [i, line] of lines.entries()) {
    const item = /^\s*\[(\d+)\]\s+(\S+)\s*(.*)$/.exec(line)
    if (item) {
      items.push({ n: Number(item[1]), kind: (item[2] ?? '').toUpperCase(), label: `${item[2] ?? ''} ${item[3] ?? ''}`.trim() })
      continue
    }
    const more = /\((\d+) more item\(s\) are not shown/.exec(line)
    if (more) overflow = Number(more[1])
    const h = /^batch:\s*([0-9a-f]{4,64})\s*$/.exec(line)
    if (h) hash = h[1] ?? null
    const cand = /no memory items for the owner; candidates\.md has (\d+) changed line/.exec(line)
    if (cand) candidateLines = Number(cand[1])
    if (line.startsWith('guard:') && !line.includes('ok')) guard = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim()
  }
  return { items, overflow, guard, hash, candidateLines }
}

/** What identifies a batch: its hash and full item lines. A press re-reads the batch and refuses if this changed. */
export function batchSignature(text: string): string {
  const b = parseBatch(text)
  return `${b.hash ?? ''}\n${b.items.map(it => `${it.n}:${it.label}`).join('\n')}\n${b.candidateLines}`
}

/** True when the owner has something to settle: memory items, or candidates-only changes (ratings only). */
export function batchActionable(b: RoleBatch): boolean {
  return b.items.length > 0 || b.candidateLines > 0
}

/**
 * The one command a press runs, built from per-item choices and the two
 * ratings, always with `--expect <hash>` when the batch printed one. Every
 * item must be decided and both ratings picked, else null and nothing runs.
 * All no = `bin/role reject` (shown items dropped; held-over ones stay on
 * disk); otherwise `bin/role accept --items <the yeses>` (unlisted = declined).
 * With no memory items but candidates.md changes: ratings-only `accept`.
 */
export function roleSettleArgv(
  workspace: string,
  role: string,
  batch: RoleBatch,
  choices: Record<number, RoleChoice>,
  ratings: RoleRatings,
): { action: 'accept' | 'reject'; argv: string[] } | null {
  if (workspace === '' || !ROLE_NAME.test(role) || !batchActionable(batch)) return null
  const { draft, memory } = ratings
  if (draft === null || memory === null || !isRating(draft) || !isRating(memory)) return null
  const items = batch.items
  if (items.some(it => choices[it.n] === undefined)) return null
  const yes = items.filter(it => choices[it.n] === 'yes').map(it => it.n)
  const rate = ['--rating-draft', draft, '--rating-memory', memory]
  const bin = `${workspace}/bin/role`
  const expect = batch.hash === null ? [] : ['--expect', batch.hash]
  if (items.length === 0) return { action: 'accept', argv: [bin, 'accept', role, ...expect, ...rate] }
  return yes.length === 0
    ? { action: 'reject', argv: [bin, 'reject', role, ...expect, ...rate] }
    : { action: 'accept', argv: [bin, 'accept', role, ...expect, '--items', yes.join(','), ...rate] }
}

/** The last `DIFF_SHOWN_LINES` are cut, not the first: the stat line leads. */
export function truncateDiff(text: string, maxLines = DIFF_SHOWN_LINES): { lines: string[]; hidden: number } {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  while (all.length > 0 && (all[all.length - 1] ?? '').trim() === '') all.pop()
  return { lines: all.slice(0, maxLines), hidden: Math.max(0, all.length - maxLines) }
}

export function diffLineTone(line: string): 'add' | 'del' | 'plain' {
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'plain'
}

/**
 * What the person sees when `bin/role accept|reject` fails: the guard's own
 * message (stderr first, then stdout), trimmed. Accept's refusal is never
 * softened or retried.
 */
export function roleFailureNote(action: 'accept' | 'reject', exitCode: number, stdout: string, stderr: string): string {
  const msg = [stderr.trim(), stdout.trim()].filter(s => s !== '').join('\n')
  const body = msg === '' ? `exit ${exitCode}` : msg
  return `bin/role ${action} refused: ${body}`.slice(0, NOTE_MAX_CHARS)
}

/** `role(<name>): use 2` and the like, from the first line `bin/role` prints on success. */
export function roleSuccessNote(action: 'accept' | 'reject', stdout: string): string {
  const first = (stdout.split('\n').find(l => l.trim() !== '') ?? '').trim()
  const verb = action === 'accept' ? 'accepted' : 'rejected'
  return first === '' ? verb : `${verb}: ${first}`
}
