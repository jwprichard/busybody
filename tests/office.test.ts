// Through the engine: the mod's hooks with the world beneath them mocked.
// Every host command lands in `world.calls`; nothing real runs, and the
// fixture's rooms and issues are made up (never #5, never a real lead).

import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { nameHash } from '../hooks/office/parse'
import { ROLE_BATCH, ROOMS_DOC, ROOMS_JSON } from './fixture'

const WS = '/ws'
// The plugin's own folder (the tools run from here, whichever workspace is open): this file's folder's parent.
const ENGINE = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SURFACES = ['terminal', 'desktop'] as const

type World = { copies: string[]; toasts: string[]; calls: string[][]; sends: Array<{ to: string; text: string }>; roleFails: string | null; batch: string }

function ok(stdout: string): { value: ProcessRunResult } {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function world(on: On, roomsJson: string = ROOMS_JSON): World {
  const w: World = { copies: [], toasts: [], calls: [], sends: [], roleFails: null, batch: ROLE_BATCH }
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.env(on, { COLORTERM: 'truecolor', BUSYBODY_CONTROLLER: 'orchestrator' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.copy', ($, e) => {
    w.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: {} }
  })
  on('fs.stat', ($, e) => {
    if (e.path === `${WS}/office.json`) return { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT ${e.path}` }
  })
  on('session.id', () => ({ value: 'orchestrator-session' }))
  on('session.send', ($, e) => {
    w.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.calls.push(argv)
    if (argv[0] === `${ENGINE}/bin/rooms`) return ok(roomsJson)
    if (argv[0] === `${ENGINE}/bin/role`) {
      if (argv[1] === 'batch') return ok(w.batch)
      if (w.roleFails !== null) {
        return { value: { exitCode: 1, stdout: '', stderr: w.roleFails, isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return ok(`role(${argv[2]}): use 2\n`)
    }
    if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'list') return ok('[]')
    if (argv[0] === 'gh' && argv[1] === 'issue' && argv[2] === 'comment') {
      return ok(`https://github.com/acme-co/acme-office/issues/${argv[3]}#issuecomment-77\n`)
    }
    return ok('')
  })
  return w
}

const MUTATING = (argv: string[]) =>
  (argv[0] === 'gh' && argv[2] === 'comment') ||
  (argv[0] === 'claude' && ['stop', '--bg'].includes(argv[1] ?? '')) ||
  (argv[0] ?? '').endsWith('/bin/lead-start') ||
  ((argv[0] ?? '').endsWith('/bin/role') && ['accept', 'reject'].includes(argv[1] ?? ''))

function paneProps(bodyColumns: number) {
  return {
    title: 'Office',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  }
}

const ID = (s: string) => nameHash(s).toString(36)
const DECISION_URL = 'https://github.com/acme-co/acme-office/issues/9001#issuecomment-1'

