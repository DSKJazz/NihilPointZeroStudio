/**
 * Learns from YOUR channel instead of from general advice.
 *
 * WHY GENERAL ADVICE IS THE WRONG INPUT
 * "Use numbers in titles." "Post at 6pm." "Keep it under 60 characters." All of that is
 * an average across millions of channels that are not yours, aimed at an audience that
 * is not yours. A Pakistani finance channel in Roman Urdu has an audience with its own
 * habits, and the only data that describes them is already sitting in your own history.
 *
 * So this reads your own videos and answers two questions:
 *   - which title SHAPES have actually worked for you
 *   - when do your videos actually get watched
 *
 * WHY NO AI, AGAIN
 * These are arithmetic questions about a table of numbers. A model would give a fluent
 * answer that cannot be checked against the table. Every figure here is computed, and
 * the sample size is always reported alongside it — because "titles with numbers do 40%
 * better" means nothing if it is based on two videos.
 *
 * THE THING THIS MODULE IS MOST CAREFUL ABOUT
 * Not lying with small samples. A channel with nine videos cannot support a confident
 * claim about anything, and a tool that makes one anyway is worse than a tool that says
 * "not enough data yet" — because the user will act on it.
 */

export interface PastVideo {
  title: string
  /** ISO timestamp of publication. */
  publishedAt: string
  views: number
  /** Optional; used only when present. */
  likes?: number
  comments?: number
  /** Length in seconds, if known. */
  durationSec?: number
}

/** Below this, no claim is made about anything. */
export const MIN_SAMPLE = 8

/** Minimum videos in EACH group before two groups are compared. */
export const MIN_PER_GROUP = 3

export interface Finding {
  /** What was tested, in plain English. */
  pattern: string
  /** Median views for videos that have it. */
  withMedian: number
  /** Median views for videos that do not. */
  withoutMedian: number
  /** How many videos in each group — the honesty of the whole thing. */
  withCount: number
  withoutCount: number
  /** Percentage difference, positive meaning "having it did better". */
  liftPercent: number
  /** True only when both groups are big enough to mean anything. */
  trustworthy: boolean
  headline: string
}

/**
 * Median, not mean.
 *
 * One video that went viral drags a mean so far that every conclusion becomes "do what
 * that video did", which is usually unrepeatable luck. The median describes the typical
 * video, which is the one being planned.
 */
export function median(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!clean.length) return 0
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2
}

/** The title shapes worth testing on a finance channel. */
export const TITLE_PATTERNS: { name: string; test: (title: string) => boolean }[] = [
  { name: 'Has a number', test: (t) => /\d/.test(t) },
  { name: 'Is a question', test: (t) => t.includes('?') },
  { name: 'Names an institution (SBP, PSX, IMF…)', test: (t) => /\b(?:SBP|State Bank|PSX|KSE|NCCPL|IMF|FBR|SECP)\b/i.test(t) },
  { name: 'Mentions the rupee or the dollar', test: (t) => /\b(?:rupee|rupya|pkr|dollar|usd)\b/i.test(t) },
  { name: 'Written in Roman Urdu', test: (t) => /\b(?:kya|kyun|kaise|mehngai|sona|qarz|hai|nahi|aur|ka|ki)\b/i.test(t) },
  { name: 'Short (under 50 characters)', test: (t) => t.trim().length < 50 },
  { name: 'Uses ALL CAPS somewhere', test: (t) => /\b[A-Z]{4,}\b/.test(t) },
  { name: 'Promises an explanation', test: (t) => /\b(?:explained|explain|why|reason|samjhaye|matlab)\b/i.test(t) }
]

/**
 * Tests one pattern against the channel's history.
 *
 * Returns a finding even when it is not trustworthy, with `trustworthy: false` and a
 * headline that says so — so the UI can show what was tested and why no conclusion was
 * drawn, rather than silently hiding it and looking like it did nothing.
 */
export function testPattern(videos: PastVideo[], pattern: { name: string; test: (t: string) => boolean }): Finding {
  const usable = (videos ?? []).filter((v) => v && typeof v.title === 'string' && Number.isFinite(v.views))
  const withIt = usable.filter((v) => pattern.test(v.title))
  const withoutIt = usable.filter((v) => !pattern.test(v.title))
  const withMedian = median(withIt.map((v) => v.views))
  const withoutMedian = median(withoutIt.map((v) => v.views))
  const trustworthy =
    usable.length >= MIN_SAMPLE && withIt.length >= MIN_PER_GROUP && withoutIt.length >= MIN_PER_GROUP
  const liftPercent = withoutMedian > 0 ? Math.round(((withMedian - withoutMedian) / withoutMedian) * 100) : 0

  let headline: string
  if (!trustworthy) {
    headline = `"${pattern.name}" — not enough videos to tell yet (${withIt.length} with, ${withoutIt.length} without).`
  } else if (Math.abs(liftPercent) < 10) {
    headline = `"${pattern.name}" makes no real difference on your channel.`
  } else if (liftPercent > 0) {
    headline = `"${pattern.name}" does ${liftPercent}% better on your channel (${withIt.length} vs ${withoutIt.length} videos).`
  } else {
    headline = `"${pattern.name}" does ${Math.abs(liftPercent)}% WORSE on your channel (${withIt.length} vs ${withoutIt.length} videos).`
  }

  return { pattern: pattern.name, withMedian, withoutMedian, withCount: withIt.length, withoutCount: withoutIt.length, liftPercent, trustworthy, headline }
}

