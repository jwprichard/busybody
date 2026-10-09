// office mod v0: the project rooms as a little office inside Claude Code.
//
//   /office            opens the pane: the control room (the owner's whiteboard
//                      with sticky notes), the staff rooms, the project rooms,
//                      controls, and a Start room form
//   band               🏢 N rooms · M sticky notes · $X today
//   refresh            $.clock every 120 s runs `bin/rooms --json` (no model)
//
// Nothing mutating runs on its own: every gh/claude/lead-start call that
// changes something runs only from a Button press, and Stop, Resume and
// Start room ask first. The logic lives in ./office/*.ts (pure, tested).

import { atom, read, update } from 'claude-code'
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  EngineInterface,
  InputProps,
  LinkProps,
  RasterProps,
  Register,
  RenderElement,
  SelectProps,
  TextProps,
} from 'claude-code'

import type {
  OfficeConfirm,
  OfficeDecision,
  OfficeDoc,
  OfficeGraphics,
  OfficeOutput,
  OfficePrLookup,
  OfficeRating,
  OfficeRefresh,
  OfficeRole,
  OfficePose,
  OfficeRoom,
  OfficeSend,
  OfficeStartForm,
  OfficeWorkspace,
} from '../types'
import {
  answerArgv,
  commentUrlFrom,
  nudgeTarget,
  nudgeText,
  parseDecision,
} from './office/decisions'
import {
  contractorsLine,
  costLine,
  batchSignature,
  draftsText,
  isRoleBusy,
  lastUseText,
  memoryLine,
  pilotText,
  ratioBar,
  RATINGS,
  batchActionable,
  parseBatch,
  roleBatchArgv,
  roleFailureNote,
  roleSettleArgv,
  roleSuccessNote,
  type RoleChoice,
  type RoleRatings,
} from './office/roles'
import {
  displayCommand,
  findSessionId,
  planRoomAction,
  planStart,
  startRepos,
  trackerCardRegex,
  type Plan,
  type RoomAction,
} from './office/commands'
import {
  bandAlerts,
  bandText,
  chooseLayout,
  formatAge,
  formatMoney,
  parseOfficeDoc,
  minuteSummary,
  recipeLabel,
  roomDisplay,
  roomPose,
  spendBar,
  workspaceCandidates,
  type BarSegment,
  type Layout,
  type RoomDisplay,
} from './office/parse'
import {
  hex,
  nameHash,
  pickGraphics,
  spriteRaster,
  STATUS_COLOR,
  STATUS_GLYPH,
  textArt,
  type GraphicsMode,
} from './office/sprites'

const PANE = 'office'
const REFRESH_MS = 120_000
const FRAME_MS = 650

const DEFAULT_FORM: OfficeStartForm = { repo: '', slug: '', model: 'sonnet', ref: '', liaison: '' }

const workspaceA = atom({ plugin: 'busybody', key: 'workspace' } as const, null)
const docA = atom({ plugin: 'busybody', key: 'doc' } as const, null)
const refreshA = atom({ plugin: 'busybody', key: 'refresh' } as const, null)
const draftsA = atom({ plugin: 'busybody', key: 'drafts' } as const, {})
const sendsA = atom({ plugin: 'busybody', key: 'sends' } as const, {})
const confirmA = atom({ plugin: 'busybody', key: 'confirm' } as const, null)
const outputA = atom({ plugin: 'busybody', key: 'output' } as const, null)
const showFormA = atom({ plugin: 'busybody', key: 'showForm' } as const, false)
const formA = atom({ plugin: 'busybody', key: 'form' } as const, DEFAULT_FORM)
const graphicsA = atom({ plugin: 'busybody', key: 'graphics' } as const, 'auto')
const prsA = atom({ plugin: 'busybody', key: 'prs' } as const, {})
const noticesA = atom({ plugin: 'busybody', key: 'notices' } as const, {})
const roleBatchesA = atom({ plugin: 'busybody', key: 'roleBatches' } as const, {})
const roleItemsA = atom({ plugin: 'busybody', key: 'roleItems' } as const, {})
const roleRatingsA = atom({ plugin: 'busybody', key: 'roleRatings' } as const, {})
const roleRunsA = atom({ plugin: 'busybody', key: 'roleRuns' } as const, {})

type $T = EngineInterface

type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
  Input: ElementConstructor<InputProps> | null
  Select: ElementConstructor<SelectProps> | null
  Raster: ElementConstructor<RasterProps> | null
}

const C = {
  accent: '#d2a8ff',
  wall: '#8b949e',
  warn: '#f0b429',
  danger: '#ff5f56',
  ok: '#3fb950',
  info: '#58a6ff',
  dim: '#6e7681',
  gold: '#e3b341',
}

const TONE: Record<BarSegment['tone'], string> = {
  ok: C.ok,
  warn: C.warn,
  over: C.danger,
  empty: '#30363d',
  soft: C.warn,
  hard: C.danger,
}