test('session start finds the workspace, refreshes from bin/rooms, mutates nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: `${WS}/acme-web`, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'office', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  expect(w.calls.some(c => c[0] === `${ENGINE}/bin/rooms` && c[1] === '--json')).toBe(true)
  expect(w.calls.some(c => c[0] === 'gh')).toBe(false)   // the band asks the engine for everything GitHub-shaped
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ type: 'Link', label: /\(9001-issue\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Link', label: /\(9004-issue\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 need you · 4 tasks/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /needs you: over its spend cap/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 stage labels: development, review/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Which levels of the tree get sorted A→Z?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Recommends/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CONTROL ROOM/ })).toBeDefined()
  // the office look is gone: no rooms, desks or sprites
  expect(await ui.find({ type: 'Text', text: /PROJECT ROOMS|STAFF ROOMS/ })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('pane draws the tracker on terminal and desktop at every width', async ($, on) => {
  world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    for (const cols of [60, 110, 150]) {
      const ui = await $.ui.mount({ plugin: 'busybody', surface, component: 'Pane', requestId: 'office', props: paneProps(cols) })
      expect(await ui.find({ type: 'Link', label: /\(9001-issue\)/ })).toBeDefined()
      expect(await ui.find({ key: `stop-${ID('room-alpha')}` })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^STAGE +⚑ +INITIATIVE/ })).toBeDefined()   // the table's header
      expect(await ui.find({ type: 'Text', text: /room-.*●/ })).toBeDefined()
      if (surface === 'desktop') expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('Send posts exactly what was typed, then a link-only nudge', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = `d${ID(DECISION_URL)}`
  const typed = 'Option 1 — but "blocks" by code, not name.  '
  await ui.input({ key: `${id}-input`, text: typed, kind: 'change' })
  expect(w.calls.filter(MUTATING)).toEqual([]) // typing sends nothing
  await ui.press({ key: `${id}-send` })
  const posts = w.calls.filter(c => c[0] === 'gh' && c[2] === 'comment')
  expect(posts).toEqual([
    ['gh', 'issue', 'comment', '9001', '-R', 'acme-co/acme-office', '--body', `ANSWER (from the user): "${typed}"`],
  ])
  expect(w.sends).toHaveLength(1)
  expect(w.sends[0]?.text).toBe('ANSWER room-alpha: https://github.com/acme-co/acme-office/issues/9001#issuecomment-77')
  expect(await ui.find({ type: 'Text', text: /room nudged/ })).toBeDefined()
  // the refresh after an answer skips bin/rooms' 60 s document cache so the change shows now
  expect(w.calls.some(c => c[0] === `${ENGINE}/bin/rooms` && c.includes('--fresh'))).toBe(true)
  await ui.unmount()
})

test('an answer to a role session question nudges that session, not a room', async ($, on) => {
  const url = 'https://github.com/acme-co/acme-office/issues/9#issuecomment-5'
  const doc = {
    ...ROOMS_DOC,
    decisions: [
      ...ROOMS_DOC.decisions,
      { verb: 'DECISION', first_line: 'DECISION: Which card first?', body: 'DECISION: Which card first?', url,
        room: 'role-analyst-refine-756', issue: 9, repo: 'acme-office', role: 'analyst' },
    ],
    role_sessions: [
      { name: 'role-analyst-refine-756', role: 'analyst', issue: 9,
        lead: { status: 'busy', agent: { id: 'bbbbbbbb', sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', state: 'working' } } },
    ],
  }
  const w = world(on, JSON.stringify(doc))
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = `d${ID(url)}`
  await ui.input({ key: `${id}-input`, text: 'the older one', kind: 'change' })
  await ui.press({ key: `${id}-send` })
  expect(w.calls.filter(c => c[0] === 'gh' && c[2] === 'comment')).toEqual([
    ['gh', 'issue', 'comment', '9', '-R', 'acme-co/acme-office', '--body', 'ANSWER (from the user): "the older one"'],
  ])
  expect(w.sends).toEqual([
    { to: 'bbbbbbbb-1111-2222-3333-444444444444', text: 'ANSWER role-analyst-refine-756: https://github.com/acme-co/acme-office/issues/9#issuecomment-77' },
  ])
  expect(await ui.find({ type: 'Text', text: /room nudged/ })).toBeDefined()
  await ui.unmount()
})

test('a staff-room pass asks on its own issue; the answer nudges the running role session, old role-issue notes still work', async ($, on) => {
  const passUrl = 'https://github.com/acme-co/acme-office/issues/95#issuecomment-5'
  const roleUrl = 'https://github.com/acme-co/acme-office/issues/9#issuecomment-4'
  const session = { name: 'role-analyst-refine-758', role: 'analyst', issue: 95,
    lead: { status: 'busy', agent: { id: 'cccccccc', sessionId: 'cccccccc-1111-2222-3333-444444444444', state: 'working' } } }
  const doc = {
    ...ROOMS_DOC,
    decisions: [
      ...ROOMS_DOC.decisions,
      { verb: 'DECISION', first_line: 'Which card first?', body: 'Which card first?', url: passUrl,
        room: 'role-analyst-refine-758', issue: 95, repo: 'acme-office', role: 'analyst' },
      { verb: 'DECISION', first_line: 'An older pass question', body: 'An older pass question', url: roleUrl,
        room: 'role-analyst-refine-758', issue: 9, repo: 'acme-office', role: 'analyst' },
    ],
    role_sessions: [session],
  }
  const w = world(on, JSON.stringify(doc))
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  for (const [url, text] of [[passUrl, 'card 758'], [roleUrl, 'the old one']] as const) {
    const id = `d${ID(url)}`
    await ui.input({ key: `${id}-input`, text, kind: 'change' })
    await ui.press({ key: `${id}-send` })
  }
  expect(w.calls.filter(c => c[0] === 'gh' && c[2] === 'comment').map(c => c[3])).toEqual(['95', '9'])
  expect(w.sends).toEqual([
    { to: 'cccccccc-1111-2222-3333-444444444444', text: 'ANSWER role-analyst-refine-758: https://github.com/acme-co/acme-office/issues/95#issuecomment-77' },
    { to: 'cccccccc-1111-2222-3333-444444444444', text: 'ANSWER role-analyst-refine-758: https://github.com/acme-co/acme-office/issues/9#issuecomment-77' },
  ])
  await ui.unmount()
})

test('Send with nothing typed posts nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'desktop', component: 'Pane', requestId: 'office', props: paneProps(110) })
  await ui.press({ key: `d${ID(DECISION_URL)}-send` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Type an answer first/ })).toBeDefined()
  await ui.unmount()
})

test('Stop asks first; only "Yes" runs claude stop', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  await ui.press({ key: `stop-${ID('room-alpha')}` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ key: 'confirm-yes' })).toBeDefined()
  await ui.press({ key: 'confirm-no' })
  expect(await ui.find({ key: 'confirm-yes' })).toBeUndefined()
  expect(w.calls.filter(MUTATING)).toEqual([])
  await ui.press({ key: `stop-${ID('room-alpha')}` })
  await ui.press({ key: 'confirm-yes' })
  expect(w.calls.filter(MUTATING)).toEqual([['claude', 'stop', 'aaaaaaaa']])
  await ui.unmount()
})

test('attach copies the command and toasts; a room with no live session opens its issue; nothing mutates; capped Resume is refused', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const before = w.calls.length
  await ui.press({ key: `attach-${ID('room-alpha')}` })
  expect(w.calls.length).toBe(before)
  expect(w.copies).toEqual(['claude attach room-alpha'])
  expect(w.toasts).toEqual(['Copied: claude attach room-alpha'])
  // room-beta has no live session: its attach press opens the issue (gh --web), copies nothing
  await ui.press({ key: `attach-${ID('room-beta')}` })
  expect(w.copies).toEqual(['claude attach room-alpha'])
  expect(w.calls.slice(before)).toEqual([['gh', 'issue', 'view', '9002', '-R', 'acme-co/acme-office', '--web']])
  await ui.press({ key: `resume-${ID('room-beta')}` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /is capped/ })).toBeDefined()
  await ui.unmount()
})

