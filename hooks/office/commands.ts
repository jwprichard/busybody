// Pure: what each button runs. Every mutating plan carries a confirm text;
// the pane asks first and only a "yes" press runs the stored argv.

import type { OfficePrLookup, OfficeRoom, OfficeStartForm, OfficeWorkspace } from '../../types'

export type RoomAction = 'stop' | 'resume' | 'attach' | 'issue' | 'pr'

export type Plan =
  /** Run `argv`; when `confirm` is set, only after the person says yes. */
  | { kind: 'run'; argv: string[]; cwd: string | null; confirm: string | null; title: string }
  /** Nothing runs: show this text (and offer to copy it). */
  | { kind: 'show'; text: string; title: string }
  /** Run this read-only lookup first, then plan again with what it found. */
  | { kind: 'lookup'; argv: string[]; title: string }
  /** The button does nothing now, for this reason. */
  | { kind: 'disabled'; reason: string }

export type PlanContext = {
  /** The lead's session id, if known (from `claude agents --json [--all]`). */
  sessionId?: string | null
  /** The PR lookup for this room's branch, if one has been made. */
  pr?: OfficePrLookup | undefined
  /** office.json as the engine printed it: the minutes repo and each repo's GitHub slug. */
  workspace?: OfficeWorkspace | null | undefined
}

/** owner/name of a configured repo (office.json `repos.<name>.github`), or null when the config does not list it. */
export function githubRepo(repo: string, workspace: OfficeWorkspace | null | undefined): string | null {
  if (repo.includes('/')) return repo
  return workspace?.repos.find(r => r.name === repo)?.github ?? null
}

/** The read-only lookup Resume makes when the session id is not known. */
export const AGENTS_ALL_ARGV: readonly string[] = ['claude', 'agents', '--json', '--all']

/** Finds a session id by room name in `claude agents --json --all` output. */
export function findSessionId(agentsJson: string, name: string): string | null {
  try {
    const list: unknown = JSON.parse(agentsJson)
    if (!Array.isArray(list)) return null
    for (const a of list) {
      if (a && typeof a === 'object' && (a as Record<string, unknown>).name === name) {
        const id = (a as Record<string, unknown>).sessionId
        if (typeof id === 'string' && id !== '') return id
      }
    }
  } catch {
    // fall through
  }
  return null
}

/** Maps a room button to what it runs. */
export function planRoomAction(action: RoomAction, room: OfficeRoom, ctx: PlanContext = {}): Plan {
  switch (action) {
    case 'stop': {
      if (room.lead.status === 'missing') return { kind: 'disabled', reason: `${room.name} has no running lead to stop.` }
      // `claude stop <id>` takes the session's id (the short id `claude agents`
      // lists, or the full session id), never the room name.
      const id = room.lead.agentId ?? room.lead.sessionId
      if (!id) return { kind: 'disabled', reason: `${room.name}'s session id is unknown (claude agents --json), so it can't be stopped from here.` }
      return {
        kind: 'run',
        argv: ['claude', 'stop', id],
        cwd: null,
        confirm: `Stop ${room.name} (session ${id})? Its conversation is kept; Resume brings it back.`,
        title: `Stop ${room.name}`,
      }
    }
    case 'resume': {
      if (room.capped) {
        return {
          kind: 'disabled',
          reason: `${room.name} is capped. It resumes only on an owner turn that sets a new cap (busybody:workstream-lead §5).`,
        }
      }
      if (room.lead.status !== 'missing') return { kind: 'disabled', reason: `${room.name} is already running.` }
      const sid = ctx.sessionId ?? room.lead.sessionId
      if (!sid) return { kind: 'lookup', argv: [...AGENTS_ALL_ARGV], title: `Find ${room.name}'s session` }
      return {
        kind: 'run',
        argv: ['claude', '--bg', '--resume', sid, '-n', room.name],
        cwd: room.worktree || null,
        confirm: `Resume ${room.name} in the background (session ${sid.slice(0, 8)})?`,
        title: `Resume ${room.name}`,
      }
    }
    case 'attach':
      return {
        kind: 'show',
        title: `Attach to ${room.name}`,
        text: `claude attach ${room.name}`,
      }
    case 'issue':
      if (!room.issue) return { kind: 'disabled', reason: `${room.name} has no issue number.` }
      if (!ctx.workspace) return { kind: 'disabled', reason: 'No minutesRepo from office.json yet: run `busybody init`, then refresh.' }
      return {
        kind: 'run',
        argv: ['gh', 'issue', 'view', String(room.issue), '-R', ctx.workspace.minutesRepo, '--web'],
        cwd: null,
        confirm: null,
        title: `Open issue #${room.issue}`,
      }
    case 'pr': {
      const lookup = ctx.pr
      if (lookup === undefined) {
        return {
          kind: 'disabled',
          reason: room.branch === '' || room.repo === ''
            ? `${room.name} has no branch on record, so its PR is unknown.`
            : `${room.name}'s PR is not known yet: the engine looks it up every ten minutes.`,
        }
      }
      const github = githubRepo(room.repo, ctx.workspace)
      if (github === null) return { kind: 'disabled', reason: `${room.repo} is not in office.json repos.` }
      if (lookup.pr === null) {
        return { kind: 'disabled', reason: `No PR yet for ${room.branch || 'this branch'} in ${github}.` }
      }
      return {
        kind: 'run',
        argv: ['gh', 'pr', 'view', String(lookup.pr.number), '-R', github, '--web'],
        cwd: null,
        confirm: null,
        title: `Open PR #${lookup.pr.number}`,
      }
    }
  }
}