function firstLine(s: string): string {
  return (s.split('\n').find(l => l.trim() !== '') ?? '').trim()
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Module variables: rebuilt on every (re)load; nothing durable lives here.
let isRefreshing = false
let isPaneOpen = false
let frame = 0
let graphicsMode: GraphicsMode = 'text'
let drawn: Array<{ key: string; name: string; status: OfficePose; capped: boolean }> = []

/** What the terminal says about itself; unreadable reads as unknown. */
async function terminalEnv($: $T): Promise<{ colorterm?: string; termProgram?: string; term?: string }> {
  try {
    const [colorterm, termProgram, wt, term] = await Promise.all([
      $.env.get('COLORTERM'),
      $.env.get('TERM_PROGRAM'),
      $.env.get('WT_SESSION'),
      $.env.get('TERM'),
    ])
    return {
      ...(colorterm ? { colorterm } : {}),
      ...(termProgram ? { termProgram } : wt ? { termProgram: 'windowsterminal' } : {}),
      ...(term ? { term } : {}),
    }
  } catch {
    return {}
  }
}

// ---- state helpers --------------------------------------------------------

function setNotice($: $T, key: string, text: string | null) {
  return update($, noticesA, n => {
    const next = { ...n }
    if (text === null) delete next[key]
    else next[key] = text
    return next
  })
}

function setOutput($: $T, out: OfficeOutput | null) {
  return update($, outputA, () => out)
}

// ---- refresh: bin/rooms --json through $.process, never the model ---------

/**
 * A room's watcher is alive when `<worktree>/.claude/watch.json` names a running pid.
 * Read-only: one `sh` per room prints `alive` and nothing else counts.
 */
const WATCH_PROBE =
  'f="$1/.claude/watch.json"; [ -f "$f" ] || exit 0; ' +
  'p=$(tr -d " \\n" < "$f" | sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\'); ' +
  '[ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo alive; exit 0'

async function probeWatchers($: $T, rooms: OfficeRoom[]): Promise<void> {
  for (const room of rooms) {
    if (room.watcherAlive || room.worktree === '') continue
    try {
      const res = await $.process.run(['sh', '-c', WATCH_PROBE, 'sh', room.worktree], { timeoutMs: 5_000 })
      if (res.exitCode === 0 && res.stdout.trim() === 'alive') room.watcherAlive = true
    } catch {
      // unreadable: no watcher
    }
  }
}

// `fresh` (after an answer, a command or the Refresh button) passes --fresh: skip bin/rooms' 60 s document cache so the change shows now.
async function refresh($: $T, fresh = false): Promise<void> {
  if (isRefreshing) return
  const ws = await read($, workspaceA)
  if (ws === null) return
  isRefreshing = true
  const t0 = await $.clock.now()
  let result: OfficeRefresh
  try {
    const res = await $.process.run([`${engineRoot}/bin/rooms`, '--json', ...(fresh ? ['--fresh'] : [])], { cwd: ws, timeoutMs: 60_000 })
    const parsed =
      res.exitCode === 0
        ? parseOfficeDoc(res.stdout)
        : ({ ok: false, error: firstLine(res.stderr) || `bin/rooms exited ${res.exitCode}` } as const)
    const t1 = await $.clock.now()
    if (parsed.ok) {
      await probeWatchers($, parsed.doc.rooms)
      await update($, docA, () => parsed.doc)
      const first = parsed.doc.workspace?.repos[0]?.name
      if (first !== undefined) await update($, formA, f => (f.repo === '' ? { ...f, repo: first } : f))
      result = { at: t1, ok: true, error: null, ms: t1 - t0 }
    } else {
      result = { at: t1, ok: false, error: parsed.error, ms: t1 - t0 }
    }
  } catch (err) {
    const t1 = await $.clock.now()
    result = { at: t1, ok: false, error: errText(err).slice(0, 200), ms: t1 - t0 }
  } finally {
    isRefreshing = false
  }
  await update($, refreshA, () => result)
  await syncPrs($)
  void refreshRoleBatches($)
}

/**
 * `bin/role batch <role>` for each role with a pending memory diff: the
 * yes/no items shown on the owner's whiteboard. It is the only place memory
 * is itemised, so the office never decides what an item is. Skipped mid
 * accept/reject. A batch whose items changed drops the person's old yes/no.
 */
async function refreshRoleBatches($: $T): Promise<void> {
  const [doc, ws, runs] = await Promise.all([read($, docA), read($, workspaceA), read($, roleRunsA)])
  if (doc === null || ws === null) return
  const pending = doc.roles.filter(r => r.memoryPending)
  for (const role of pending) {
    if (runs[role.name]?.status === 'sending') continue
    const argv = roleBatchArgv(engineRoot, role.name)
    if (argv === null) continue
    let text: string
    try {
      const res = await $.process.run(argv, { cwd: ws, timeoutMs: 30_000 })
      text = res.exitCode === 0 ? res.stdout : `bin/role batch failed: ${firstLine(res.stderr) || `exit ${res.exitCode}`}`
    } catch (err) {
      text = `bin/role batch failed: ${errText(err).slice(0, 120)}`
    }
    const old = (await read($, roleBatchesA))[role.name]
    if (old !== undefined && batchSignature(old) !== batchSignature(text)) {
      await update($, roleItemsA, all => Object.fromEntries(Object.entries(all).filter(([k]) => k !== role.name)))
    }
    await update($, roleBatchesA, all => ({ ...all, [role.name]: text }))
  }
  const names = new Set(pending.map(r => r.name))
  const keep = <T,>(all: Record<string, T>) => (Object.keys(all).every(k => names.has(k)) ? all : Object.fromEntries(Object.entries(all).filter(([k]) => names.has(k))))
  await update($, roleBatchesA, keep)
  await update($, roleItemsA, keep)
}

/** The rooms' PRs come in `rooms --json` (the engine looks each one up through its shared cache), so the band never calls gh itself. */
async function syncPrs($: $T): Promise<void> {
  const doc = await read($, docA)
  if (doc === null) return
  const next: Record<string, OfficePrLookup> = {}
  for (const room of doc.rooms) next[room.name] = { pr: room.pr, checkedAt: (room.prCheckedAt ?? 0) * 1000, stale: room.prStale }
  await update($, prsA, () => next)
}

// ---- animation: repaint the pixel sprites in place ------------------------

async function tick($: $T): Promise<void> {
  if (!isPaneOpen || graphicsMode !== 'pixel' || drawn.length === 0) return
  frame = (frame + 1) % 1024
  for (const d of drawn) {
    if (d.status === 'missing' && !d.capped) continue
    const r = spriteRaster(d.name, d.status, frame, d.capped)
    try {
      await $.ui.blit({ requestId: PANE, key: d.key, cells: r.cells, columns: r.columns, rows: r.rows })
    } catch {
      // not mounted (pane redrawn or closed): the next draw catches up
    }
  }
}

// ---- running commands (only ever from a press) ----------------------------

async function runOnce($: $T, title: string, argv: string[], cwd: string | null): Promise<boolean> {
  const command = displayCommand(argv)
  await setOutput($, { title, command, text: '', status: 'running' })
  try {
    const res = await $.process.run(argv, { ...(cwd ? { cwd } : {}), timeoutMs: 120_000 })
    const text = [res.stdout.trimEnd(), res.stderr.trimEnd()].filter(s => s !== '').join('\n')
    await setOutput($, { title, command, text, status: res.exitCode === 0 ? 'ok' : 'failed' })
    return res.exitCode === 0
  } catch (err) {
    await setOutput($, { title, command, text: errText(err), status: 'failed' })
    return false
  }
}

/** Streams a long command (bin/lead-start) into the console as it runs. */
async function runStreaming($: $T, title: string, argv: string[], cwd: string | null): Promise<void> {
  const command = displayCommand(argv)
  let text = ''
  await setOutput($, { title, command, text, status: 'running' })
  try {
    const stream = $.process.spawn({ argv, ...(cwd ? { cwd } : {}) })
    let pending = 0
    const iterator = stream[Symbol.asyncIterator]()
    for (;;) {
      const step = await iterator.next()
      if (step.done) {
        const code = step.value?.code ?? null
        await setOutput($, { title, command, text, status: code === 0 ? 'ok' : 'failed' })
        break
      }
      text = (text + step.value.text).slice(-8000)
      pending += 1
      if (pending >= 1) {
        pending = 0
        await setOutput($, { title, command, text, status: 'running' })
      }
    }
  } catch (err) {
    await setOutput($, { title, command, text: `${text}\n${errText(err)}`.trim(), status: 'failed' })
  }
  void refresh($, true)
}

async function ask($: $T, c: OfficeConfirm): Promise<void> {
  await update($, confirmA, () => c)
}

async function onConfirmYes($: $T): Promise<void> {
  const c = await read($, confirmA)
  if (c === null) return
  await update($, confirmA, () => null)
  if (c.isLong) {
    void runStreaming($, c.title, c.argv, c.cwd)
    return
  }
  await runOnce($, c.title, c.argv, c.cwd)
  void refresh($, true)
}

async function onRoomAction($: $T, action: RoomAction, name: string): Promise<void> {
  const doc = await read($, docA)
  const room = doc?.rooms.find(r => r.name === name)
  if (!room) return
  const prs = await read($, prsA)
  let plan: Plan = planRoomAction(action, room, { pr: prs[name], workspace: doc?.workspace ?? null })
  if (plan.kind === 'lookup') {
    await setNotice($, name, `${plan.title}…`)
    {
      let sid: string | null = null
      try {
        const res = await $.process.run(plan.argv, { timeoutMs: 20_000 })
        sid = res.exitCode === 0 ? findSessionId(res.stdout, name) : null
      } catch {
        sid = null
      }
      plan = sid
        ? planRoomAction(action, room, { sessionId: sid, workspace: doc?.workspace ?? null })
        : {
            kind: 'disabled',
            reason: `No saved session named ${name}. From the repo's main checkout: claude --resume (busybody:workstream-lead §8).`,
          }
    }
  }
  switch (plan.kind) {
    case 'disabled':
      await setNotice($, name, plan.reason)
      return
    case 'show':
      await setNotice($, name, null)
      await setOutput($, { title: plan.title, command: '', text: plan.text, status: 'ok' })
      return
    case 'run':
      await setNotice($, name, null)
      if (plan.confirm !== null) {
        await ask($, { title: plan.title, detail: plan.confirm, argv: plan.argv, cwd: plan.cwd, isLong: false })
        return
      }
      await runOnce($, plan.title, plan.argv, plan.cwd)
      return
    case 'lookup':
      return
  }
}

// ---- decisions inbox: Send posts exactly what was typed -------------------

/** What an answer is nudged to: a project room's head desk, or a running role session (same `lead` shape). */
type NudgeTarget = { name: string; lead: OfficeRoom['lead'] }

async function sendAnswer($: $T, d: OfficeDecision): Promise<void> {
  const drafts = await read($, draftsA)
  const typed = drafts[d.key] ?? ''
  const setSend = (s: OfficeSend) => update($, sendsA, all => ({ ...all, [d.key]: s }))
  // Answers go to the minutes repo named by office.json; with none, nothing is posted (fail loudly, never a guessed repo).
  const minutesRepo = (await read($, docA))?.workspace?.minutesRepo ?? ''
  if (minutesRepo === '') {
    await setSend({ status: 'failed', note: 'office.json has no minutesRepo: run `busybody init`. Nothing was sent.' })
    return
  }
  const argv = answerArgv(d.issue, typed, minutesRepo)
  if (argv === null) {
    await setSend({ status: 'failed', note: 'Type an answer first: nothing was sent.' })
    return
  }
  await setSend({ status: 'sending', note: `Posting to #${d.issue}…` })
  let stdout = ''
  try {
    const res = await $.process.run(argv, { timeoutMs: 30_000 })
    if (res.exitCode !== 0) {
      await setSend({ status: 'failed', note: `gh failed: ${firstLine(res.stderr) || `exit ${res.exitCode}`}` })
      return
    }
    stdout = res.stdout
  } catch (err) {
    await setSend({ status: 'failed', note: `gh failed: ${errText(err).slice(0, 160)}` })
    return
  }
  const url = commentUrlFrom(stdout)
  let note = url ? `Posted ${url}` : `Posted on #${d.issue}`
  const doc = await read($, docA)
  const room: NudgeTarget | undefined =
    doc?.rooms.find(r => r.name === d.room) ?? doc?.roleSessions.find(r => r.name === d.room)
  const isRunning = room !== undefined && room.lead.status !== 'missing'
  if (url !== null && room !== undefined && isRunning) {
    note += await nudgeLead($, room, url)
  } else {
    note += ' · no nudge: the room is not running'
  }
  await setSend({ status: 'sent', note })
  await update($, draftsA, all => {
    const next = { ...all }
    delete next[d.key]
    return next
  })
  void refresh($, true)
}

/**
 * Sends the lead the link-only nudge through `$.session.send`, the same
 * delivery as the SendMessage tool, addressed by the lead's session id (the
 * room name when the id is unknown). Never sends to this session itself.
 */
async function nudgeLead($: $T, room: NudgeTarget, url: string): Promise<string> {
  const target = nudgeTarget(room, await ownSessionId($))
  if (target === null) return ' · no nudge: the head desk is this session'
  try {
    const sent = await $.session.send({ to: target, text: nudgeText(room.name, url) })
    return sent.isDelivered ? ' · room nudged with the link' : ` · nudge not delivered (${sent.reason})`
  } catch (err) {
    return ` · nudge failed (${errText(err).slice(0, 80)})`
  }
}

async function ownSessionId($: $T): Promise<string | null> {
  try {
    return await $.session.id()
  } catch {
    return null
  }
}

// ---- memory review: only the person's press runs bin/role accept|reject ----

/**
 * One press settles the whole batch with the one command the screen shows.
 * The batch is re-read first: if its items moved since the person decided
 * (another pass, the controller, a second office), nothing runs.
 */
async function runRole($: $T, name: string): Promise<void> {
  const [ws, ratings, choices, batches, runs] = await Promise.all([
    read($, workspaceA),
    read($, roleRatingsA),
    read($, roleItemsA),
    read($, roleBatchesA),
    read($, roleRunsA),
  ])
  if (runs[name]?.status === 'sending') return
  const setRun = (s: OfficeSend | null) =>
    update($, roleRunsA, all => {
      const next = { ...all }
      if (s === null) delete next[name]
      else next[name] = s
      return next
    })
  const plan = roleSettleArgv(engineRoot, name, parseBatch(batches[name] ?? ''), choices[name] ?? {}, ratings[name] ?? { draft: null, memory: null })
  if (plan === null) {
    await setRun({ status: 'failed', note: 'Decide every item and pick both ratings first: nothing ran.' })
    return
  }
  await setRun({ status: 'sending', note: `Checking the batch, then ${displayCommand(plan.argv)}…` })
  try {
    const fresh = await $.process.run([`${engineRoot}/bin/role`, 'batch', name], { ...(ws ? { cwd: ws } : {}), timeoutMs: 30_000 })
    if (fresh.exitCode !== 0 || batchSignature(fresh.stdout) !== batchSignature(batches[name] ?? '')) {
      await update($, roleBatchesA, all => ({ ...all, [name]: fresh.stdout }))
      await update($, roleItemsA, all => Object.fromEntries(Object.entries(all).filter(([k]) => k !== name)))
      await setRun({ status: 'failed', note: 'The batch changed since you decided (resolved elsewhere?): nothing ran. Decide again.' })
      return
    }
    const res = await $.process.run(plan.argv, { ...(ws ? { cwd: ws } : {}), timeoutMs: 60_000 })
    if (res.exitCode !== 0) {
      await setRun({ status: 'failed', note: roleFailureNote(plan.action, res.exitCode, res.stdout, res.stderr) })
      return
    }
    await setRun({ status: 'sent', note: roleSuccessNote(plan.action, res.stdout) })
    const without = <T,>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== name))
    await update($, roleRatingsA, without)
    await update($, roleItemsA, without)
  } catch (err) {
    await setRun({ status: 'failed', note: `bin/role ${plan.action} did not run: ${errText(err).slice(0, 200)}` })
    return
  }
  void refresh($, true)
}