/** Every pattern, strongest real effect first, untrustworthy ones last. */
export function learnTitlePatterns(videos: PastVideo[]): Finding[] {
  return TITLE_PATTERNS.map((p) => testPattern(videos, p)).sort((a, b) => {
    if (a.trustworthy !== b.trustworthy) return a.trustworthy ? -1 : 1
    return Math.abs(b.liftPercent) - Math.abs(a.liftPercent)
  })
}

/**
 * Scores a proposed title using only what this channel's own history supports.
 *
 * Deliberately returns the REASONS rather than just a number. A score of 73 tells the
 * user nothing they can act on; "your last 12 videos with a number in the title did 34%
 * better" tells them what to change.
 */
export interface TitleScore {
  score: number
  reasons: string[]
  /** True when there is enough history for the score to mean anything. */
  grounded: boolean
}

export function scoreTitle(title: string, videos: PastVideo[]): TitleScore {
  const findings = learnTitlePatterns(videos).filter((f) => f.trustworthy && Math.abs(f.liftPercent) >= 10)
  if (!findings.length) {
    return {
      score: 0,
      reasons: [
        `Not enough history yet to score titles against your own channel — ${(videos ?? []).length} videos, and ${MIN_SAMPLE} is the minimum. General advice is all anyone could give you here, and it is worth less than your own data will be.`
      ],
      grounded: false
    }
  }
  let score = 0
  const reasons: string[] = []
  for (const f of findings) {
    const p = TITLE_PATTERNS.find((x) => x.name === f.pattern)
    if (!p) continue
    const has = p.test(title)
    if (has && f.liftPercent > 0) {
      score += f.liftPercent
      reasons.push(`✓ ${f.pattern} — worth about +${f.liftPercent}% on your channel`)
    } else if (has && f.liftPercent < 0) {
      score += f.liftPercent
      reasons.push(`✗ ${f.pattern} — costs you about ${f.liftPercent}% historically`)
    } else if (!has && f.liftPercent > 0) {
      reasons.push(`· Missing "${f.pattern}", which is worth about +${f.liftPercent}% for you`)
    }
  }
  return { score, reasons, grounded: true }
}

// ───────────────────────────── when to publish ─────────────────────────────

export interface SlotPerformance {
  /** 0 = Sunday, matching Date.getDay(). */
  dayOfWeek: number
  /** Local hour, 0-23. */
  hour: number
  videos: number
  medianViews: number
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Groups the history by day and hour.
 *
 * Grouped by DAY and HOUR separately rather than by the 168 day-hour combinations: a
 * channel would need thousands of videos before any single slot had a usable sample, and
 * a recommendation built on one video in one slot is noise wearing a suit.
 */
export function publishTimingReport(videos: PastVideo[]): {
  byDay: { day: string; videos: number; medianViews: number }[]
  byHour: { hour: number; videos: number; medianViews: number }[]
  bestDay: string | null
  bestHour: number | null
  trustworthy: boolean
  headline: string
} {
  const usable = (videos ?? []).filter((v) => {
    if (!v || !Number.isFinite(v.views)) return false
    const t = Date.parse(v.publishedAt)
    return Number.isFinite(t)
  })

  const dayBuckets = new Map<number, number[]>()
  const hourBuckets = new Map<number, number[]>()
  for (const v of usable) {
    const d = new Date(v.publishedAt)
    push(dayBuckets, d.getDay(), v.views)
    push(hourBuckets, d.getHours(), v.views)
  }

  const byDay = [...dayBuckets.entries()]
    .map(([day, views]) => ({ day: DAYS[day], videos: views.length, medianViews: median(views) }))
    .sort((a, b) => b.medianViews - a.medianViews)
  const byHour = [...hourBuckets.entries()]
    .map(([hour, views]) => ({ hour, videos: views.length, medianViews: median(views) }))
    .sort((a, b) => b.medianViews - a.medianViews)

  // A "best" slot needs enough videos in it to be more than a coincidence.
  const bestDayEntry = byDay.find((d) => d.videos >= MIN_PER_GROUP) ?? null
  const bestHourEntry = byHour.find((h) => h.videos >= MIN_PER_GROUP) ?? null
  const trustworthy = usable.length >= MIN_SAMPLE && bestDayEntry !== null

  let headline: string
  if (!usable.length) headline = 'No published videos to learn from yet.'
  else if (!trustworthy) {
    headline = `Only ${usable.length} videos so far — too few to say when your audience shows up. Ask again after ${MIN_SAMPLE}.`
  } else {
    const hourText = bestHourEntry ? ` around ${formatHour(bestHourEntry.hour)}` : ''
    headline = `Your ${bestDayEntry!.day} uploads${hourText} do best — median ${bestDayEntry!.medianViews.toLocaleString()} views across ${bestDayEntry!.videos} videos.`
  }

  return {
    byDay,
    byHour,
    bestDay: trustworthy ? bestDayEntry!.day : null,
    bestHour: trustworthy && bestHourEntry ? bestHourEntry.hour : null,
    trustworthy,
    headline
  }
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

export function formatHour(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
