/**
 * Teleprompter timing — the maths, kept pure and away from any UI.
 *
 * A prompter is only useful if the scroll speed is honest: if it claims 150 words a
 * minute it must actually take exactly `words / 150 * 60` seconds to pass the reading
 * line, or you either run out of script early or get left behind. Everything here is
 * exact and unit-tested for that reason.
 *
 * Two details that matter and are easy to get wrong:
 *
 *  1. The studio's scripts carry bracketed STAGE DIRECTIONS — [PATTERN INTERRUPT],
 *     [BLUF], [EVIDENCE BLOCS] and so on (see prompts.ts). Those are instructions to
 *     the presenter, not words to say. They must still be VISIBLE (you need to know a
 *     section is coming) but must NOT be counted when timing the read, or every script
 *     finishes early.
 *  2. 150 words per minute is the same figure the rest of the studio already assumes
 *     for spoken pacing (see storyboard.ts and prompts.ts), so a prompter run matches
 *     the durations the storyboard was planned with.
 */

/** The studio's standing assumption for spoken pace, used everywhere else too. */
export const DEFAULT_WPM = 150

/** Sane bounds. Below 60 is a crawl; above 300 is unreadable for anyone. */
export const MIN_WPM = 60
export const MAX_WPM = 300

/** Countdown lengths offered before recording starts. */
export const COUNTDOWN_CHOICES = [0, 3, 5, 10, 20, 30] as const
export type CountdownSeconds = (typeof COUNTDOWN_CHOICES)[number]

/** A bracketed direction on its own, e.g. "[PATTERN INTERRUPT]". */
const STAGE_DIRECTION = /\[[^\]]*\]/g

export type PrompterLineKind = 'speech' | 'direction' | 'blank'

export interface PrompterLine {
  kind: PrompterLineKind
  text: string
  /** Words actually spoken on this line (0 for directions and blanks). */
  words: number
}

export function clampWpm(wpm: number): number {
  if (!Number.isFinite(wpm)) return DEFAULT_WPM
  return Math.min(Math.max(Math.round(wpm), MIN_WPM), MAX_WPM)
}

/**
 * Counts spoken words, ignoring bracketed stage directions entirely.
 * "[BLUF] The rupee is falling" is three words to say, not four.
 */
export function countSpokenWords(text: string): number {
  const spoken = (text ?? '').replace(STAGE_DIRECTION, ' ')
  const words = spoken.trim().split(/\s+/).filter(Boolean)
  return words.length
}

/** How long this script takes to read aloud at the given pace, in seconds. */
export function readingSeconds(text: string, wpm: number = DEFAULT_WPM): number {
  const words = countSpokenWords(text)
  const rate = clampWpm(wpm)
  return words === 0 ? 0 : (words / rate) * 60
}

/**
 * The pace needed to finish a script in a target time.
 * Returns null when there is nothing to say or no time to say it in — the caller
 * should leave the user's chosen speed alone rather than snap it to a bound.
 */
export function suggestWpm(text: string, targetSeconds: number): number | null {
  const words = countSpokenWords(text)
  if (words === 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) return null
  return clampWpm((words / targetSeconds) * 60)
}

/**
 * Constant scroll speed, in pixels per second, so the text takes exactly
 * `readingSeconds` to travel `scrollDistancePx`.
 *
 * `scrollDistancePx` is how far the container actually has to move — normally
 * `scrollHeight - clientHeight`. A script that fits on screen has nothing to scroll,
 * so the speed is 0 rather than a divide-by-zero.
 */
export function scrollPixelsPerSecond(scrollDistancePx: number, seconds: number): number {
  if (!Number.isFinite(scrollDistancePx) || scrollDistancePx <= 0) return 0
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return scrollDistancePx / seconds
}

/**
 * Splits a script into display lines, marking which are spoken and which are
 * directions. Blank lines are kept so paragraph spacing survives on screen.
 */
export function toPrompterLines(text: string): PrompterLine[] {
  return (text ?? '').split(/\r?\n/).map((raw) => {
    const line = raw.trim()
    if (!line) return { kind: 'blank' as const, text: '', words: 0 }
    // A line that is ONLY a bracketed direction is a heading, not speech.
    if (/^\[[^\]]*\]$/.test(line)) return { kind: 'direction' as const, text: line, words: 0 }
    return { kind: 'speech' as const, text: line, words: countSpokenWords(line) }
  })
}

export interface PrompterProgress {
  /** 0..1 through the scrollable distance. */
  fraction: number
  elapsedSeconds: number
  remainingSeconds: number
}

/** Where a run is up to, given how far it has scrolled. */
export function progressAt(scrolledPx: number, scrollDistancePx: number, totalSeconds: number): PrompterProgress {
  const fraction =
    scrollDistancePx > 0 ? Math.min(Math.max(scrolledPx / scrollDistancePx, 0), 1) : scrolledPx > 0 ? 1 : 0
  const elapsed = totalSeconds * fraction
  return {
    fraction,
    elapsedSeconds: elapsed,
    remainingSeconds: Math.max(0, totalSeconds - elapsed)
  }
}

/** m:ss for the on-screen clock. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Builds prompter text from storyboard beats, so what you read is the narration you
 * actually planned, with each scene marked. Scenes with no narration still appear as
 * a marker — you need to know a silent shot is coming rather than be surprised by it.
 */
export function scriptFromBeats(beats: { narration?: string; visual: string; durationSec: number }[]): string {
  return beats
    .map((b, i) => {
      const head = `[SCENE ${i + 1} · ${Math.round(b.durationSec)}s · ${b.visual.slice(0, 60)}]`
      return b.narration?.trim() ? `${head}\n${b.narration.trim()}` : `${head}\n(no narration — silent shot)`
    })
    .join('\n\n')
}