// ---- start room -----------------------------------------------------------

async function onStart($: $T, isDryRun: boolean): Promise<void> {
  const ws = (await read($, workspaceA)) ?? ''
  const form = await read($, formA)
  const plan = planStart(ws, form, isDryRun, (await read($, docA))?.workspace ?? null, engineRoot)
  if (plan.argv === null) {
    await setNotice($, 'start', plan.errors.join(' '))
    return
  }
  await setNotice($, 'start', plan.notes.length > 0 ? plan.notes.join(' ') : null)
  if (isDryRun) {
    void runStreaming($, `Dry run: room-${form.slug.trim()}`, plan.argv, ws)
    return
  }
  await ask($, {
    title: `Start room-${form.slug.trim()}`,
    detail: `Start a ${form.model} project room (head desk: room lead) for ${form.repo} in room-${form.slug.trim()}? It creates a worktree, ${
      plan.issue ? `uses issue #${plan.issue}` : 'opens a new initiative issue'
    } and launches a background session.`,
    argv: plan.argv,
    cwd: ws,
    isLong: true,
  })
}

// ---- drawing helpers (plain functions returning trees) --------------------

function drawHeader(
  kit: Kit,
  $: $T,
  v: {
    doc: OfficeDoc | null
    refreshState: OfficeRefresh | null
    now: number
    width: number
    graphicsPref: OfficeGraphics
    graphicsMode: GraphicsMode
    ws: string | null
  },
): RenderElement {
  const { Box, Text, Button } = kit
  const n = v.doc?.rooms.length ?? 0
  const dec = v.doc?.decisions.length ?? 0
  const today = v.doc?.totals.today ?? 0
  const busy = v.doc?.rooms.filter(r => r.lead.status === 'busy').length ?? 0
  const active = v.doc?.rooms.filter(r => roomDisplay(r).isActive).length ?? 0
  const ago = v.refreshState ? formatAge(Math.max(0, (v.now - v.refreshState.at) / 1000)) : null
  const nextGraphics: OfficeGraphics = v.graphicsPref === 'auto' ? 'pixel' : v.graphicsPref === 'pixel' ? 'text' : 'auto'
  const skyline = '▁▃▅▂▇▃▆▂▄▇▅▂▃▆▁▅▃▇▂▄'
  return (
    <Box key="hdr" flexDirection="column">
      <Box key="hdr-row" flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={C.accent} bold>{'▛▀▜ '}</Text>
          <Text bold>{`${(v.doc?.workspace?.name || 'OFFICE').toUpperCase()}`}</Text>
          <Text color={C.dim}>{' Busybody'}</Text>
          <Text color={C.dim}>{'  '}</Text>
          <Text color={C.ok}>{`${busy}/${active} at work${n > active ? ` · ✓ ${n - active} done` : ''}`}</Text>
          <Text color={C.dim}>{' · '}</Text>
          <Text color={dec > 0 ? C.warn : C.dim} bold={dec > 0}>{`${dec} sticky note${dec === 1 ? '' : 's'} for you`}</Text>
          <Text color={C.dim}>{' · '}</Text>
          <Text color={C.gold}>{`${formatMoney(today)} today`}</Text>
        </Text>
        <Text color={v.refreshState?.ok === false ? C.danger : C.dim} wrap="truncate-end">
          {v.refreshState === null
            ? 'refreshing…'
            : v.refreshState.ok
              ? `↻ ${ago} ago`
              : `↻ failed: ${v.refreshState.error ?? ''}`}
        </Text>
      </Box>
      <Text color="#30363d">{skyline.repeat(Math.ceil(v.width / skyline.length)).slice(0, v.width)}</Text>
      <Box key="hdr-btns" flexDirection="row" gap={1}>
        <Button key="refresh" label="↻ Refresh" hotkey="r" onPress={() => void refresh($, true)} />
        <Button
          key="start-toggle"
          label="＋ Start room"
          hotkey="n"
          onPress={() => void update($, showFormA, s => !s)}
        />
        <Button
          key="graphics"
          label={`sprites: ${v.graphicsPref}${v.graphicsPref === 'auto' ? ` (${v.graphicsMode})` : ''}`}
          hotkey="g"
          dimColor
          onPress={() => void update($, graphicsA, () => nextGraphics)}
        />
      </Box>
    </Box>
  )
}

function drawConfirm(kit: Kit, $: $T, c: OfficeConfirm): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="confirm" flexDirection="column" borderStyle="double" borderColor={C.warn} paddingX={1}>
      <Text color={C.warn} bold>{`⚠ ${c.title}`}</Text>
      <Text>{c.detail}</Text>
      <Text color={C.dim} wrap="truncate-end">{`runs: ${displayCommand(c.argv)}`}</Text>
      <Box key="confirm-btns" flexDirection="row" gap={1}>
        <Button key="confirm-yes" label="Yes, run it" variant="primary" onPress={() => void onConfirmYes($)} />
        <Button key="confirm-no" label="Cancel" onPress={() => void update($, confirmA, () => null)} />
      </Box>
    </Box>
  )
}

function drawInbox(
  kit: Kit,
  $: $T,
  v: {
    doc: OfficeDoc | null
    drafts: Record<string, string>
    sends: Record<string, OfficeSend>
    width: number
    now: number
    ws: string | null
    roleBatches: Record<string, string>
    roleItems: Record<string, Record<number, RoleChoice>>
    roleRatings: Record<string, RoleRatings>
    roleRuns: Record<string, OfficeSend>
  },
): RenderElement {
  const { Box, Text, Button, Input, Link } = kit
  const decisions = v.doc?.decisions ?? []
  const reviews = (v.doc?.roles ?? []).filter(r => r.memoryPending)
  const waiting = decisions.length + reviews.length
  const hasWork = waiting > 0
  // Answered ones linger with their result until the next refresh drops them.
  return (
    <Box
      key="inbox"
      flexDirection="column"
      borderStyle={hasWork ? 'double' : 'round'}
      borderColor={hasWork ? C.warn : '#30363d'}
      paddingX={1}
    >
      <Text>
        <Text color={C.gold} bold>{'🧾 CONTROL ROOM'}</Text>
        <Text color={C.dim}>{'  owner’s whiteboard · '}</Text>
        <Text color={hasWork ? C.warn : C.ok} bold={hasWork}>
          {hasWork ? `${waiting} sticky note${waiting === 1 ? '' : 's'}` : 'no sticky notes'}
        </Text>
      </Text>
      {!hasWork ? <Text color={C.dim}>Your whiteboard is clear: no sticky notes. The rooms are on it.</Text> : null}
      {v.doc?.rolesError ? <Text color={C.warn} wrap="truncate-end">{`staff rooms unavailable: ${v.doc.rolesError}`}</Text> : null}
      {decisions.map((d, i) => {
        const p = parseDecision(d.body)
        const id = `d${nameHash(d.key).toString(36)}`
        const draft = v.drafts[d.key] ?? ''
        const send = v.sends[d.key]
        const room = v.doc?.rooms.find(r => r.name === d.room)
        const age = room?.latest?.url === d.url ? room.latest.ageS : null
        return (
          <Box key={id} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
            <Text>
              <Text color={C.warn}>{'◆ '}</Text>
              <Text bold>{d.room || 'room'}</Text>
              <Text color={C.dim}>{` · #${d.issue}${age !== null ? ` · ${formatAge(age)} ago` : ''}`}</Text>
              {p.blocks === true ? <Text color={C.danger}>{' · blocks the work'}</Text> : null}
            </Text>
            <Text bold>{`  ${p.question}`}</Text>
            {p.isStructured ? (
              <Box key={`${id}-opts`} flexDirection="column" paddingLeft={2}>
                {p.options.map((o, j) => (
                  <Text>
                    <Text color={C.info}>{`${j + 1}. `}</Text>
                    {o}
                  </Text>
                ))}
                {p.recommendation !== null ? (
                  <Text>
                    <Text color={C.gold}>{'★ Recommends: '}</Text>
                    {p.recommendation}
                  </Text>
                ) : null}
              </Box>
            ) : (
              <Box key={`${id}-body`} paddingLeft={2}>
                <Text color={C.wall}>{d.body.split('\n').slice(1).join('\n').trim() || d.body}</Text>
              </Box>
            )}
            {d.url ? (
              <Box key={`${id}-link`} paddingLeft={2}>
                <Link href={d.url} label="read the whole comment ↗" />
              </Box>
            ) : null}
            {Input ? (
              <Box key={`${id}-answer`} flexDirection="row" gap={1} paddingLeft={2}>
                <Input
                  key={`${id}-input`}
                  label="Your answer ›"
                  placeholder="type it exactly as it should be posted"
                  value={draft}
                  submitLabel="keep"
                  onInput={value => void update($, draftsA, all => ({ ...all, [d.key]: value }))}
                  onSubmit={value => void update($, draftsA, all => ({ ...all, [d.key]: value }))}
                />
                <Button
                  key={`${id}-send`}
                  label={send?.status === 'sending' ? 'Sending…' : 'Send'}
                  variant="primary"
                  onPress={() => sendAnswer($, d)}
                />
              </Box>
            ) : (
              <Text color={C.dim}>{'  Answer from a terminal or desktop session (this surface has no text field).'}</Text>
            )}
            {draft.trim() !== '' ? (
              <Text color={C.dim} wrap="truncate-end">{`  will post: ANSWER (from the user): "${draft}"`}</Text>
            ) : null}
            {send ? (
              <Text color={send.status === 'failed' ? C.danger : send.status === 'sent' ? C.ok : C.dim}>
                {`  ${send.status === 'sent' ? '✓' : send.status === 'failed' ? '✗' : '…'} ${send.note}`}
              </Text>
            ) : null}
          </Box>
        )
      })}
      {reviews.length > 0 ? (
        <Box key="reviews" flexDirection="column" marginTop={decisions.length > 0 ? 1 : 0}>
          <Text color={C.accent} bold>{'📝 memory reviews (sticky notes)'}</Text>
          {reviews.map(role =>
            drawReview(kit, $, role, {
              ws: v.ws,
              batch: v.roleBatches[role.name],
              choices: v.roleItems[role.name] ?? {},
              ratings: v.roleRatings[role.name] ?? { draft: null, memory: null },
              run: v.roleRuns[role.name],
            }),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * One role's pending memory, as the yes/no items `bin/role batch` prints (at
 * most 5). Nothing runs until the person decides every item, picks both
 * ratings and presses Apply; the exact command is shown first and changes
 * with every choice. This is the only path that resolves memory from the
 * office: no per-item accept/reject of its own.
 */
function drawReview(
  kit: Kit,
  $: $T,
  role: OfficeRole,
  v: {
    ws: string | null
    batch: string | undefined
    choices: Record<number, RoleChoice>
    ratings: RoleRatings
    run: OfficeSend | undefined
  },
): RenderElement {
  const { Box, Text, Button } = kit
  const id = nameHash(role.name).toString(36)
  const parsed = v.batch === undefined ? null : parseBatch(v.batch)
  const items = parsed?.items ?? []
  const plan = parsed === null ? null : roleSettleArgv(engineRoot, role.name, parsed, v.choices, v.ratings)
  const busy = v.run?.status === 'sending'
  const setChoice = (n: number, c: RoleChoice) =>
    void update($, roleItemsA, all => ({ ...all, [role.name]: { ...(all[role.name] ?? {}), [n]: c } }))
  const setRating = (k: 'draft' | 'memory', r: OfficeRating) =>
    void update($, roleRatingsA, all => ({ ...all, [role.name]: { ...(all[role.name] ?? { draft: null, memory: null }), [k]: r } }))
  const missing = [
    items.some(it => v.choices[it.n] === undefined) ? 'decide every item' : null,
    parsed !== null && !batchActionable(parsed) ? 'nothing to apply' : null,
    v.ratings.draft === null ? 'rate the drafts' : null,
    v.ratings.memory === null ? 'rate the memory' : null,
  ].filter(x => x !== null)
  return (
    <Box key={`rv-${id}`} flexDirection="column" paddingLeft={1} marginTop={1}>
      <Text>
        <Text color={C.accent}>{'◆ '}</Text>
        <Text bold>{role.name}</Text>
        <Text color={C.dim}>{` · ${role.pendingFiles} file${role.pendingFiles === 1 ? '' : 's'} changed · bin/role batch ${role.name}`}</Text>
      </Text>
      <Box key={`rv-items-${id}`} flexDirection="column" paddingLeft={2}>
        {parsed === null ? <Text color={C.dim}>reading the batch…</Text> : null}
        {parsed !== null && items.length === 0 ? (
          <Text color={parsed.candidateLines > 0 ? C.dim : C.warn}>{firstLine(v.batch ?? '') || '(bin/role batch printed no items)'}</Text>
        ) : null}
        {items.map(it => (
          <Box key={`rv-${id}-i${it.n}`} flexDirection="column">
            <Text color={it.kind === 'ARCHIVE' ? C.danger : it.kind === 'PROMOTE' || it.kind === 'RESTORE' ? C.ok : C.wall}>
              {`[${it.n}] ${it.label}`}
            </Text>
            <Box key={`rv-${id}-i${it.n}-btns`} flexDirection="row" gap={1} paddingLeft={4}>
              <Button
                key={`rv-${id}-i${it.n}-yes`}
                label={`${v.choices[it.n] === 'yes' ? '● ' : '○ '}yes`}
                variant={v.choices[it.n] === 'yes' ? 'primary' : undefined}
                onPress={() => setChoice(it.n, 'yes')}
              />
              <Button
                key={`rv-${id}-i${it.n}-no`}
                label={`${v.choices[it.n] === 'no' ? '● ' : '○ '}no`}
                variant={v.choices[it.n] === 'no' ? 'primary' : undefined}
                onPress={() => setChoice(it.n, 'no')}
              />
            </Box>
          </Box>
        ))}
        {parsed !== null && parsed.overflow > 0 ? (
          <Text color={C.dim}>{`… ${parsed.overflow} more item${parsed.overflow === 1 ? '' : 's'} wait for the next pass, kept on disk whether you accept or reject (max 5 per pass)`}</Text>
        ) : null}
        {parsed?.guard ? <Text color={C.danger}>{parsed.guard}</Text> : null}
      </Box>
      {(['draft', 'memory'] as const).map(k => (
        <Box key={`rv-rate-${k}-${id}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Text color={C.dim}>{k === 'draft' ? 'Drafts worth ›' : 'Memory worth ›'}</Text>
          {RATINGS.map(r => (
            <Button
              key={`rv-${id}-${k}-${r}`}
              label={`${v.ratings[k] === r ? '● ' : '○ '}${r}`}
              variant={v.ratings[k] === r ? 'primary' : undefined}
              onPress={() => setRating(k, r)}
            />
          ))}
        </Box>
      ))}
      <Text color={C.dim}>{`  Apply runs: ${plan ? displayCommand(plan.argv) : `${missing.join(', ')} first`}`}</Text>
      <Box key={`rv-btns-${id}`} flexDirection="row" gap={1} paddingLeft={2}>
        <Button
          key={`rv-${id}-apply`}
          label={busy ? 'Running…' : plan?.action === 'reject' ? 'Apply (reject all)' : 'Apply'}
          variant="primary"
          onPress={() => runRole($, role.name)}
        />
      </Box>
      {v.run ? (
        <Text color={v.run.status === 'failed' ? C.danger : v.run.status === 'sent' ? C.ok : C.dim}>
          {`  ${v.run.status === 'sent' ? '✓' : v.run.status === 'failed' ? '✗' : '…'} ${v.run.note}`}
        </Text>
      ) : null}
    </Box>
  )
}

/** What a sprite needs: a room's lead, or a role dressed as one. */
type SpriteSubject = { name: string; capped: boolean; lead: { status: OfficeRoom['lead']['status'] }; pose?: OfficePose }

function drawSprite(kit: Kit, room: SpriteSubject, f: number, compact: boolean): RenderElement {
  const { Box, Text, Raster } = kit
  const pose = room.pose ?? room.lead.status
  const key = `spr-${nameHash(room.name).toString(36)}`
  if (compact) {
    const color = room.capped ? C.danger : hex(STATUS_COLOR[pose])
    return <Text color={color} bold>{room.capped ? '■' : STATUS_GLYPH[pose]}</Text>
  }
  if (graphicsMode === 'pixel' && Raster !== null) {
    const r = spriteRaster(room.name, pose, f, room.capped)
    drawn.push({ key, name: room.name, status: pose, capped: room.capped })
    return (
      <Box key={`${key}-box`} width={r.columns} flexShrink={0}>
        <Raster key={key} columns={r.columns} rows={r.rows} cells={r.cells} />
      </Box>
    )
  }
  const lines = textArt(room.name, pose, f, room.capped)
  return (
    <Box key={`${key}-box`} flexDirection="column" width={16} flexShrink={0}>
      {lines.map(segs => (
        <Text>
          {segs.map(s => (s.color === null ? s.text : <Text color={s.color}>{s.text}</Text>))}
        </Text>
      ))}
    </Box>
  )
}

function drawBar(kit: Kit, room: OfficeRoom, width: number): RenderElement {
  const { Text } = kit
  if (room.cost === null) return <Text color={C.dim}>spend: unknown</Text>
  const c = room.cost
  const segs = spendBar(c.today, c.soft, c.hard, width)
  return (
    <Text>
      <Text color={C.gold}>{`${formatMoney(c.today)} `}</Text>
      {segs.map(s => (
        <Text color={TONE[s.tone]}>{s.text}</Text>
      ))}
      <Text color={C.dim}>{` soft ${formatMoney(c.soft)} · hard ${formatMoney(c.hard)}`}</Text>
    </Text>
  )
}

function warningFor(d: RoomDisplay): { text: string; color: string } | null {
  if (d.warning === null) return null
  return { text: d.warning.text, color: d.warning.tone === 'danger' ? C.danger : C.warn }
}

const DISPLAY_GLYPH: Record<RoomDisplay['kind'], string> = {
  busy: STATUS_GLYPH.busy,
  idle: STATUS_GLYPH.idle,
  needs_input: STATUS_GLYPH.needs_input,
  stalled: STATUS_GLYPH.missing,
  watching: STATUS_GLYPH.watching,
  waiting: STATUS_GLYPH.waiting,
  capped: '■',
  done: '✓',
}

function drawButtons(kit: Kit, $: $T, room: OfficeRoom, pr: OfficePrLookup | undefined, short: boolean): RenderElement {
  const { Box, Button } = kit
  const id = nameHash(room.name).toString(36)
  const prLabel = (pr?.pr ? `PR #${pr.pr.number}` : 'PR') + (pr?.stale ? ' (stale)' : '')
  const btn = (action: RoomAction, label: string, shortLabel: string, dim = false) => (
    <Button
      key={`${action}-${id}`}
      label={short ? shortLabel : label}
      dimColor={dim}
      onPress={() => onRoomAction($, action, room.name)}
    />
  )
  const isMissing = room.lead.status === 'missing'
  return (
    <Box key={`btns-${id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      {btn('stop', '■ Stop', 'stop', isMissing)}
      {btn('resume', '▶ Resume', 'resume', !isMissing || room.capped)}
      {btn('attach', '⧉ Attach', 'attach')}
      {btn('issue', `# Issue ${room.issue}`, `#${room.issue}`)}
      {btn('pr', `⇡ ${prLabel}`, prLabel.toLowerCase(), pr !== undefined && pr.pr === null)}
    </Box>
  )
}

function drawRoom(
  kit: Kit,
  $: $T,
  room: OfficeRoom,
  v: { width: number; layout: Layout; pr: OfficePrLookup | undefined; notice: string | null; frame: number },
): RenderElement {
  const { Box, Text } = kit
  const id = nameHash(room.name).toString(36)
  const status = roomPose(room)
  const color = room.capped ? C.danger : hex(STATUS_COLOR[status])
  const display = roomDisplay(room)
  const warn = warningFor(display)
  const latest = room.latest
  const compact = v.layout === 'compact'
  const inner = Math.max(20, v.width - 4)
  const textWidth = compact ? inner : Math.max(16, inner - 18)
  const barWidth = Math.max(6, Math.min(24, textWidth - 34))
  const leadLine = (
    <Text wrap="truncate-end">
      <Text color={color} bold>{`${DISPLAY_GLYPH[display.kind]} ${display.label}`}</Text>
      <Text color={C.dim}>{` · ${room.model || 'head desk'}`}</Text>
      {recipeLabel(room) ? <Text color={C.dim}>{` · ${recipeLabel(room)}`}</Text> : null}
      {room.cost && Object.keys(room.cost.mix).length > 1 ? (
        <Text color={C.dim}>{` · mix ${Object.entries(room.cost.mix)
          .map(([m, x]) => `${m} ${formatMoney(x)}`)
          .join(' + ')}`}</Text>
      ) : null}
    </Text>
  )
  const reportLine = latest ? (
    <Text wrap="truncate-end">
      <Text color={latest.verb === 'DECISION' || latest.verb === 'BLOCKED' ? C.warn : latest.verb === 'DONE' ? C.ok : C.info} bold>
        {latest.verb || 'NOTE'}
      </Text>
      <Text color={C.dim}>{` ${formatAge(latest.ageS)} ago · `}</Text>
      {minuteSummary(latest)}
    </Text>
  ) : (
    <Text color={C.dim}>no report yet</Text>
  )
  const title = (
    <Box key={`title-${id}`} flexDirection="row" justifyContent="space-between">
      <Text wrap="truncate-end">
        {compact ? drawSprite(kit, { ...room, pose: status }, v.frame, true) : null}
        {compact ? ' ' : ''}
        <Text bold color={room.capped ? C.danger : undefined}>{room.name}</Text>
      </Text>
      <Text color={C.dim}>{`#${room.issue} · ${room.repo}`}</Text>
    </Box>
  )
  if (compact) {
    return (
      <Box key={`room-${id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={v.width}>
        {title}
        {recipeLabel(room) ? <Text color={C.dim} wrap="truncate-end">{recipeLabel(room)}</Text> : null}
        {reportLine}
        {drawBar(kit, room, Math.max(6, Math.min(16, inner - 34)))}
        {warn ? <Text color={warn.color} wrap="truncate-end">{warn.text}</Text> : null}
        {v.notice ? <Text color={C.dim} wrap="truncate-end">{`↳ ${v.notice}`}</Text> : null}
        {drawButtons(kit, $, room, v.pr, true)}
      </Box>
    )
  }
  return (
    <Box
      key={`room-${id}`}
      flexDirection="column"
      borderStyle={room.capped ? 'bold' : 'round'}
      borderColor={color}
      paddingX={1}
      width={v.width}
    >
      {title}
      <Box key={`desk-${id}`} flexDirection="row" gap={2}>
        {drawSprite(kit, { ...room, pose: status }, v.frame, false)}
        <Box key={`info-${id}`} flexDirection="column" flexGrow={1} width={textWidth}>
          {leadLine}
          {reportLine}
          {drawBar(kit, room, barWidth)}
          {warn ? <Text color={warn.color} wrap="truncate-end">{warn.text}</Text> : null}
        </Box>
      </Box>
      {v.notice ? <Text color={C.dim} wrap="truncate-end">{`↳ ${v.notice}`}</Text> : null}
      {drawButtons(kit, $, room, v.pr, false)}
    </Box>
  )
}

function drawRooms(
  kit: Kit,
  $: $T,
  v: {
    rooms: OfficeRoom[]
    layout: Layout
    width: number
    prs: Record<string, OfficePrLookup>
    notices: Record<string, string>
    frame: number
  },
): RenderElement {
  const { Box, Text } = kit
  if (v.rooms.length === 0) {
    return (
      <Box key="floor" flexDirection="column" borderStyle="round" borderColor="#30363d" paddingX={1}>
        <Text color={C.accent} bold>{'🏗 PROJECT ROOMS'}</Text>
        <Text color={C.dim}>No project rooms: no open initiative has a room. ＋ Start room opens one.</Text>
      </Box>
    )
  }
  const cardWidth = v.layout === 'wide' ? Math.floor((v.width - 1) / 2) : v.width
  const active = v.rooms.filter(r => roomDisplay(r).isActive)
  const done = v.rooms.filter(r => !roomDisplay(r).isActive)
  return (
    <Box key="floor-all" flexDirection="column">
      <Text>
        <Text color={C.accent} bold>{'🏗 PROJECT ROOMS'}</Text>
        <Text color={C.dim}>{`  head desk: the room lead · ${active.length} at work`}</Text>
      </Text>
      {active.length > 0 ? (
        <Box key="floor" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {active.map(room =>
            drawRoom(kit, $, room, {
              width: cardWidth,
              layout: v.layout,
              pr: v.prs[room.name],
              notice: v.notices[room.name] ?? null,
              frame: v.frame,
            }),
          )}
        </Box>
      ) : (
        <Text color={C.dim}>No project room is at work right now.</Text>
      )}
      {done.length > 0 ? (
        <Box key="done-shelf" flexDirection="column" borderStyle="single" borderColor="#30363d" borderDimColor paddingX={1}>
          <Text color={C.dim}>{`✓ DONE project rooms · awaiting merge/release (${done.length})`}</Text>
          {done.map(room => drawDone(kit, $, room, v.prs[room.name], v.notices[room.name] ?? null))}
        </Box>
      ) : null}
    </Box>
  )
}

/** A finished room: one dimmed, collapsed row group at the bottom. */
function drawDone(kit: Kit, $: $T, room: OfficeRoom, pr: OfficePrLookup | undefined, notice: string | null): RenderElement {
  const { Box, Text, Button, Link } = kit
  const id = nameHash(room.name).toString(36)
  const status = room.statusLine.split('\n').map(l => l.trim()).filter(l => l !== '')
  return (
    <Box key={`done-${id}`} flexDirection="column" marginTop={1}>
      <Box key={`done-head-${id}`} flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color={C.ok}>{'✓ '}</Text>
          <Text dimColor bold>{room.name}</Text>
          <Text color={C.dim}>{' · Done · awaiting merge/release'}</Text>
        </Text>
        <Text color={C.dim}>{`#${room.issue} · ${room.repo}${room.latest ? ` · ${formatAge(room.latest.ageS)} ago` : ''}`}</Text>
      </Box>
      {status.map(line => (
        <Text color={C.dim} wrap="truncate-end">{`  ${line}`}</Text>
      ))}
      {pr?.pr ? (
        <Box key={`done-pr-${id}`} paddingLeft={2}>
          <Link href={pr.pr.url} label={`PR #${pr.pr.number} (${pr.pr.isDraft ? 'draft' : pr.pr.state.toLowerCase()}) ↗`} />
        </Box>
      ) : null}
      {notice ? <Text color={C.dim} wrap="truncate-end">{`  ↳ ${notice}`}</Text> : null}
      <Box key={`done-btns-${id}`} flexDirection="row" columnGap={1} paddingLeft={2}>
        <Button key={`issue-${id}`} label={`# Issue ${room.issue}`} dimColor onPress={() => onRoomAction($, 'issue', room.name)} />
        <Button
          key={`pr-${id}`}
          label={pr?.pr ? `⇡ PR #${pr.pr.number}` : '⇡ PR'}
          dimColor
          onPress={() => onRoomAction($, 'pr', room.name)}
        />
      </Box>
    </Box>
  )
}

// ---- staff: one fixed desk per enabled role, disabled ones on a shelf -------

function drawRoleDesk(kit: Kit, $: $T, role: OfficeRole, v: { width: number; layout: Layout; now: number; frame: number }): RenderElement {
  const { Box, Text } = kit
  const id = nameHash(role.name).toString(36)
  const isBusy = isRoleBusy(role, v.now)
  const compact = v.layout === 'compact'
  const subject: SpriteSubject = { name: `role:${role.name}`, capped: false, lead: { status: isBusy ? 'busy' : 'idle' } }
  const color = role.memoryPending ? C.accent : isBusy ? C.ok : C.wall
  const inner = Math.max(20, v.width - 4)
  const textWidth = compact ? inner : Math.max(16, inner - 18)
  const barWidth = Math.max(6, Math.min(16, textWidth - 40))
  const tone = (segs: BarSegment[]) => segs.map(s => <Text color={TONE[s.tone]}>{s.text}</Text>)
  const mem = role.memory
  const memTone = mem.indexBytes >= mem.capIndex ? C.danger : C.dim
  const info = (
    <Box key={`rinfo-${id}`} flexDirection="column" flexGrow={1} width={textWidth}>
      <Text wrap="truncate-end">
        <Text color={isBusy ? C.ok : C.info} bold>{isBusy ? '⌨ at work' : '☕ idle'}</Text>
        <Text color={C.dim}>{` · ${pilotText(role)}`}</Text>
      </Text>
      {role.goal !== '' ? <Text color={C.dim} wrap="truncate-end">{role.goal}</Text> : null}
      <Text wrap="truncate-end">
        <Text color={memTone}>{`${memoryLine(role)} `}</Text>
        {tone(ratioBar(mem.indexBytes, mem.capIndex, barWidth))}
      </Text>
      <Text wrap="truncate-end">
        <Text color={C.gold}>{`${costLine(role)} `}</Text>
        {tone(ratioBar(role.cost.month, role.cost.budget, barWidth))}
      </Text>
      <Text color={C.dim} wrap="truncate-end">{contractorsLine(role)}</Text>
      <Text color={C.dim} wrap="truncate-end">
        {[lastUseText(role), `${role.useCount} use${role.useCount === 1 ? '' : 's'}`, draftsText(role)].filter(s => s !== null).join(' · ')}
      </Text>
      {role.flags.map(flag => (
        <Text color={C.warn} wrap="truncate-end">{`⚠ ${flag}`}</Text>
      ))}
    </Box>
  )
  return (
    <Box key={`role-${id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={v.width}>
      <Box key={`rtitle-${id}`} flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          {compact ? drawSprite(kit, subject, v.frame, true) : null}
          {compact ? ' ' : ''}
          <Text bold>{role.name}</Text>
          {role.memoryPending ? <Text color={C.accent}>{' 📝'}</Text> : null}
        </Text>
        <Text color={C.dim}>{role.issue === null ? 'staff room' : `staff room · #${role.issue}`}</Text>
      </Box>
      {compact ? (
        info
      ) : (
        <Box key={`rdesk-${id}`} flexDirection="row" gap={2}>
          {drawSprite(kit, subject, v.frame, false)}
          {info}
        </Box>
      )}
    </Box>
  )
}

function drawStaff(kit: Kit, $: $T, v: { roles: OfficeRole[]; layout: Layout; width: number; now: number; frame: number }): RenderElement | null {
  const { Box, Text } = kit
  const staff = v.roles.filter(r => r.enabled)
  const off = v.roles.filter(r => !r.enabled)
  if (staff.length === 0 && off.length === 0) return null
  const cardWidth = v.layout === 'wide' ? Math.floor((v.width - 1) / 2) : v.width
  return (
    <Box key="staff" flexDirection="column">
      <Text>
        <Text color={C.accent} bold>{'👤 STAFF ROOMS'}</Text>
        <Text color={C.dim}>{`  roles with memory · ${staff.length} at their head desks`}</Text>
      </Text>
      {staff.length > 0 ? (
        <Box key="staff-desks" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {staff.map(role => drawRoleDesk(kit, $, role, { width: cardWidth, layout: v.layout, now: v.now, frame: v.frame }))}
        </Box>
      ) : (
        <Text color={C.dim}>No role is enabled.</Text>
      )}
      {off.length > 0 ? (
        <Box key="staff-shelf" flexDirection="column" borderStyle="single" borderColor="#30363d" borderDimColor paddingX={1}>
          <Text color={C.dim}>{`○ DISABLED roles (${off.length}) · memory frozen in git`}</Text>
          {off.map(role => (
            <Text color={C.dim} wrap="truncate-end">
              {`  ${role.name} · ${role.disabledReason ?? 'no reason on record'} · ${lastUseText(role)}`}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

function drawForm(kit: Kit, $: $T, v: { form: OfficeStartForm; notice: string | null; width: number; workspace: OfficeWorkspace | null }): RenderElement {
  const { Box, Text, Button, Input, Select } = kit
  const setField = (field: keyof OfficeStartForm, value: string) =>
    void update($, formA, f => ({ ...f, [field]: value }) as OfficeStartForm)
  if (Input === null || Select === null) {
    return (
      <Box key="form" borderStyle="round" borderColor={C.accent} paddingX={1}>
        <Text color={C.dim}>Start a room from a terminal or desktop session (this surface has no fields).</Text>
      </Box>
    )
  }
  return (
    <Box key="form" flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1}>
      <Text color={C.accent} bold>＋ START A ROOM</Text>
      <Select
        key="form-repo"
        label="Repo"
        value={v.form.repo}
        options={startRepos(v.workspace).map(r => ({ value: r, label: r }))}
        onSelect={value => setField('repo', value)}
      />
      <Input
        key="form-slug"
        label="Slug  room-"
        placeholder="orchard-master-sort"
        value={v.form.slug}
        onInput={value => setField('slug', value)}
        onSubmit={value => setField('slug', value)}
      />
      <Select
        key="form-model"
        label="Model"
        value={v.form.model}
        options={[
          { value: 'sonnet', label: 'sonnet (default)' },
          { value: 'opus', label: 'opus' },
        ]}
        onSelect={value => setField('model', value)}
      />
      <Input
        key="form-ref"
        label={trackerCardRegex(v.workspace) !== null ? `Issue # or ${v.workspace?.tracker.name ?? ''} URL` : 'Issue #'}
        placeholder={trackerCardRegex(v.workspace) !== null ? '12  or  a card URL  (empty: new issue)' : '12  (empty: new issue)'}
        value={v.form.ref}
        onInput={value => setField('ref', value)}
        onSubmit={value => setField('ref', value)}
      />
      <Input
        key="form-liaison"
        label="Controller session"
        placeholder="the control room session the room lead reports to"
        value={v.form.liaison}
        onInput={value => setField('liaison', value)}
        onSubmit={value => setField('liaison', value)}
      />
      {v.notice ? <Text color={C.warn}>{v.notice}</Text> : null}
      <Box key="form-btns" flexDirection="row" gap={1}>
        <Button key="form-dry" label="Preview (dry run)" onPress={() => onStart($, true)} />
        <Button key="form-start" label="Start room…" variant="primary" onPress={() => onStart($, false)} />
        <Button key="form-close" label="Close" dimColor onPress={() => void update($, showFormA, () => false)} />
      </Box>
    </Box>
  )
}

function drawOutput(kit: Kit, $: $T, out: OfficeOutput, surface: string): RenderElement {
  const { Box, Text, Button } = kit
  const color = out.status === 'failed' ? C.danger : out.status === 'ok' ? C.ok : C.info
  const lines = out.text.split('\n')
  const shown = lines.slice(-14).join('\n')
  return (
    <Box key="console" flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Text>
        <Text color={color} bold>{out.status === 'running' ? '⟳ ' : out.status === 'ok' ? '✓ ' : '✗ '}</Text>
        <Text bold>{out.title}</Text>
      </Text>
      {out.command ? <Text color={C.dim} wrap="truncate-end">{`$ ${out.command}`}</Text> : null}
      {shown.trim() !== '' ? <Text>{lines.length > 14 ? `…\n${shown}` : shown}</Text> : null}
      <Box key="console-btns" flexDirection="row" gap={1}>
        <Button
          key="console-copy"
          label="Copy"
          dimColor
          onPress={() => void $.ui.copy({ text: out.command ? out.text || out.command : out.text, surface: surface as never })}
        />
        <Button key="console-clear" label="Clear" dimColor onPress={() => void setOutput($, null)} />
      </Box>
    </Box>
  )
}

// The engine's own folder (this plugin's root): the tools (bin/rooms, bin/role) are called from here, whichever workspace is open.
let engineRoot = ''

// $BUSYBODY_WORKSPACE if set, else walk up from cwd (then the folder above the plugin) to the first folder holding office.json.
// Starts the refresh and animation clocks the first time a workspace is found.
let clocksStarted = false
async function locateWorkspace($: $T, cwd: string): Promise<void> {
  engineRoot = $.plugin.root
  let ws: string | null = null
  const fromEnv = (await $.env.get('BUSYBODY_WORKSPACE')) ?? ''
  for (const dir of [...(fromEnv !== '' ? [fromEnv.replace(/\/+$/, '')] : []), ...workspaceCandidates(cwd, $.plugin.root)]) {
    try {
      const st = await $.fs.stat(`${dir}/office.json`)
      if (st.kind === 'file') {
        ws = dir
        break
      }
    } catch {
      // not here
    }
  }
  await update($, workspaceA, () => ws)
  if (ws !== null && !clocksStarted) {
    clocksStarted = true
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    $.clock.every(FRAME_MS, () => void tick($))
  }
}

export const register: Register = on => {
  // ---- events ---------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the office: control room, staff rooms, project rooms and controls' })
    const out = await next(e)
    await locateWorkspace($, e.cwd)
    const liaison = (await $.env.get('BUSYBODY_CONTROLLER')) || (await $.env.get('SCH_LIAISON_SESSION')) // the old name is an alias
    if (liaison) await update($, formA, f => (f.liaison === '' ? { ...f, liaison } : f))
    return out
  })

  on('command.run', { command: 'office' }, async $ => {
    // The mod can load after session.start (enabled or hot-reloaded mid-session), so the
    // workspace may never have been looked for. Look again from the mod's own folder.
    if ((await read($, workspaceA)) === null) await locateWorkspace($, '')
    const opened = await $.ui.open({ id: PANE, title: '🏢 Office', focus: true })
    isPaneOpen = opened.isPlaced
    void refresh($)
    const ws = await read($, workspaceA)
    if (ws === null) return { text: 'Office opened, but no workspace with office.json was found above this session.' }
    return { text: 'Office opened.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isPaneOpen = false
    drawn = []
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---- the band above the prompt -------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const doc = await read($, docA)
    const line = bandText(doc)
    if (line === null || doc === null) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const alerts = bandAlerts(doc)
    return (
      <Box key="office-band" flexDirection="row" gap={1}>
        <Text key="office-band-text" color={doc.decisions.length > 0 || doc.totals.memoryReviews > 0 ? C.warn : C.wall} wrap="truncate-end">
          {line}
          {alerts.length > 0 ? <Text color={C.danger}>{` · ${alerts.join(' · ')}`}</Text> : ''}
        </Text>
        <Button
          key="office-band-open"
          label="open"
          plain
          dimColor
          onPress={() => {
            void $.ui.open({ id: PANE, title: '🏢 Office', focus: true }).then(r => {
              isPaneOpen = r.isPlaced
            })
          }}
        />
      </Box>
    )
  })

  // ---- the pane ------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isPaneOpen = true
    const t = $.ui.resolve(e) as unknown as Record<string, unknown>
    const kit: Kit = {
      Box: t.Box as Kit['Box'],
      Text: t.Text as Kit['Text'],
      Button: t.Button as Kit['Button'],
      Link: t.Link as Kit['Link'],
      Input: e.surface === 'mobile' ? null : (t.Input as Kit['Input']),
      Select: e.surface === 'mobile' ? null : (t.Select as Kit['Select']),
      Raster: e.surface === 'terminal' ? (t.Raster as Kit['Raster']) : null,
    }
    const { Box, Text } = kit
    const [doc, refreshState, ws, drafts, sends, confirm, output, showForm, form, graphicsPref, prs, notices, roleBatches, roleItems, roleRatings, roleRuns] =
      await Promise.all([
        read($, docA),
        read($, refreshA),
        read($, workspaceA),
        read($, draftsA),
        read($, sendsA),
        read($, confirmA),
        read($, outputA),
        read($, showFormA),
        read($, formA),
        read($, graphicsA),
        read($, prsA),
        read($, noticesA),
        read($, roleBatchesA),
        read($, roleItemsA),
        read($, roleRatingsA),
        read($, roleRunsA),
      ])
    const now = await $.clock.now()
    graphicsMode = pickGraphics(graphicsPref, e.surface, await terminalEnv($))
    if (kit.Raster === null) graphicsMode = 'text'
    const width = Math.max(30, e.props.bodyColumns)
    const rooms = doc?.rooms ?? []
    const layout = chooseLayout(width, rooms.filter(r => roomDisplay(r).isActive).length)
    drawn = []

    const header = drawHeader(kit, $, { doc, refreshState, now, width, graphicsPref, graphicsMode, ws })
    const confirmBox = confirm ? drawConfirm(kit, $, confirm) : null
    const inbox = drawInbox(kit, $, { doc, drafts, sends, width, now, ws, roleBatches, roleItems, roleRatings, roleRuns })
    const staff = drawStaff(kit, $, { roles: doc?.roles ?? [], layout, width, now, frame })
    const roomsView = drawRooms(kit, $, { rooms, layout, width, prs, notices, frame })
    const form$ = showForm ? drawForm(kit, $, { form, notice: notices.start ?? null, width, workspace: doc?.workspace ?? null }) : null
    const console$ = output ? drawOutput(kit, $, output, e.surface) : null

    return (
      <Box key="office" flexDirection="column" width={width}>
        {header}
        {confirmBox}
        {inbox}
        {staff}
        {roomsView}
        {form$}
        {console$}
        {doc === null && refreshState === null && ws !== null ? <Text color={C.dim}>Walking the floor… (bin/rooms --json)</Text> : null}
        {ws === null ? (
          <Text color={C.warn}>No workspace found: no office.json above this session's directory or the engine's.</Text>
        ) : null}
      </Box>
    )
  })

}
