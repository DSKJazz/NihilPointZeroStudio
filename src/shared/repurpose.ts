/**
 * One script → everywhere it needs to go.
 *
 * WHY THIS IS WORTH HAVING
 * The script is already written. The description, the community post, the thread and
 * the WhatsApp message are all the SAME material rearranged — and doing that by hand,
 * five times, for every video, is the kind of chore that quietly doesn't get done. The
 * posts that never get written are the reach that never happens.
 *
 * WHY IT NEEDS NO AI
 * Everything here is rearrangement, not invention: the chapters come from the script's
 * own section headings, the timestamps from the narration's word count, the thread from
 * the sentences that already carry the argument. So it works with the internet off and
 * the free service down — which is when the user actually needs it. An AI polish pass
 * can sit on top later; it must never be required for this to produce something usable.
 *
 * NOTHING HERE INVENTS A FACT. Every line out is a line the user wrote, trimmed or
 * reordered. For a finance channel that is not a nicety — a repurposing tool that
 * paraphrased a number would be a liability.
 */
import { DEFAULT_WPM, countSpokenWords, formatClock } from './teleprompter'

export interface Chapter {
  /** Seconds from the start of the video. */
  at: number
  title: string
}

export interface RepurposePack {
  chapters: Chapter[]
  youtubeDescription: string
  communityPost: string
  thread: string[]
  linkedIn: string
  whatsapp: string
}

export interface RepurposeInput {
  title: string
  /** The narration script, exactly as written. */
  body: string
  /** Speaking pace, so the timestamps match the finished video. */
  wpm?: number
  /** Optional link to put in the posts. Left out entirely when absent. */
  url?: string
  /** Optional hashtags, without the '#'. */
  tags?: string[]
}

/** Lines that look like a section heading rather than narration. */
const HEADING = /^(?:#{1,6}\s+|\[[^\]]+\]\s*$|\*\*[^*]+\*\*\s*$|[A-Z][A-Z0-9 ,'&/-]{3,60}:?\s*$)/

function isHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 80) return false
  return HEADING.test(t)
}

function cleanHeading(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/:$/, '')
    .trim()
}

/**
 * Splits the script into titled sections. A script with no headings is one section —
 * still useful, and far better than refusing to run.
 */
export function sections(body: string): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = []
  let current: { title: string; text: string } | null = null
  for (const line of (body ?? '').split(/\r?\n/)) {
    if (isHeading(line)) {
      if (current) out.push(current)
      current = { title: cleanHeading(line), text: '' }
    } else {
      if (!current) current = { title: '', text: '' }
      current.text += (current.text ? '\n' : '') + line
    }
  }
  if (current) out.push(current)
  return out.filter((s) => s.title || s.text.trim())
}

/**
 * Chapter marks, timed from the narration's own word count at the speaking pace.
 *
 * YouTube's rules, which are strict and silently break the whole feature if missed:
 * the first chapter MUST be at 00:00, there must be at least three, and each must run
 * at least ten seconds. Rather than emit a broken list, fewer than three chapters
 * returns none at all — no chapters is tidy; three that YouTube rejects looks broken.
 */
export function chapters(body: string, wpm = DEFAULT_WPM): Chapter[] {
  const parts = sections(body)
  const rate = Math.max(60, wpm) / 60
  let at = 0
  const raw: Chapter[] = []
  for (const part of parts) {
    if (part.title) raw.push({ at: Math.round(at), title: part.title })
    at += countSpokenWords(part.text) / rate
  }
  if (raw.length < 3) return []
  // First must be 00:00 — YouTube ignores the entire list otherwise.
  raw[0] = { ...raw[0], at: 0 }
  // Drop any that would land under ten seconds after the one before it.
  const spaced: Chapter[] = [raw[0]]
  for (const c of raw.slice(1)) {
    if (c.at - spaced[spaced.length - 1].at >= 10) spaced.push(c)
  }
  return spaced.length >= 3 ? spaced : []
}

/** First sentence that actually says something, for use as a hook. */
function firstSentence(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(flat)
  const s = (m ? m[1] : flat).trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** Sentences long enough to stand alone, in order. */
export function keySentences(body: string, limit: number): string[] {
  const out: string[] = []
  for (const part of sections(body)) {
    for (const raw of part.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
      const s = raw.trim()
      // Short fragments ("Right.", "So.") carry nothing on their own.
      if (s.length >= 40 && s.length <= 280) out.push(s)
      if (out.length >= limit) return out
    }
  }
  return out
}

function hashtags(tags: string[] | undefined): string {
  const clean = (tags ?? [])
    .map((t) => t.replace(/[^A-Za-z0-9_]/g, ''))
    .filter(Boolean)
    .slice(0, 8)
  return clean.length ? clean.map((t) => `#${t}`).join(' ') : ''
}

function withUrl(text: string, url?: string): string {
  return url ? `${text}\n\n${url}` : text
}

export function youtubeDescription(input: RepurposeInput): string {
  const chaps = chapters(input.body, input.wpm)
  const parts: string[] = [firstSentence(sections(input.body)[0]?.text ?? input.body)]
  if (chaps.length) {
    parts.push(['Chapters:', ...chaps.map((c) => `${formatClock(c.at)} ${c.title}`)].join('\n'))
  }
  if (input.url) parts.push(input.url)
  const tags = hashtags(input.tags)
  if (tags) parts.push(tags)
  return parts.filter(Boolean).join('\n\n')
}

/** Short, one question at the end — a community post that asks nothing gets no replies. */
export function communityPost(input: RepurposeInput): string {
  const hook = firstSentence(sections(input.body)[0]?.text ?? input.body, 180)
  return withUrl(`${input.title}\n\n${hook}\n\nWhat do you think — worth a deeper look?`, input.url)
}

/**
 * A thread. Numbered, because an unnumbered thread reads as disconnected posts, and
 * capped at 280 characters per post so nothing is silently truncated by the platform.
 */
export function thread(input: RepurposeInput, max = 8): string[] {
  const points = keySentences(input.body, max - 1)
  if (!points.length) return [input.title.slice(0, 280)]
  const total = points.length + 1
  const posts = [`${input.title}\n\nA thread 🧵 (1/${total})`]
  points.forEach((p, i) => {
    const numbered = `${p}\n\n(${i + 2}/${total})`
    posts.push(numbered.length <= 280 ? numbered : `${p.slice(0, 274 - String(total).length * 2)}…\n\n(${i + 2}/${total})`)
  })
  if (input.url) posts[posts.length - 1] += `\n\n${input.url}`
  return posts
}

export function linkedInPost(input: RepurposeInput): string {
  const points = keySentences(input.body, 3)
  const body = points.length ? points.map((p) => `• ${p}`).join('\n\n') : firstSentence(input.body)
  const tags = hashtags(input.tags)
  return withUrl(`${input.title}\n\n${body}${tags ? `\n\n${tags}` : ''}`, input.url)
}

/**
 * WhatsApp. Deliberately the shortest of the lot: it is read on a lock screen, and
 * a long forward gets ignored. *Bold* is WhatsApp's own markup, not markdown.
 */
export function whatsappBroadcast(input: RepurposeInput): string {
  return withUrl(`*${input.title}*\n\n${firstSentence(input.body, 160)}`, input.url)
}

export function repurpose(input: RepurposeInput): RepurposePack {
  return {
    chapters: chapters(input.body, input.wpm),
    youtubeDescription: youtubeDescription(input),
    communityPost: communityPost(input),
    thread: thread(input),
    linkedIn: linkedInPost(input),
    whatsapp: whatsappBroadcast(input)
  }
}