test('a row name links to its issue', async ($, on) => {
  world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  expect(await ui.find({ type: 'Link', label: /\(9001-issue\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Link', label: /\(9004-issue\)/ })).toBeDefined()
  await ui.unmount()
})

test('Start room asks first, then runs bin/lead-start from the engine folder', async ($, on) => {
  const w = world(on)
  on('process.spawn', async function* ($, e) {
    w.calls.push([...e.argv])
    yield { stream: 'stdout' as const, text: 'launching room-demo (sonnet, auto mode)\n' }
    return { value: { code: 0, signal: null } }
  })
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  await ui.press({ key: 'start-toggle' })
  await ui.input({ key: 'form-slug', text: 'demo', kind: 'change' })
  await ui.input({ key: 'form-ref', text: '#9003', kind: 'change' })
  await ui.press({ key: 'form-start' })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ key: 'confirm-yes' })).toBeDefined()
  await ui.press({ key: 'confirm-yes' })
  expect(w.calls.filter(MUTATING)).toEqual([
    [`${ENGINE}/bin/lead-start`, 'acme-office', 'demo', '--liaison', 'orchestrator', '--model', 'sonnet', '--issue', '9003'],
  ])
  expect(await ui.find({ type: 'Text', text: /launching room-demo/ })).toBeDefined()
  await ui.unmount()
})

test('the pane title is the workspace name from office.json, with Busybody beside it; the first repo is the Start default', async ($, on) => {
  world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  expect(await ui.find({ type: 'Text', text: 'ACME' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Busybody' })).toBeDefined()
  await ui.unmount()
})

test('band: tasks and how many need you; hidden with no tasks', async ($, on) => {
  world(on)
  const band = {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  }
  // before any refresh there is no doc: hidden (the engine's own band shows)
  const empty = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect(await empty.find({ type: 'Text', text: /🏢/ })).toBeUndefined()
  await empty.unmount()
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'busybody', surface, component: 'AbovePrompt', props: band })
    expect((await ui.find({ type: 'Text', text: /🏢/ }))?.text).toContain('🏢 4 tasks · 2 need you')
    await ui.unmount()
  }
})


const ROLE = (action: string, items: string | null, draft: string, memory: string) => [
  `${ENGINE}/bin/role`,
  action,
  'scribe',
  '--expect',
  'abc12345',
  ...(items === null ? [] : ['--items', items]),
  '--rating-draft',
  draft,
  '--rating-memory',
  memory,
]

test('memory review: shows the batched items and the command, runs nothing by itself', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  expect(w.calls.some(c => c[0] === `${ENGINE}/bin/role` && c[1] === 'batch' && c[2] === 'scribe')).toBe(true)
  expect(w.calls.some(c => c[1] === 'diff')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /memory reviews/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[1\] PROMOTE c3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[2\] ARCHIVE m2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 more item wait for the next pass/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Apply runs: decide every item, rate the drafts, rate the memory first/ })).toBeDefined()
  expect(w.calls.filter(MUTATING)).toEqual([])
  await ui.unmount()
})

