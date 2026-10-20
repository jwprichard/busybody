// The pure modules: state parsing, the owner's whiteboard sticky notes (ANSWER is exactly
// what was typed), button-to-command mapping, the start form, the tracker and roles.

import { describe, expect, test } from 'claude-code/testing'

import type { OfficeRoom, OfficeWorkspace } from '../types'
import {
  findSessionId,
  githubRepo,
  startRepos,
  trackerCardRegex,
  planRoomAction,
  planStart,
  displayCommand,
} from '../hooks/office/commands'
import { answerArgv, buildAnswer, commentUrlFrom, nudgeTarget, nudgeText, parseDecision } from '../hooks/office/decisions'
import {
  bandAlerts,
  bandText,
  stageTone,
  fitName,
  padTo,
  trackerCols,
  trackerHeader,
  trackerRow,
  whoCell,
  trackerHeadline,
  formatAge,
  parseOfficeDoc,
  workspaceCandidates,
} from '../hooks/office/parse'
import {
  diffLineTone,
  batchSignature,
  parseBatch,
  roleBatchArgv,
  roleSettleArgv,
  roleFailureNote,
  roleSuccessNote,
  truncateDiff,
} from '../hooks/office/roles'
import { parseMinuteHeader } from '../hooks/office/parse'
import { DECISION_BODY, ROOMS_DOC, ROOMS_JSON, WORKSPACE } from './fixture'

const CARDS: OfficeWorkspace = { ...WORKSPACE, tracker: { type: 'acme', name: 'Acme', cardUrlRegex: 'https://tasks\\.acme\\.test/t/(\\d+)' } }

function rooms(): OfficeRoom[] {
  const r = parseOfficeDoc(ROOMS_JSON)
  if (!r.ok) throw new Error(r.error)
  return r.doc.rooms
}
function room(i: number): OfficeRoom {
  const r = rooms()[i]
  if (!r) throw new Error('no room')
  return r
}

