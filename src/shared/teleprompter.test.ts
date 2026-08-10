/**
 * The prompter's timing has to be exactly right or it is worse than useless: a speed
 * that claims 150 words a minute but doesn't deliver it means you either run out of
 * script mid-sentence or get left behind. These pin the arithmetic down.
 */
import { describe, expect, it } from 'vitest'
import {
  COUNTDOWN_CHOICES,
  DEFAULT_WPM,
  MAX_WPM,
  MIN_WPM,
  clampWpm,
  countSpokenWords,
  formatClock,
  progressAt,
  readingSeconds,
  scriptFromBeats,
  scrollPixelsPerSecond,
  suggestWpm,
  toPrompterLines
} from './teleprompter'

describe('counting what is actually spoken', () => {
  it('counts plain words', () => {
    expect(countSpokenWords('one two three')).toBe(3)
    expect(countSpokenWords('  spaced   out  words ')).toBe(3)
    expect(countSpokenWords('')).toBe(0)
    expect(countSpokenWords('   ')).toBe(0)
  })

  it('EXCLUDES bracketed stage directions — they are not spoken', () => {
    // This is the whole point: [BLUF] is an instruction to the presenter. Counting it
    // would make every script finish early and the scroll speed a lie.
    expect(countSpokenWords('[BLUF] The rupee is falling')).toBe(4)
    expect(countSpokenWords('[PATTERN INTERRUPT]')).toBe(0)
    expect(countSpokenWords('[EVIDENCE BLOCS]\n[COUNTERPOINT]')).toBe(0)
  })

  it('handles a direction in the middle of a sentence', () => {
    expect(countSpokenWords('Look here [pause] and then look there')).toBe(6)
  })

  it('copes with an unclosed bracket instead of eating the rest of the script', () => {
    expect(countSpokenWords('[BLUF The rupee is falling')).toBe(5)
  })
})

describe('reading time', () => {
  it('is exactly words / wpm * 60', () => {
    const text = Array.from({ length: 150 }, (_, i) => `w${i}`).join(' ')
    expect(readingSeconds(text, 150)).toBe(60)
    expect(readingSeconds(text, 300)).toBe(30)
    expect(readingSeconds(text, 75)).toBe(120)
  })

  it('ignores directions in the timing', () => {
    const words = Array.from({ length: 150 }, (_, i) => `w${i}`).join(' ')
    expect(readingSeconds(`[PATTERN INTERRUPT]\n${words}`, 150)).toBe(60)
  })

  it('is zero for an empty or directions-only script', () => {
    expect(readingSeconds('', 150)).toBe(0)
    expect(readingSeconds('[BLUF]\n[TAKEAWAY]', 150)).toBe(0)
  })

  it('defaults to the studio-wide 150 wpm', () => {
    expect(DEFAULT_WPM).toBe(150)
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')
    expect(readingSeconds(text)).toBe(120)
  })
})

describe('clamping', () => {
  it('keeps speed inside readable bounds', () => {
    expect(clampWpm(10)).toBe(MIN_WPM)
    expect(clampWpm(9999)).toBe(MAX_WPM)
    expect(clampWpm(150)).toBe(150)
    expect(clampWpm(150.4)).toBe(150)
  })

  it('falls back to the default for nonsense', () => {
    expect(clampWpm(Number.NaN)).toBe(DEFAULT_WPM)
    expect(clampWpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WPM)
  })
})

describe('suggesting a speed for a target length', () => {
  it('inverts the reading-time formula', () => {
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')
    // 300 words in 120s is exactly 150 wpm.
    expect(suggestWpm(text, 120)).toBe(150)
    // And the suggestion must round-trip back to the target.
    expect(readingSeconds(text, suggestWpm(text, 120) as number)).toBe(120)
  })

  it('returns null rather than guessing when there is nothing to work from', () => {
    expect(suggestWpm('', 60)).toBeNull()
    expect(suggestWpm('[BLUF]', 60)).toBeNull()
    expect(suggestWpm('some words here', 0)).toBeNull()
    expect(suggestWpm('some words here', -5)).toBeNull()
  })

  it('still clamps an impossible target', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(' ')
    expect(suggestWpm(text, 1)).toBe(MAX_WPM)
  })
})

