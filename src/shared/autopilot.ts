/**
 * AUTOPILOT — the studio runs itself, and asks once before anything goes public.
 *
 * THE WHOLE INSTRUCTION IN ONE SENTENCE
 * The user says how many minutes of finished video they want per day and how often; the
 * app comes up with the ideas, writes the scripts, narrates them, scores the titles,
 * makes the thumbnails, renders, and then — and only then — asks: *watch it, read the
 * transcript, read a short summary, or just post it?* Nothing reaches a platform without
 * that answer.
 *
 * WHY THE APPROVAL GATE IS A STATE MACHINE AND NOT A BOOLEAN
 * "Ask before posting" is the one promise in this feature that must never fail, and a
 * flag called `approved` is the easiest thing in the world to leave true by accident — a
 * retry that reuses a record, a queue item recovered after a crash, a default in a JSON
 * file that was written before the field existed. So approval is not a property of an
 * item, it is a TRANSITION into a state that only an explicit user action can cause, and
 * `canPublish` re-derives permission from scratch every time it is asked. An item that
 * has been edited since approval loses it (`approvalKey`), because the thing the user
 * said yes to is no longer the thing that would be posted.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * It does not predict how a video will perform. It plans, it schedules, and it guards the
 * gate. Evidence for a title or a topic comes from the channel's own history
 * (`channelLearn`, `competitorGap`, `thumbnailTest`) and is quoted with its sample size —
 * a number of views this video "will" get is not something any software can honestly
 * offer, and inventing one would make every other number here untrustworthy too.
 *
 * Pure and shared: the desktop window and the phone read the same plan, so the queue can
 * never disagree between them.
 */

/** A long video or a short. They differ in length, aspect and where they go. */
export type PieceKind = 'long' | 'short'

/**
 * How the user wants to check a finished piece before it goes out. Their words:
 * *"Do you wanna watch it? Or do you want to just go over the transcript? Or should I
 * just update it? So it will be my call."*
 */
export type ReviewMode = 'watch' | 'transcript' | 'summary' | 'just-post'

/**
 * Where an item is. The only path to `publishing` is through `approve()`.
 *
 * `blocked` is separate from `failed` on purpose: failed means the render broke and a
 * retry is sensible, blocked means a check said this must not go out (no licence for a
 * track, a figure with no source) and a retry would just fail the same check.
 */
export type PieceState =
  | 'planned'
  | 'building'
  | 'ready' // built, waiting for the user's answer
  | 'approved'
  | 'rejected'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'blocked'

export interface AutopilotBrief {
  /** Minutes of FINISHED video wanted per day, across everything. */
  minutesPerDay: number
  /** Long videos per day (the user asked for morning and evening). */
  longsPerDay: number
  /** Shorts per day (the user asked for at least four). */
  shortsPerDay: number
  /** Local hours at which long videos go out, e.g. [9, 19]. */
  longHours: number[]
  /** Local hours for shorts. */
  shortHours: number[]
  /** How each piece should be checked before posting. */
  review: ReviewMode
  /** Platforms to post to. */
  platforms: string[]
}

export interface PlannedPiece {
  /** Stable id; the approval is keyed against this plus the content. */
  id: string
  kind: PieceKind
  /** Target finished length. Shorts are capped; see SHORT_MAX_SECONDS. */
  targetSeconds: number
  /** ISO time this piece should be published. */
  publishAt: string
  state: PieceState
  review: ReviewMode
  platforms: string[]
}

/** A short longer than this is not a short on any platform worth the name. */
export const SHORT_MAX_SECONDS = 60
/** Below this a "long" video is not long; the planner refuses rather than making stubs. */
export const LONG_MIN_SECONDS = 60
/** A day's work has to fit in a day. Rendering is the constraint, not ambition. */
export const MAX_MINUTES_PER_DAY = 240

export interface PlanProblem {
  field: string
  message: string
}

/**
 * Checks a brief BEFORE any work is planned, and says what is wrong in plain words.
 *
 * Deliberately refuses rather than silently trimming: a brief that quietly became half of
 * what was asked for is worse than one that said "that does not fit". The user is not
 * watching the render, so the only chance to tell them is now.
 */