/** The repos the Start room form offers: every repo in office.json, in its order (the first is the default). */
export function startRepos(workspace: OfficeWorkspace | null | undefined): string[] {
  return workspace?.repos.map(r => r.name) ?? []
}

export type StartPlan = {
  argv: string[] | null
  errors: string[]
  notes: string[]
  issue: number | null
  /** A card URL the tracker recognised (the launcher has no card flag, so it is only noted), else null. */
  cardUrl: string | null
}

/** What the Start room card field accepts: an issue number, plus a card URL only when a tracker is configured. Null when it takes issues only. */
export function trackerCardRegex(workspace: OfficeWorkspace | null | undefined): RegExp | null {
  const rx = workspace?.tracker.cardUrlRegex
  if (!rx || workspace?.tracker.type === 'none') return null
  try {
    return new RegExp(rx)
  } catch {
    return null
  }
}

/** Builds the room launcher's argv from the Start room form. `workspace` is the folder; `engineRoot` is the engine's own folder (the launcher lives in its bin/); `config` is office.json as the engine printed it. */
export function planStart(workspace: string, form: OfficeStartForm, isDryRun: boolean, config: OfficeWorkspace | null | undefined = null, engineRoot: string = `${workspace}/busybody`): StartPlan {
  const errors: string[] = []
  const notes: string[] = []
  const repo = form.repo.trim()
  const slug = form.slug.trim()
  const ref = form.ref.trim()
  const liaison = form.liaison.trim()
  const repos = startRepos(config)
  if (repos.length === 0) errors.push('No repos from office.json yet: run `busybody init`, then refresh.')
  else if (!repos.includes(repo)) errors.push(`Repo must be one of ${repos.join(', ')}.`)
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) errors.push('Slug: lowercase letters, digits and dashes, 41 at most.')
  if (form.model !== 'sonnet' && form.model !== 'opus') errors.push('Model must be sonnet or opus.')
  if (liaison === '') errors.push('Liaison: the session name the lead reports to (or set BUSYBODY_CONTROLLER).')
  let issue: number | null = null
  let cardUrl: string | null = null
  const cardRx = trackerCardRegex(config)
  const trackerName = config?.tracker.name ?? ''
  if (ref !== '') {
    const n = /^#?(\d+)$/.exec(ref)
    if (n) issue = Number(n[1])
    else if (cardRx !== null && cardRx.test(ref)) {
      cardUrl = ref
      notes.push(
        `The room launcher has no card flag: it opens a new initiative issue ("${trackerName}: none yet"). Add ${ref} to that issue yourself.`,
      )
    } else errors.push(cardRx !== null ? `Issue: a number like 12, or a ${trackerName} card URL.` : 'Issue: a number like 12.')
  } else {
    notes.push('No issue given: the room launcher opens a new initiative issue.')
  }
  if (errors.length > 0 || workspace === '') {
    if (workspace === '') errors.push('Workspace not found (no office.json above this session).')
    return { argv: null, errors, notes, issue, cardUrl }
  }
  const argv = [`${engineRoot}/bin/lead-start`, repo, slug, '--liaison', liaison, '--model', form.model]
  if (issue !== null) argv.push('--issue', String(issue))
  if (isDryRun) argv.push('--dry-run')
  return { argv, errors, notes, issue, cardUrl }
}

/** A shell-ish rendering of argv, for display only (never executed). */
export function displayCommand(argv: readonly string[]): string {
  return argv
    .map(a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ')
}
