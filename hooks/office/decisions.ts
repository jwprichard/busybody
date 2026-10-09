// Pure: reading a DECISION comment, and building the ANSWER the person sends.
// The mod never generates or edits answer text: buildAnswer wraps exactly
// what was typed, byte for byte, and nothing else touches it.


export type ParsedDecision = {
  question: string
  options: string[]
  recommendation: string | null
  /** True when the comment says it blocks the work, false when it says it doesn't. */
  blocks: boolean | null
  /** False when nothing structured was found: show `body` as written. */
  isStructured: boolean
  body: string
}

const OPTION_ITEM = /^\s*(?:\d+[.)]|[-*•]|\(?[A-Za-z]\)|[A-Z][.:])\s+(.+)$/
const OPTIONS_HEADER = /^\s*\**options?\**\s*:?\s*\**\s*(.*)$/i
const RECOMMEND_HEADER = /^\s*\**(?:my\s+)?recommend(?:ation|ed|s)?\**\s*:?\s*\**\s*(.*)$/i
const ANY_HEADER = /^\s*\**[A-Z][A-Za-z ]{1,24}\**\s*:/

/** Splits a DECISION comment into question, options and recommendation. */
export function parseDecision(body: string): ParsedDecision {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  // New header `**DECISION** · who · where`: the question is the next non-empty line.
  const newHeader = /^\s*\*\*DECISION\*\*\s*·/i.test(lines[0] ?? '')
  let start = 1
  let first = (lines[0] ?? '').replace(/^\s*\**DECISION\**\s*:?\s*/i, '').trim()
  if (newHeader) {
    while (start < lines.length && (lines[start] ?? '').trim() === '') start++
    first = (lines[start] ?? '').trim()
    start++
  }
  let question = first
  let blocks: boolean | null = null
  const blockMatch = /\(\s*(does not block|doesn't block|non-blocking|blocks?)[^)]*\)\s*$/i.exec(question)
  if (blockMatch) {
    const word = (blockMatch[1] ?? '').toLowerCase()
    blocks = word.startsWith('block')
    question = question.slice(0, blockMatch.index).trim()
  } else if (/\bblocks the (work|build)\b/i.test(body)) {
    blocks = true
  } else if (/\b(does not|doesn't) block\b/i.test(body)) {
    blocks = false
  }

  const options: string[] = []
  let recommendation: string | null = null
  let mode: 'none' | 'options' | 'recommend' = 'none'
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const opt = OPTIONS_HEADER.exec(line)
    const rec = RECOMMEND_HEADER.exec(line)
    if (rec) {
      mode = 'recommend'
      recommendation = (rec[1] ?? '').trim()
      continue
    }
    if (opt && /^\s*\**options?/i.test(line)) {
      mode = 'options'
      const inline = (opt[1] ?? '').trim()
      if (inline !== '') {
        for (const part of inline.split(/\s*(?:,|;|\bor\b|\|)\s*/)) {
          if (part.trim() !== '') options.push(part.trim())
        }
      }
      continue
    }
    if (mode === 'options') {
      const item = OPTION_ITEM.exec(line)
      if (item) options.push((item[1] ?? '').trim())
      else if (line.trim() !== '' && options.length > 0 && /^\s{2,}/.test(line)) {
        options[options.length - 1] += ` ${line.trim()}`
      } else if (line.trim() !== '' && ANY_HEADER.test(line)) mode = 'none'
      continue
    }
    if (mode === 'recommend') {
      if (line.trim() === '') {
        if (recommendation !== null && recommendation !== '') mode = 'none'
        continue
      }
      if (ANY_HEADER.test(line) && !OPTION_ITEM.test(line)) {
        mode = 'none'
        continue
      }
      recommendation = recommendation ? `${recommendation} ${line.trim()}` : line.trim()
      continue
    }
    // Numbered items with no "Options:" header still read as options.
    const item = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (item && recommendation === null) options.push((item[1] ?? '').trim())
  }
  if (recommendation === '') recommendation = null
  return {
    question: question === '' ? body.trim().split('\n')[0] ?? '' : question,
    options,
    recommendation,
    blocks,
    isStructured: options.length > 0 || recommendation !== null,
    body,
  }
}

/**
 * The ANSWER comment's body: the protocol's prefix and the person's exact
 * text in quotes. The text is not trimmed, escaped or rewritten. Null when
 * nothing (or only whitespace) was typed, so nothing is sent.
 */
export function buildAnswer(typed: string): string | null {
  if (typed.trim() === '') return null
  return `ANSWER (from the user): "${typed}"`
}

/** The argv that posts the answer to the minutes repo (office.json `minutesRepo`): `gh issue comment`, no shell. */
export function answerArgv(issue: number, typed: string, minutesRepo: string): string[] | null {
  const body = buildAnswer(typed)
  if (body === null || minutesRepo === '' || !Number.isInteger(issue) || issue <= 0) return null
  return ['gh', 'issue', 'comment', String(issue), '-R', minutesRepo, '--body', body]
}

/** The comment URL `gh issue comment` prints, or null. */
export function commentUrlFrom(stdout: string): string | null {
  const m = /https:\/\/github\.com\/\S+#issuecomment-\d+/.exec(stdout)
  return m ? m[0] : null
}

/** The link-only nudge to the room's head desk: never the answer itself. */
export function nudgeText(room: string, commentUrl: string): string {
  return `ANSWER ${room}: ${commentUrl}`
}

/**
 * Whom the nudge goes to, as `$.session.send` takes it: the head desk's session
 * id, else its room name (the `-n` name SendMessage also accepts). Null when
 * that would be this session itself, so a nudge never lands on the sender.
 */
export function nudgeTarget(
  room: { name: string; lead: { sessionId: string | null } },
  ownSessionId: string | null,
): { sessionId: string } | string | null {
  const sid = room.lead.sessionId
  if (sid !== null && sid !== '') return sid === ownSessionId ? null : { sessionId: sid }
  return room.name === '' ? null : room.name
}