describe('state parsing', () => {
  test('parses the bin/rooms document into the typed contract', () => {
    const r = parseOfficeDoc(ROOMS_JSON)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.rooms).toHaveLength(3)
    expect(r.doc.totals).toEqual({ rooms: 3, decisions: 1, roles: 2, memoryReviews: 1, tasks: 4, needsYou: 2 })
    const a = r.doc.rooms[0]
    expect(a?.name).toBe('room-alpha')
    expect(a?.branch).toBe('feat/alpha')
    expect(a?.lead).toEqual({ status: 'needs_input', sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', agentId: 'aaaaaaaa', state: 'needs_input' })
    expect(a?.latest?.ageS).toBe(125)
    const b = r.doc.rooms[1]
    expect(b?.capped).toBe(true)
    expect(b?.lead.status).toBe('missing')
    expect(b?.lead.sessionId).toBe(null)
    expect(b?.latest).toBe(null)
    expect(r.doc.decisions[0]?.key).toBe('https://github.com/acme-co/acme-office/issues/9001#issuecomment-1')
    expect(r.doc.decisions[0]?.issue).toBe(9001)
  })

  test('tolerates missing fields and unknown statuses', () => {
    const r = parseOfficeDoc(JSON.stringify({ rooms: [{ name: 'room-x', lead: { status: 'weird' }, room: {} }, { title: 'nameless' }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.rooms).toHaveLength(1)
    expect(r.doc.rooms[0]?.lead.status).toBe('missing')
    expect(r.doc.totals.rooms).toBe(1)
  })

  test('rejects text that is not a JSON object', () => {
    expect(parseOfficeDoc('lead-start: oops').ok).toBe(false)
    expect(parseOfficeDoc('[1,2]').ok).toBe(false)
  })

  test('tasks parse in the order the engine sent, with the stage, owner flag and room', () => {
    const r = parseOfficeDoc(ROOMS_JSON)
    if (!r.ok) throw new Error(r.error)
    expect(r.doc.stages[0]).toBe('complete')
    expect(r.doc.tasks.map(t => [t.name, t.stage, t.needsYou, t.worker, t.working, t.ageS])).toEqual([
      ['Gamma (9003-issue)', 'ci-deploy', false, 'room-gamma', false, 3600],
      ['Alpha work (9001-issue)', 'development', true, 'room-alpha', true, 125],
      ['Beta (9002-issue)', 'development', true, 'room-beta', false, 7200],
      ['Unstarted idea (9004-issue)', 'idea', false, null, false, null],
    ])
    expect(r.doc.tasks[2]?.stageWarning).toBe('2 stage labels: development, review')
    expect(trackerHeadline(r.doc.tasks)).toBe('2 need you · 4 tasks')
    expect(trackerHeadline(r.doc.tasks.slice(0, 1))).toBe('0 need you · 1 task')
  })

  test('stage tone comes from the engine table: first is done, last is parked', () => {
    const st = ['complete', 'review', 'idea', 'parked']
    expect([stageTone('complete', st), stageTone('review', st), stageTone('parked', st), stageTone('nope', st), stageTone('x', [])]).toEqual(['done', 'active', 'parked', 'active', 'active'])
  })

  test('a task without a name or number is dropped; no stage reads as idea; an old engine sends no tasks', () => {
    const r = parseOfficeDoc(JSON.stringify({ tasks: [{ number: 1, name: 'A (1-issue)' }, { number: 2 }, { name: 'B (x-issue)' }] }))
    if (!r.ok) throw new Error(r.error)
    expect(r.doc.tasks.map(t => [t.number, t.stage, t.needsYou])).toEqual([[1, 'idea', false]])
    const old = parseOfficeDoc(JSON.stringify({ rooms: [{ name: 'room-x' }] }))
    if (!old.ok) throw new Error(old.error)
    expect(old.doc.tasks).toEqual([])
    expect(old.doc.totals.needsYou).toBe(0)
  })

  test('band text: tasks and how many need you; hidden with no tasks', () => {
    const r = parseOfficeDoc(ROOMS_JSON)
    if (!r.ok) throw new Error(r.error)
    expect(bandText(r.doc)).toBe('🏢 4 tasks · 2 need you · 📝 1 memory to review')
    expect(bandText({ ...r.doc, tasks: [], roles: r.doc.roles.map(x => ({ ...x, memoryPending: false })) })).toBe(null)
    expect(bandText({ ...r.doc, tasks: [] })).toBe('🏢 office · 📝 1 memory to review')
    expect(bandText({ ...r.doc, roles: [], rolesError: 'x' })).toBe('🏢 4 tasks · 2 need you')
    expect(bandText(null)).toBe(null)
  })

  test('ages and workspace candidates', () => {
    expect(formatAge(44)).toBe('44s')
    expect(formatAge(240)).toBe('4m')
    expect(formatAge(7200)).toBe('2h')
    expect(formatAge(null)).toBe('?')
    expect(workspaceCandidates('/home/u/ws/acme-web', '/home/u/ws/engine')).toEqual([
      '/home/u/ws/acme-web',
      '/home/u/ws',
      '/home/u',
      '/home',
      '/home/u/ws',
    ].filter((v, i, a) => a.indexOf(v) === i))
  })

})

describe('minute headers (new and old formats)', () => {
  test('reads `**TYPE** · who · where` and the old `TYPE:` forms', () => {
    expect(parseMinuteHeader('**WAITING** · room-gamma · #12')).toEqual({ verb: 'WAITING', who: 'room-gamma', where: '#12', rest: '' })
    expect(parseMinuteHeader('**done** · lead')).toMatchObject({ verb: 'DONE', who: 'lead', where: null })
    expect(parseMinuteHeader('WAITING: draft #5 is green')).toMatchObject({ verb: 'WAITING', who: null, rest: 'draft #5 is green' })
    expect(parseMinuteHeader('DONE (from the user): ok')).toMatchObject({ verb: 'DONE', rest: 'ok' })
    expect(parseMinuteHeader('just chatter')).toBe(null)
  })

  test('a latest minute in the new format gets its verb, who, where and summary', () => {
    const doc = JSON.parse(ROOMS_JSON)
    doc.rooms[0].latest = { first_line: '**BLOCKED** · room-alpha · #9001', body: '**BLOCKED** · room-alpha · #9001\nneeds the key', age_s: 5 }
    const r = parseOfficeDoc(JSON.stringify(doc))
    if (!r.ok) throw new Error(r.error)
    const l = r.doc.rooms[0]?.latest
    expect(l).toMatchObject({ verb: 'BLOCKED', who: 'room-alpha', where: '#9001' })
  })

  test('a DECISION in the new format reads its question from the line under the header', () => {
    const d = parseDecision('**DECISION** · room-alpha · #9001\nWhich levels get sorted? (blocks the build)\n\nOptions:\n1. All\n2. Some\n\nRecommendation: 1.')
    expect(d.question).toBe('Which levels get sorted?')
    expect(d.blocks).toBe(true)
    expect(d.options).toEqual(['All', 'Some'])
    expect(d.recommendation).toBe('1.')
  })
})



describe('sticky notes (decisions)', () => {
  test('reads question, options, recommendation and blocking', () => {
    const p = parseDecision(DECISION_BODY)
    expect(p.question).toBe('Which levels of the tree get sorted A→Z?')
    expect(p.blocks).toBe(true)
    expect(p.options).toEqual([
      'All levels: areas, properties, orchards, blocks.',
      'Areas and properties only.',
      'A subset you name.',
    ])
    expect(p.recommendation).toBe('option 1. It is one comparator, so the cost is the same.')
    expect(p.isStructured).toBe(true)
  })

  test('inline options, and an unstructured body falls back', () => {
    const p = parseDecision('DECISION: use A or B?\nOptions: A, B')
    expect(p.question).toBe('use A or B?')
    expect(p.options).toEqual(['A', 'B'])
    const q = parseDecision('DECISION: something free-form\nwith prose only.')
    expect(q.isStructured).toBe(false)
    expect(q.question).toBe('something free-form')
    expect(q.body).toBe('DECISION: something free-form\nwith prose only.')
  })

  test('ANSWER is exactly what was typed: quotes, newlines, spaces, unicode', () => {
    const cases = [
      'A',
      'option 1, but sort blocks by code',
      'He said "go" and \'stop\'',
      'line one\nline two\n',
      '  leading and trailing spaces  ',
      'emoji 🍎 ü ñ — dash; $HOME `x` $(rm -rf /)',
    ]
    for (const typed of cases) {
      expect(buildAnswer(typed)).toBe(`ANSWER (from the user): "${typed}"`)
      const argv = answerArgv(42, typed, 'acme-co/acme-office')
      expect(argv).toEqual(['gh', 'issue', 'comment', '42', '-R', 'acme-co/acme-office', '--body', `ANSWER (from the user): "${typed}"`])
      // the typed text is a suffix of the body, untouched
      expect(argv?.[7]?.slice(25, -1)).toBe(typed)
    }
  })

  test('nothing typed sends nothing', () => {
    expect(buildAnswer('')).toBe(null)
    expect(buildAnswer('   \n ')).toBe(null)
    expect(answerArgv(42, '')).toBe(null)
    expect(answerArgv(0, 'yes')).toBe(null)
  })

  test('nudge is link-only', () => {
    const url = commentUrlFrom('https://github.com/acme-co/acme-office/issues/42#issuecomment-99\n')
    expect(url).toBe('https://github.com/acme-co/acme-office/issues/42#issuecomment-99')
    expect(nudgeText('room-alpha', url ?? '')).toBe('ANSWER room-alpha: https://github.com/acme-co/acme-office/issues/42#issuecomment-99')
    expect(commentUrlFrom('no url')).toBe(null)
  })

  test('nudge goes to the lead by session id, by name without one, never to this session', () => {
    expect(nudgeTarget(room(0), 'me-0000')).toEqual({ sessionId: 'aaaaaaaa-1111-2222-3333-444444444444' })
    expect(nudgeTarget(room(0), 'aaaaaaaa-1111-2222-3333-444444444444')).toBe(null)
    expect(nudgeTarget({ name: 'room-x', lead: { sessionId: null } }, 'me')).toBe('room-x')
  })
})

describe('button to command mapping', () => {
  test('stop asks first and runs claude stop <name>', () => {
    const plan = planRoomAction('stop', room(0))
    expect(plan.kind).toBe('run')
    if (plan.kind !== 'run') return
    expect(plan.argv).toEqual(['claude', 'stop', 'aaaaaaaa']) // the session's id, never the room name
    expect(plan.confirm).not.toBe(null)
    expect(planRoomAction('stop', room(1)).kind).toBe('disabled')
    const noShortId: OfficeRoom = { ...room(0), lead: { ...room(0).lead, agentId: null } }
    const full = planRoomAction('stop', noShortId)
    expect(full.kind === 'run' && full.argv).toEqual(['claude', 'stop', 'aaaaaaaa-1111-2222-3333-444444444444'])
    const noId: OfficeRoom = { ...room(0), lead: { ...room(0).lead, agentId: null, sessionId: null } }
    expect(planRoomAction('stop', noId).kind).toBe('disabled')
  })

  test('resume: capped never, running never, missing with a session id resumes in the background', () => {
    expect(planRoomAction('resume', room(1)).kind).toBe('disabled') // capped
    expect(planRoomAction('resume', room(0)).kind).toBe('disabled') // running
    const missing: OfficeRoom = { ...room(1), capped: false }
    expect(planRoomAction('resume', missing)).toEqual({
      kind: 'lookup',
      argv: ['claude', 'agents', '--json', '--all'],
      title: "Find room-beta's session",
    })
    const plan = planRoomAction('resume', missing, { sessionId: 'bbbbbbbb-0000' })
    expect(plan).toEqual({
      kind: 'run',
      argv: ['claude', '--bg', '--resume', 'bbbbbbbb-0000', '-n', 'room-beta'],
      cwd: '/tmp/ws/acme-api/.claude/worktrees/room-beta',
      confirm: 'Resume room-beta in the background (session bbbbbbbb)?',
      title: 'Resume room-beta',
    })
  })

  test('attach only shows the command', () => {
    expect(planRoomAction('attach', room(0))).toEqual({ kind: 'show', title: 'Attach to room-alpha', text: 'claude attach room-alpha' })
  })

  test('open issue and open PR', () => {
    expect(answerArgv(42, 'x', '')).toBe(null)   // no minutesRepo: nothing is built
    const ws = { workspace: WORKSPACE }
    const issue = planRoomAction('issue', room(0), ws)
    expect(issue.kind === 'run' && issue.argv).toEqual(['gh', 'issue', 'view', '9001', '-R', 'acme-co/acme-office', '--web'])
    expect(issue.kind === 'run' && issue.confirm).toBe(null)
    expect(planRoomAction('issue', room(0)).kind).toBe('disabled')   // no config: no guessed repo
    const look = planRoomAction('pr', room(0), ws)
    // the band never looks a PR up itself: with no answer from the engine yet, the button is off
    expect(look.kind).toBe('disabled')
    expect(planRoomAction('pr', room(0), { ...ws, pr: { pr: null, checkedAt: 1 } }).kind).toBe('disabled')
    const pr = planRoomAction('pr', room(0), { ...ws, pr: { pr: { number: 522, url: 'u', state: 'OPEN', isDraft: false }, checkedAt: 1 } })
    expect(pr.kind === 'run' && pr.argv).toEqual(['gh', 'pr', 'view', '522', '-R', 'acme-co/acme-web', '--web'])
    expect(planRoomAction('pr', { ...room(0), branch: '' }, ws).kind).toBe('disabled')
  })

  test('lookups parse', () => {
    expect(findSessionId(JSON.stringify([{ name: 'x', sessionId: '1' }, { name: 'room-beta', sessionId: 'abc' }]), 'room-beta')).toBe('abc')
    expect(findSessionId('nope', 'room-beta')).toBe(null)
    const withPr = parseOfficeDoc(JSON.stringify({ rooms: [{ name: 'room-x', issue: 1, room: { repo: 'r', branch: 'b' }, pr: { number: 7, url: 'u', state: 'MERGED', isDraft: false }, pr_checked_at: 1800000000 }] }))
    expect(withPr.ok && withPr.doc.rooms[0]?.pr).toEqual({ number: 7, url: 'u', state: 'MERGED', isDraft: false })
    expect(withPr.ok && withPr.doc.rooms[0]?.prCheckedAt).toBe(1800000000)
    expect(withPr.ok && withPr.doc.rooms[0]?.prStale).toBe(false)
  })

  test('start room builds the launcher argv from the workspace root', () => {
    const form = { repo: 'acme-web', slug: 'demo-room', model: 'opus' as const, ref: '#12', liaison: 'orchestrator' }
    const p = planStart('/home/u/ws', form, false, WORKSPACE)
    expect(p.errors).toEqual([])
    expect(p.argv).toEqual(['/home/u/ws/busybody/bin/lead-start', 'acme-web', 'demo-room', '--liaison', 'orchestrator', '--model', 'opus', '--issue', '12'])
    expect(planStart('/home/u/ws', form, true, WORKSPACE).argv?.at(-1)).toBe('--dry-run')
    expect(planStart('/home/u/ws', form, false, WORKSPACE, '/opt/busybody').argv?.[0]).toBe('/opt/busybody/bin/lead-start')
    const card = planStart('/home/u/ws', { ...form, ref: 'https://tasks.acme.test/t/732' }, false, CARDS)
    expect(card.argv).toEqual(['/home/u/ws/busybody/bin/lead-start', 'acme-web', 'demo-room', '--liaison', 'orchestrator', '--model', 'opus'])
    expect(card.cardUrl).toBe('https://tasks.acme.test/t/732')
    expect(card.notes.length).toBe(1)
    // tracker none: a card URL is not accepted, only an issue number
    const none = planStart('/home/u/ws', { ...form, ref: 'https://tasks.acme.test/t/732' }, false, WORKSPACE)
    expect(none.argv).toBe(null)
    expect(none.errors).toEqual(['Issue: a number like 12.'])
    // no config from the engine: nothing can be started
    expect(planStart('/home/u/ws', form, false).errors[0]).toContain('No repos from office.json')
    expect(startRepos(CARDS)).toEqual(['acme-office', 'acme-web', 'acme-api'])
    expect(githubRepo('acme-web', WORKSPACE)).toBe('acme-co/acme-web')
    expect(githubRepo('nope', WORKSPACE)).toBe(null)
    expect(trackerCardRegex(WORKSPACE)).toBe(null)
    expect(trackerCardRegex(CARDS)?.test('https://tasks.acme.test/t/9')).toBe(true)
    const bad = planStart('/home/u/ws', { ...form, slug: 'Bad Slug', repo: 'nope', liaison: '', ref: 'x' }, false, WORKSPACE)
    expect(bad.argv).toBe(null)
    expect(bad.errors.length).toBe(4)
  })

  test('the band warns when the hour GraphQL estimate passes 70%', () => {
    const base = parseOfficeDoc(ROOMS_JSON)
    if (!base.ok) throw new Error('fixture')
    expect(bandAlerts({ ...base.doc, ghUsage: null }).some(t => t.includes('GitHub'))).toBe(false)
    expect(bandAlerts({ ...base.doc, ghUsage: { hourPointsEst: 3400, limit: 5000 } }).some(t => t.includes('GitHub'))).toBe(false)
    expect(bandAlerts({ ...base.doc, ghUsage: { hourPointsEst: 3600, limit: 5000 } }).join(' ')).toContain('GitHub 72%')
  })

  test('display quoting is for show only', () => {
    expect(displayCommand(['gh', 'issue', 'comment', '1', '--body', 'it\'s "x"'])).toBe(`gh issue comment 1 --body 'it'\\''s "x"'`)
  })
})


describe('roles', () => {
  const doc = () => {
    const r = parseOfficeDoc(ROOMS_JSON)
    if (!r.ok) throw new Error(r.error)
    return r.doc
  }
  const role = (name: string) => {
    const r = doc().roles.find(x => x.name === name)
    if (!r) throw new Error(`no role ${name}`)
    return r
  }

  test('parses roles, tolerating missing fields', () => {
    expect(doc().roles.map(r => [r.name, r.status, r.enabled])).toEqual([
      ['scribe', 'probation', true],
      ['auditor', 'kept', true],
      ['retired', 'disabled', false],
    ])
    const s = role('scribe')
    expect(s.pilot).toEqual({ uses: 6, weeks: 3, days: 4 })
    expect(s.memory.indexBytes).toBe(2048)
    expect(s.cost).toEqual({ month: 3.5, budget: 15, contractorsMonth: 1.25, contractorsBudget: 20 })
    expect(s.memoryPending).toBe(true)
    expect(role('retired').disabledReason).toBe('not worth it')
    expect(role('retired').cost.contractorsBudget).toBe(null)
    const bare = parseOfficeDoc(JSON.stringify({ roles: [{ name: 'x' }, { goal: 'nameless' }], roles_error: 'bin/role status failed: boom' }))
    expect(bare.ok && bare.doc.roles.map(r => r.name)).toEqual(['x'])
    expect(bare.ok && bare.doc.rolesError).toBe('bin/role status failed: boom')
    expect(bare.ok && bare.doc.totals.memoryReviews).toBe(0)
  })

  test('a document with no roles key still parses', () => {
    const r = parseOfficeDoc(JSON.stringify({ rooms: [] }))
    expect(r.ok && r.doc.roles).toEqual([])
    expect(r.ok && r.doc.rolesError).toBe(null)
  })




  const BATCH = [
    'scribe: 3 memory item(s) for the owner, showing 2 (yes/no each)',
    ' [1] PROMOTE c3 2026-10-06: a line',
    ' [2] ARCHIVE m2 2026-09-01: old line',
    ' (1 more item(s) are not shown: max 5 per pass; they stay on disk for the next DONE)',
    'batch: abc12345',
    'accept all:  bin/role accept scribe --expect abc12345',
    'guard: ok',
  ].join('\n')
  const both = { draft: 'useful', memory: 'no-value' } as const

  test('batch text parses into numbered items, overflow and guard verdict', () => {
    const b = parseBatch(BATCH)
    expect(b.items.map(i => [i.n, i.kind])).toEqual([[1, 'PROMOTE'], [2, 'ARCHIVE']])
    expect(b.items[0]?.label).toBe('PROMOTE c3 2026-10-06: a line')
    expect(b.overflow).toBe(1)
    expect(b.guard).toBe(null)
    expect(b.hash).toBe('abc12345')
    const c = parseBatch('scribe: no memory items for the owner; candidates.md has 3 changed line(s) that commit without review (next use)\nguard: ok')
    expect([c.items.length, c.candidateLines, c.hash]).toEqual([0, 3, null])
    expect(parseBatch('scribe: no pending memory changes').items).toEqual([])
    expect(parseBatch(BATCH.replace('guard: ok', 'guard: REFUSES\nmemory too big')).guard).toBe('guard: REFUSES memory too big')
    expect(batchSignature(BATCH)).toBe(batchSignature(BATCH + '\nextra hint'))
    expect(batchSignature(BATCH)).not.toBe(batchSignature(BATCH.replace('old line', 'other')))
    expect(batchSignature(BATCH)).not.toBe(batchSignature(BATCH.replace('abc12345', 'def67890')))
    // a long line is kept whole, not cut
    const long = `${'x'.repeat(400)} tail`
    expect(parseBatch(` [1] PROMOTE c1 ${long}`).items[0]?.label.endsWith('tail')).toBe(true)
  })

  test('settle argv: exactly the shown items and both ratings, else nothing', () => {
    const items = parseBatch(BATCH)
    expect(roleBatchArgv('/ws', 'scribe')).toEqual(['/ws/bin/role', 'batch', 'scribe'])
    expect(roleBatchArgv('/ws', 'a b')).toBe(null)
    const yes1 = roleSettleArgv('/ws', 'scribe', items, { 1: 'yes', 2: 'no' }, both)
    expect(yes1).toEqual({
      action: 'accept',
      argv: ['/ws/bin/role', 'accept', 'scribe', '--expect', 'abc12345', '--items', '1', '--rating-draft', 'useful', '--rating-memory', 'no-value'],
    })
    expect(roleSettleArgv('/ws', 'scribe', items, { 1: 'yes', 2: 'yes' }, both)?.argv).toContain('1,2')
    // candidates-only: no items, ratings-only accept; nothing at all: nothing runs
    const cand = parseBatch('scribe: no memory items for the owner; candidates.md has 2 changed line(s) that commit without review (x)\nbatch: 11112222')
    expect(roleSettleArgv('/ws', 'scribe', cand, {}, both)?.argv).toEqual(['/ws/bin/role', 'accept', 'scribe', '--expect', '11112222', '--rating-draft', 'useful', '--rating-memory', 'no-value'])
    expect(roleSettleArgv('/ws', 'scribe', cand, {}, { draft: 'useful', memory: null })).toBe(null)
    expect(roleSettleArgv('/ws', 'scribe', parseBatch('scribe: no pending memory changes'), {}, both)).toBe(null)
    // every item no = the whole proposal is rejected
    expect(roleSettleArgv('/ws', 'scribe', items, { 1: 'no', 2: 'no' }, both)).toEqual({
      action: 'reject',
      argv: ['/ws/bin/role', 'reject', 'scribe', '--expect', 'abc12345', '--rating-draft', 'useful', '--rating-memory', 'no-value'],
    })
    // undecided item, missing or invalid rating, bad name, no workspace, no items: nothing runs
    expect(roleSettleArgv('/ws', 'scribe', items, { 1: 'yes' }, both)).toBe(null)
    expect(roleSettleArgv('/ws', 'scribe', items, { 1: 'yes', 2: 'no' }, { draft: 'useful', memory: null })).toBe(null)
    expect(roleSettleArgv('/ws', 'scribe', items, { 1: 'yes', 2: 'no' }, { draft: 'great' as never, memory: 'useful' })).toBe(null)
    expect(roleSettleArgv('/ws', '../x; rm', items, { 1: 'yes', 2: 'no' }, both)).toBe(null)
    expect(roleSettleArgv('', 'scribe', items, { 1: 'yes', 2: 'no' }, both)).toBe(null)
    expect(roleSettleArgv('/ws', 'scribe', { ...items, items: [], candidateLines: 0 }, {}, both)).toBe(null)
  })

  test('diff is truncated with a count, and coloured by sign', () => {
    const text = Array.from({ length: 20 }, (_, i) => `+line ${i}`).join('\n') + '\n\n'
    const t = truncateDiff(text, 12)
    expect(t.lines).toHaveLength(12)
    expect(t.hidden).toBe(8)
    expect(truncateDiff('a\nb').hidden).toBe(0)
    expect([diffLineTone('+a'), diffLineTone('-a'), diffLineTone(' a')]).toEqual(['add', 'del', 'plain'])
  })

  test('failure shows the guard message untouched; success shows the commit subject', () => {
    expect(roleFailureNote('accept', 1, '', 'bin/role: memory failed the guard (above): edit it\n')).toBe(
      'bin/role accept refused: bin/role: memory failed the guard (above): edit it',
    )
    expect(roleFailureNote('accept', 3, '', '')).toBe('bin/role accept refused: exit 3')
    expect(roleSuccessNote('accept', 'role(scribe): use 2\n')).toBe('accepted: role(scribe): use 2')
    expect(roleSuccessNote('reject', '')).toBe('rejected')
  })
})

describe('tracker table', () => {
  const stages = ['complete', 'awaiting-uat', 'ci-deploy', 'review', 'development', 'design', 'planning', 'research', 'idea', 'parked']
  const task = (over: Record<string, unknown> = {}) => ({
    number: 1, name: 'Harden the flow from idea to confirmed delivery (58-issue)', url: '', stage: 'development', stageWarning: null,
    needsYou: false, reason: '', worker: 'room-role-engine', working: true, ageS: 900, ...over,
  }) as Parameters<typeof trackerRow>[0]
  const rowLen = (t: Parameters<typeof trackerRow>[0], c: ReturnType<typeof trackerCols>) => {
    const r = trackerRow(t, c)
    return [r.stage, r.flag, r.name, r.who, r.age].filter(x => x !== '' || false).join(' '.repeat(c.gap)).length
  }

  test('columns fill the pane: fixed STAGE/flag/AGE, INITIATIVE gets most of the rest', () => {
    for (const w of [60, 80, 120, 200]) {
      const c = trackerCols(w, stages)
      expect(c.stage).toBe(12)
      expect(c.name).toBeGreaterThan(c.who)
      expect(c.stage + c.gap * 4 + 1 + c.name + c.who + c.age + 1 + c.act).toBeLessThanOrEqual(Math.max(w, 52))
    }
    expect(trackerCols(120, stages).name).toBeGreaterThan(trackerCols(80, stages).name)
  })

  test('every row and the header are one line of the same width, at every pane width', () => {
    for (const w of [60, 80, 120, 200]) {
      const c = trackerCols(w, stages)
      const want = rowLen(task({ name: 'x (1-issue)' }), c)
      for (const t of [task(), task({ stage: 'awaiting-uat', needsYou: true, worker: null, working: false, ageS: null }), task({ name: 'Short (7-issue)' })]) {
        expect(rowLen(t, c)).toBe(want)
        expect(trackerRow(t, c).stage).toHaveLength(c.stage)
      }
      expect(trackerHeader(c).startsWith('STAGE')).toBe(true)
      expect(trackerHeader(c)).toContain('INITIATIVE')
      expect(trackerHeader(c).length).toBeLessThanOrEqual(want)
    }
  })

  test('fitName keeps the (N-issue) suffix and cuts the friendly part with an ellipsis', () => {
    const name = 'Harden the flow from idea to confirmed delivery (58-issue)'
    expect(fitName(name, 80)).toBe(name)
    for (const max of [20, 30, 45]) {
      const out = fitName(name, max)
      expect([...out]).toHaveLength(max)
      expect(out.endsWith(' (58-issue)')).toBe(true)
      expect(out).toContain('…')
    }
    expect(fitName(name, 32)).toBe('Harden the flow from… (58-issue)')
    expect(fitName('No tag at all here', 8)).toBe('No tag …')
    expect(fitName(name, 8)).toBe('(58-issu')   // too narrow for any friendly text: the tag alone, cut hard
  })

  test('WHO keeps its working dot; padTo pads and cuts to exact width', () => {
    expect(whoCell('room-a', true, 12)).toBe('room-a ●')
    expect(whoCell('room-with-a-very-long-name', true, 12)).toBe('room-with… ●')
    expect(whoCell(null, false, 10)).toBe('—')
    expect(padTo('ab', 4)).toBe('ab  ')
    expect(padTo('abcdef', 4)).toBe('abcd')
  })

  test('the flag column marks only the tasks that need the owner', () => {
    const c = trackerCols(120, stages)
    expect(trackerRow(task({ needsYou: true }), c).flag).toBe('⚑')
    expect(trackerRow(task(), c).flag).toBe(' ')
  })
})
