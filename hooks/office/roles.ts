// Pure: what the memory-review
// buttons run. No `$`, no I/O. The mod never decides a rating or accepts
// anything itself: the argv is built only for a press of the person's.

import type { OfficeRating } from '../../types'

export const RATINGS: readonly OfficeRating[] = ['saved-time', 'useful', 'no-value']

export const DIFF_SHOWN_LINES = 12
export const NOTE_MAX_CHARS = 600

const ROLE_NAME = /^[a-z0-9][a-z0-9-]*$/

export function isRating(v: string): v is OfficeRating {
  return (RATINGS as readonly string[]).includes(v)
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