describe('scroll speed', () => {
  it('covers the distance in exactly the reading time', () => {
    // 1200px to travel in 60s is 20px per second, and 60 * 20 lands exactly at 1200.
    const pps = scrollPixelsPerSecond(1200, 60)
    expect(pps).toBe(20)
    expect(pps * 60).toBe(1200)
  })

  it('is zero when there is nothing to scroll', () => {
    // A short script that already fits on screen must not divide by zero or drift.
    expect(scrollPixelsPerSecond(0, 60)).toBe(0)
    expect(scrollPixelsPerSecond(-10, 60)).toBe(0)
    expect(scrollPixelsPerSecond(1200, 0)).toBe(0)
    expect(scrollPixelsPerSecond(1200, -3)).toBe(0)
  })

  it('ties together end to end: a real script finishes exactly on time', () => {
    const text = Array.from({ length: 450 }, (_, i) => `w${i}`).join(' ')
    const seconds = readingSeconds(text, 150) // 180s
    const pps = scrollPixelsPerSecond(3600, seconds)
    expect(seconds).toBe(180)
    expect(pps).toBe(20)
    expect(pps * seconds).toBe(3600)
  })
})

describe('progress', () => {
  it('reports the fraction, elapsed and remaining', () => {
    expect(progressAt(600, 1200, 60)).toEqual({ fraction: 0.5, elapsedSeconds: 30, remainingSeconds: 30 })
    expect(progressAt(0, 1200, 60)).toEqual({ fraction: 0, elapsedSeconds: 0, remainingSeconds: 60 })
    expect(progressAt(1200, 1200, 60)).toEqual({ fraction: 1, elapsedSeconds: 60, remainingSeconds: 0 })
  })

  it('never goes past the ends', () => {
    expect(progressAt(9999, 1200, 60).fraction).toBe(1)
    expect(progressAt(-50, 1200, 60).fraction).toBe(0)
    expect(progressAt(9999, 1200, 60).remainingSeconds).toBe(0)
  })

  it('treats an unscrollable script as done rather than dividing by zero', () => {
    expect(progressAt(0, 0, 30).fraction).toBe(0)
    expect(Number.isFinite(progressAt(10, 0, 30).fraction)).toBe(true)
  })
})

describe('lines', () => {
  it('marks directions, speech and blanks apart', () => {
    const lines = toPrompterLines('[PATTERN INTERRUPT]\n\nYeh number dekhein.\n[BLUF] Two things matter.')
    expect(lines.map((l) => l.kind)).toEqual(['direction', 'blank', 'speech', 'speech'])
    // A heading contributes no spoken words…
    expect(lines[0].words).toBe(0)
    // …but a direction inline with speech still leaves the speech counted.
    expect(lines[3].words).toBe(3)
  })

  it('survives an empty script', () => {
    expect(toPrompterLines('')).toEqual([{ kind: 'blank', text: '', words: 0 }])
  })

  it('line word counts add up to the whole script', () => {
    const script = '[BLUF] One two three\nfour five\n\n[TAKEAWAY]\nsix seven eight nine'
    const total = toPrompterLines(script).reduce((n, l) => n + l.words, 0)
    expect(total).toBe(countSpokenWords(script))
  })
})

describe('clock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(605)).toBe('10:05')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('reading from a storyboard', () => {
  it('marks each scene and keeps the narration', () => {
    const script = scriptFromBeats([
      { narration: 'Aaj hum baat karain ge.', visual: 'Karachi skyline', durationSec: 8 },
      { visual: 'A trading floor', durationSec: 6 }
    ])
    expect(script).toContain('[SCENE 1 · 8s · Karachi skyline]')
    expect(script).toContain('Aaj hum baat karain ge.')
    // A silent shot must still be announced — being surprised by one ruins a take.
    expect(script).toContain('[SCENE 2 · 6s · A trading floor]')
    expect(script).toContain('(no narration — silent shot)')
  })

  it('times only the narration, not the scene markers', () => {
    const script = scriptFromBeats([
      { narration: Array.from({ length: 150 }, (_, i) => `w${i}`).join(' '), visual: 'A skyline', durationSec: 60 }
    ])
    expect(readingSeconds(script, 150)).toBe(60)
  })
})

describe('countdown choices', () => {
  it('offers the lengths a presenter actually needs, including none', () => {
    expect(COUNTDOWN_CHOICES).toContain(0)
    expect(COUNTDOWN_CHOICES).toContain(10)
    expect([...COUNTDOWN_CHOICES]).toEqual([...COUNTDOWN_CHOICES].sort((a, b) => a - b))
  })
})