test('memory review: candidates-only diff applies ratings only', async ($, on) => {
  const w = world(on)
  w.batch = 'scribe: no memory items for the owner; candidates.md has 2 changed line(s) that commit without review (next use)\nbatch: abc12345\nguard: ok'
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  expect(await ui.find({ type: 'Text', text: /candidates\.md has 2 changed line/ })).toBeDefined()
  await ui.press({ key: `rv-${id}-draft-useful` })
  await ui.press({ key: `rv-${id}-memory-no-value` })
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([ROLE('accept', null, 'useful', 'no-value')])
  await ui.unmount()
})

test('memory review: nothing runs until every item and both ratings are chosen', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Decide every item and pick both ratings first/ })).toBeDefined()
  await ui.press({ key: `rv-${id}-i1-yes` })
  await ui.press({ key: `rv-${id}-draft-useful` })
  await ui.press({ key: `rv-${id}-memory-no-value` })
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  await ui.unmount()
})

test('memory review: a yes/no per item runs exactly the shown accept command', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  await ui.press({ key: `rv-${id}-i1-yes` })
  await ui.press({ key: `rv-${id}-i2-no` })
  await ui.press({ key: `rv-${id}-draft-useful` })
  await ui.press({ key: `rv-${id}-memory-no-value` })
  expect(await ui.find({ type: 'Text', text: `  Apply runs: ${ENGINE}/bin/role accept scribe --expect abc12345 --items 1 --rating-draft useful --rating-memory no-value` })).toBeDefined()
  expect(w.calls.filter(MUTATING)).toEqual([])
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([ROLE('accept', '1', 'useful', 'no-value')])
  expect(await ui.find({ type: 'Text', text: /accepted: role\(scribe\): use 2/ })).toBeDefined()
  await ui.unmount()
})

test('memory review: every item no runs bin/role reject, with both ratings', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'desktop', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  await ui.press({ key: `rv-${id}-i1-no` })
  await ui.press({ key: `rv-${id}-i2-no` })
  await ui.press({ key: `rv-${id}-draft-saved-time` })
  await ui.press({ key: `rv-${id}-memory-no-value` })
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([ROLE('reject', null, 'saved-time', 'no-value')])
  await ui.unmount()
})

test('memory review: a batch that changed since the decision runs nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  await ui.press({ key: `rv-${id}-i1-yes` })
  await ui.press({ key: `rv-${id}-i2-yes` })
  await ui.press({ key: `rv-${id}-draft-useful` })
  await ui.press({ key: `rv-${id}-memory-useful` })
  w.batch = 'scribe: no pending memory changes'
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /The batch changed since you decided/ })).toBeDefined()
  await ui.unmount()
})

test('memory review: a refused accept shows the guard message and keeps the item', async ($, on) => {
  const w = world(on)
  w.roleFails = 'bin/role: memory failed the guard (above): edit it, or `bin/role reject` to restore'
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps(110) })
  const id = ID('scribe')
  await ui.press({ key: `rv-${id}-i1-yes` })
  await ui.press({ key: `rv-${id}-i2-yes` })
  await ui.press({ key: `rv-${id}-draft-saved-time` })
  await ui.press({ key: `rv-${id}-memory-saved-time` })
  await ui.press({ key: `rv-${id}-apply` })
  expect(w.calls.filter(MUTATING)).toEqual([ROLE('accept', '1,2', 'saved-time', 'saved-time')])
  expect(await ui.find({ type: 'Text', text: /accept refused: bin\/role: memory failed the guard/ })).toBeDefined()
  expect(await ui.find({ key: `rv-${id}-apply` })).toBeDefined()
  await ui.unmount()
})

test('band: counts roles and memory waiting for review', async ($, on) => {
  world(on)
  await $.session.start({ cwd: WS, surface: 'terminal', isInteractive: true })
  const band = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 140, scroll: { offset: 0, bodyRows: 6 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'busybody', surface: 'terminal', component: 'AbovePrompt', props: band })
  expect((await ui.find({ type: 'Text', text: /🏢/ }))?.text).toContain('· 📝 1 memory to review')
  await ui.unmount()
})