export function checkBrief(brief: AutopilotBrief): PlanProblem[] {
  const problems: PlanProblem[] = []
  const longs = Math.max(0, Math.trunc(brief.longsPerDay || 0))
  const shorts = Math.max(0, Math.trunc(brief.shortsPerDay || 0))
  const minutes = Number(brief.minutesPerDay)

  if (!Number.isFinite(minutes) || minutes <= 0) {
    problems.push({ field: 'minutesPerDay', message: 'Say how many minutes of video you want per day.' })
  } else if (minutes > MAX_MINUTES_PER_DAY) {
    problems.push({
      field: 'minutesPerDay',
      message: `${minutes} minutes a day is more than this can render in a day. ${MAX_MINUTES_PER_DAY} is the most it will take on.`
    })
  }
  if (longs + shorts === 0) {
    problems.push({ field: 'longsPerDay', message: 'Ask for at least one video or one short per day.' })
  }
  if (longs > 0 && brief.longHours.length < longs) {
    problems.push({
      field: 'longHours',
      message: `You asked for ${longs} videos a day but gave ${brief.longHours.length} times to post them.`
    })
  }
  if (shorts > 0 && brief.shortHours.length < shorts) {
    problems.push({
      field: 'shortHours',
      message: `You asked for ${shorts} shorts a day but gave ${brief.shortHours.length} times to post them.`
    })
  }
  if (!brief.platforms || brief.platforms.length === 0) {
    problems.push({ field: 'platforms', message: 'Choose at least one place to post to.' })
  }
  for (const h of [...(brief.longHours ?? []), ...(brief.shortHours ?? [])]) {
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      problems.push({ field: 'hours', message: `"${h}" is not an hour of the day.` })
      break
    }
  }

  // Only worth checking once the counts themselves make sense.
  if (problems.length === 0) {
    const shortSeconds = shorts * SHORT_MAX_SECONDS
    const longSeconds = minutes * 60 - shortSeconds
    if (longs > 0 && longSeconds < longs * LONG_MIN_SECONDS) {
      problems.push({
        field: 'minutesPerDay',
        message: `${minutes} minutes does not leave enough for ${longs} video${longs === 1 ? '' : 's'} once ${shorts} short${shorts === 1 ? '' : 's'} are taken out. Ask for more minutes or fewer shorts.`
      })
    }
  }
  return problems
}

/**
 * Splits `total` into `parts` whole seconds that sum to EXACTLY total.
 *
 * The remainder is handed out one second at a time rather than left on the floor. Naive
 * division loses up to `parts - 1` seconds, which is how "I asked for twenty minutes" ends
 * up as nineteen and nobody can see why.
 */
export function splitSeconds(total: number, parts: number): number[] {
  if (parts <= 0) return []
  const base = Math.floor(total / parts)
  let rest = total - base * parts
  return Array.from({ length: parts }, () => {
    const extra = rest > 0 ? 1 : 0
    rest -= extra
    return base + extra
  })
}

/**
 * Turns one day's brief into concrete pieces with real publish times.
 *
 * Shorts get their length first and are capped, because a short is a fixed-size thing;
 * whatever is left is shared between the long videos. `dayStartIso` is the local midnight
 * of the day being planned — passed in rather than read from the clock so the same brief
 * always plans the same day, and so this stays testable.
 */
export function planDay(brief: AutopilotBrief, dayStartIso: string, idPrefix: string): PlannedPiece[] {
  if (checkBrief(brief).length > 0) return []
  const longs = Math.trunc(brief.longsPerDay)
  const shorts = Math.trunc(brief.shortsPerDay)
  const dayStart = Date.parse(dayStartIso)
  if (!Number.isFinite(dayStart)) return []

  const at = (hour: number): string => new Date(dayStart + hour * 3_600_000).toISOString()
  const pieces: PlannedPiece[] = []

  const longSeconds = splitSeconds(brief.minutesPerDay * 60 - shorts * SHORT_MAX_SECONDS, longs)
  for (let i = 0; i < longs; i++) {
    pieces.push({
      id: `${idPrefix}-long-${i + 1}`,
      kind: 'long',
      targetSeconds: longSeconds[i],
      publishAt: at(brief.longHours[i]),
      state: 'planned',
      review: brief.review,
      platforms: [...brief.platforms]
    })
  }
  for (let i = 0; i < shorts; i++) {
    pieces.push({
      id: `${idPrefix}-short-${i + 1}`,
      kind: 'short',
      targetSeconds: SHORT_MAX_SECONDS,
      publishAt: at(brief.shortHours[i]),
      state: 'planned',
      review: brief.review,
      platforms: [...brief.platforms]
    })
  }
  // Chronological, because that is the order they will actually be worked on.
  return pieces.sort((a, b) => a.publishAt.localeCompare(b.publishAt))
}

/** What a finished piece must have before the user can even be asked about it. */
export interface BuiltPiece extends PlannedPiece {
  videoPath?: string
  title?: string
  description?: string
  tags?: string[]
  thumbnailPath?: string
  transcript?: string
  /** Set when a pre-publish check refused this piece; state should be 'blocked'. */
  blockedReason?: string
  /** Identifies exactly what the user approved. Recomputed on every edit. */
  approvalKey?: string
  /** The key that was actually approved, and by whom/when. */
  approvedKey?: string
  approvedAt?: string
}

/**
 * A fingerprint of everything a viewer would see.
 *
 * This is what makes approval mean something. If any of it changes after the user said
 * yes, the key no longer matches and the item needs asking again — because the thing they
 * approved is not the thing that would be posted. Length-prefixed so that moving a
 * character between two fields cannot produce the same key.
 */
