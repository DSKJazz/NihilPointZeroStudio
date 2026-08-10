/**
 * YouTube chapter markers — the timestamp list that goes in a video's description.
 *
 * Timings are estimated by splitting the total video duration in proportion to each
 * section's word count. That is an approximation, not a transcript-accurate one: a
 * section with long words or numbers takes slightly longer to read than its share.
 * It is close enough to be useful and costs nothing, whereas transcribing the whole
 * video would take minutes. Captions (which DO transcribe) remain the accurate route.
 */

export interface Chapter {
  startSec: number
  title: string
}

/** YouTube requires the first chapter to be exactly 00:00 or it ignores the whole list. */
const FIRST_LABEL = '0:00'

function stamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

/**
 * Splits a script into titled sections. Recognises the [bracketed] scene directions the
 * rest of the app already uses, and falls back to blank-line-separated paragraphs.
 */
export function splitSections(body: string): { title: string; words: number }[] {
  const text = (body || '').trim()
  if (!text) return []

  const bracketed = [...text.matchAll(/\[([^\]]{2,60})\]/g)]
  if (bracketed.length >= 2) {
    const out: { title: string; words: number }[] = []
    // Text BEFORE the first marker is still narrated, so it must count. Skipping it left
    // it out of the word total while the video's measured duration still included it,
    // which shifted every single timestamp earlier.
    const intro = countWords(text.slice(0, bracketed[0].index ?? 0))
    if (intro > 0) out.push({ title: 'Intro', words: intro })
    for (let i = 0; i < bracketed.length; i++) {
      const start = (bracketed[i].index ?? 0) + bracketed[i][0].length
      const end = i + 1 < bracketed.length ? bracketed[i + 1].index ?? text.length : text.length
      out.push({
        title: titleCase(bracketed[i][1]),
        words: countWords(text.slice(start, end))
      })
    }
    return out.filter((s) => s.words > 0)
  }

  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (paras.length < 2) return []
  return paras.map((p) => ({ title: firstWords(p), words: countWords(p) })).filter((s) => s.words > 0)
}

function countWords(s: string): number {
  return s.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).length
}

function titleCase(s: string): string {
  const clean = s.trim().replace(/\s+/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/** A short label from a paragraph's opening words, for scripts with no scene markers. */
function firstWords(p: string): string {
  const words = p.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6)
  const joined = words.join(' ').replace(/[.,;:!?]+$/, '')
  return titleCase(joined || 'Section')
}

/**
 * Builds chapters for a script of known total duration. Returns [] when the script has
 * too few sections to be worth chaptering — YouTube needs at least three, and a bogus
 * two-entry list is worse than none.
 */
export function buildChapters(body: string, durationSec: number): Chapter[] {
  const sections = splitSections(body)
  if (sections.length < 3 || durationSec <= 0) return []
  const totalWords = sections.reduce((n, s) => n + s.words, 0)
  if (!totalWords) return []

  const chapters: Chapter[] = []
  let elapsed = 0
  for (const s of sections) {
    chapters.push({ startSec: elapsed, title: s.title })
    elapsed += (s.words / totalWords) * durationSec
  }
  chapters[0].startSec = 0

  // YouTube also demands EVERY chapter be at least 10 seconds long — including the last
  // one, whose length is measured against the end of the video, not against a following
  // chapter. Miss that and YouTube silently discards the whole list.
  const kept: Chapter[] = []
  for (const c of chapters) {
    if (!kept.length || c.startSec - kept[kept.length - 1].startSec >= 10) kept.push(c)
  }
  while (kept.length && durationSec - kept[kept.length - 1].startSec < 10) kept.pop()
  return kept.length >= 3 ? kept : []
}

/** Renders chapters as the timestamp block that goes in a YouTube description. */
export function formatChapters(chapters: Chapter[]): string {
  if (!chapters.length) return ''
  return chapters
    .map((c, i) => `${i === 0 ? FIRST_LABEL : stamp(c.startSec)} ${c.title}`)
    .join('\n')
}