export function approvalKeyFor(p: BuiltPiece): string {
  const parts = [
    p.videoPath ?? '',
    p.title ?? '',
    p.description ?? '',
    (p.tags ?? []).join(','),
    p.thumbnailPath ?? '',
    p.platforms.join(',')
  ]
  return parts.map((s) => `${s.length}:${s}`).join('|')
}

/** Everything missing that would stop this piece being offered to the user. */
export function missingForReview(p: BuiltPiece): string[] {
  const missing: string[] = []
  if (!p.videoPath) missing.push('the finished video')
  if (!p.title) missing.push('a title')
  if (!p.description) missing.push('a description')
  if (!p.tags || p.tags.length === 0) missing.push('tags')
  if (!p.thumbnailPath && p.kind === 'long') missing.push('a thumbnail')
  // A transcript is required even for "just post": the user must always be ABLE to read
  // what they are publishing, whether or not they choose to on the day.
  if (!p.transcript) missing.push('a transcript')
  return missing
}

/**
 * Records the user's explicit yes. The ONLY way into `approved`.
 *
 * Takes the key it is approving so a stale screen cannot approve a newer version of the
 * item than the one it was showing.
 */
export function approve(p: BuiltPiece, keyShown: string, atIso: string): BuiltPiece {
  if (p.state !== 'ready') return p
  if (keyShown !== approvalKeyFor(p)) return p
  return { ...p, state: 'approved', approvedKey: keyShown, approvedAt: atIso }
}

export function reject(p: BuiltPiece): BuiltPiece {
  return p.state === 'ready' || p.state === 'approved' ? { ...p, state: 'rejected', approvedKey: undefined } : p
}

/**
 * May this piece be posted, right now?
 *
 * Re-derived from scratch every time rather than read from a flag, and every branch is a
 * refusal. `false` is the answer to anything unexpected — including a state this code does
 * not recognise, which is what a file written by a future version would look like.
 */
export function canPublish(p: BuiltPiece): { ok: true } | { ok: false; reason: string } {
  if (p.state === 'rejected') return { ok: false, reason: 'You said no to this one.' }
  if (p.state === 'blocked') return { ok: false, reason: p.blockedReason || 'A check refused this one.' }
  if (p.state === 'published') return { ok: false, reason: 'It is already posted.' }
  if (p.state !== 'approved') return { ok: false, reason: 'You have not approved this one yet.' }
  const missing = missingForReview(p)
  if (missing.length > 0) return { ok: false, reason: `Still missing ${missing.join(', ')}.` }
  if (!p.approvedKey) return { ok: false, reason: 'There is no record of what you approved.' }
  if (p.approvedKey !== approvalKeyFor(p)) {
    return { ok: false, reason: 'It changed after you approved it, so it needs approving again.' }
  }
  return { ok: true }
}

/**
 * Moves a built piece to `ready` — the point at which the user is asked.
 *
 * Note it does NOT skip this for `just-post`. "Just post it" is the user's answer to the
 * question, not a reason to stop asking it: the transcript still has to exist, the checks
 * still have to pass, and the record still has to show they said yes. The difference is
 * only how much they choose to look at.
 */
export function markReady(p: BuiltPiece): BuiltPiece {
  if (p.state !== 'building' && p.state !== 'planned') return p
  const missing = missingForReview(p)
  if (missing.length > 0) return { ...p, state: 'failed' }
  return { ...p, state: 'ready', approvalKey: approvalKeyFor(p), approvedKey: undefined }
}

/** Refuses a piece outright, with the reason kept for the screen. */
export function block(p: BuiltPiece, reason: string): BuiltPiece {
  return { ...p, state: 'blocked', blockedReason: reason, approvedKey: undefined }
}

/**
 * The pieces due to be posted at or before `nowIso`, in order, that are allowed to go.
 *
 * Filtering by `canPublish` here as well as at the point of posting is intentional: a
 * caller that forgot the check would otherwise post an unapproved item, and this list is
 * the obvious thing for a caller to trust.
 */
export function duePieces(pieces: BuiltPiece[], nowIso: string): BuiltPiece[] {
  return pieces
    .filter((p) => p.publishAt <= nowIso && canPublish(p).ok)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt))
}

/** One line for the summary the user reads when they choose 'summary'. */
export function shortSummary(p: BuiltPiece): string {
  const words = (p.transcript ?? '').trim().split(/\s+/).filter(Boolean).length
  const mins = Math.max(1, Math.round(p.targetSeconds / 60))
  const where = p.platforms.join(' and ')
  return [
    `${p.kind === 'short' ? 'Short' : 'Video'}, about ${p.kind === 'short' ? `${p.targetSeconds} seconds` : `${mins} minute${mins === 1 ? '' : 's'}`}`,
    `titled "${p.title ?? 'untitled'}"`,
    words ? `${words} words of narration` : null,
    `for ${where}`
  ]
    .filter(Boolean)
    .join(', ')
}
