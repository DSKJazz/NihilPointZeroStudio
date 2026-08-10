import { describe, expect, it } from 'vitest'
import { buildShortArgs, pickShortMoments, scoreSegment } from './shorts'
import type { CaptionSegment } from './captions'

/** Builds a spoken transcript: one segment per line, `secs` long each. */
function transcript(lines: string[], secs = 5): CaptionSegment[] {
  return lines.map((text, i) => ({ text, start: i * secs, end: (i + 1) * secs }))
}

describe('scoreSegment', () => {
  it('rewards hook words, numbers and questions', () => {
    const plain = scoreSegment('The market was open on Tuesday as usual and things went along.')
    const hooky = scoreSegment('But why did nobody notice the 40 percent collapse?')
    expect(hooky.score).toBeGreaterThan(plain.score)
    expect(hooky.reason).toMatch(/hook words|question|number/)
  })

  it('always explains its choice', () => {
    expect(scoreSegment('Something entirely ordinary.').reason).toBeTruthy()
  })
})

describe('pickShortMoments', () => {
  // 12 lines × 5s = a 60s source, so three ~15s clips genuinely fit.
  const lines = [
    'Welcome back to the channel today we are talking about the market.',
    'But why did nobody notice the 40 percent collapse in bank stocks?',
    'The index opened flat and drifted sideways for most of the morning.',
    'Trading desks reported steady interest from local institutional buyers.',
    'Here is the secret most people never understand about inflation numbers.',
    'The central bank kept its policy rate unchanged at the last meeting.',
    'Volumes were thin and the rupee held steady against the dollar.',
    'Analysts expect the trend to continue through the coming quarter.',
    'Remember this one mistake costs investors billions every single year.',
    'Foreign flows turned positive for the third consecutive session.',
    'Cement and fertiliser names led the gains on the benchmark index.',
    'That is all for today thanks for watching and see you next time.'
  ]

  it('returns the requested number of non-overlapping clips in time order', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 15 })
    expect(picks).toHaveLength(3)
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].startSec).toBeGreaterThanOrEqual(picks[i - 1].endSec)
    }
  })

  it('returns FEWER clips (never overlapping ones) when the video is too short for the ask', () => {
    // 35s of source cannot hold three 20s clips — quality over quantity.
    const picks = pickShortMoments(transcript(lines.slice(0, 7)), { count: 3, minSec: 10, maxSec: 20 })
    expect(picks.length).toBeLessThan(3)
    expect(picks.length).toBeGreaterThan(0)
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].startSec).toBeGreaterThanOrEqual(picks[i - 1].endSec)
    }
  })

  it('prefers hooky openings over filler', () => {
    const picks = pickShortMoments(transcript(lines), { count: 2, minSec: 10, maxSec: 20 })
    const openings = picks.map((p) => p.captions[0].text).join(' | ')
    expect(openings).toMatch(/why did nobody|secret|mistake/i)
  })

  it('keeps clips inside the requested length window', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 15 })
    for (const p of picks) {
      const len = p.endSec - p.startSec
      expect(len).toBeLessThanOrEqual(15)
      expect(len).toBeGreaterThan(0)
    }
  })

  it('re-bases captions so every clip starts at zero', () => {
    const picks = pickShortMoments(transcript(lines), { count: 3, minSec: 10, maxSec: 20 })
    for (const p of picks) {
      expect(p.captions[0].start).toBe(0)
      expect(p.captions[p.captions.length - 1].end).toBeLessThanOrEqual(p.endSec - p.startSec + 0.001)
    }
  })

  it('gives every clip a title and a human reason', () => {
    for (const p of pickShortMoments(transcript(lines), { count: 2, minSec: 10, maxSec: 20 })) {
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.reason.length).toBeGreaterThan(0)
    }
  })

  it('is safe on an empty or speechless transcript', () => {
    expect(pickShortMoments([])).toEqual([])
    expect(pickShortMoments([{ text: '   ', start: 0, end: 3 }])).toEqual([])
  })

  it('still returns one clip for a video shorter than the minimum', () => {
    const picks = pickShortMoments(transcript(['A very short video about one single idea.']), {
      count: 3,
      minSec: 20,
      maxSec: 60
    })
    expect(picks).toHaveLength(1)
  })
})

describe('buildShortArgs', () => {
  const base = { srcPath: 'C:\\v\\in.mp4', outPath: 'C:\\v\\out.mp4', startSec: 12.5, endSec: 45 }

  it('cuts the exact window and reframes to a 9:16 1080x1920 canvas', () => {
    const a = buildShortArgs(base).join(' ')
    expect(a).toContain('-ss 12.500')
    expect(a).toContain('-to 45.000')
    expect(a).toContain('crop=')
    expect(a).toContain('scale=1080:1920')
    expect(a).toContain('setsar=1')
  })

  it('burns captions with the big centred short-form style when an srt is given', () => {
    const a = buildShortArgs({ ...base, srtPath: 'C:\\v\\clip.srt' }).join(' ')
    expect(a).toContain('subtitles=')
    expect(a).toContain('Bold=1')
    expect(a).toContain('Alignment=2')
  })

  it('omits the subtitles filter entirely when there is no srt', () => {
    expect(buildShortArgs(base).join(' ')).not.toContain('subtitles=')
  })

  it('honours a custom height and keeps the width even', () => {
    const a = buildShortArgs({ ...base, height: 1280 }).join(' ')
    expect(a).toContain('scale=720:1280')
  })
})

describe('housekeeping never opens a short', () => {
  const junk = [
    "Don't forget to subscribe and hit the bell.",
    'Like and share if this helped you today.',
    "In today's video we look at the rupee.",
    'As I said earlier, watch the reserves print.',
    'Link in the description below.',
    'Channel ko subscribe karein.'
  ]

  it('scores every kind of plug below zero', () => {
    for (const line of junk) expect(scoreSegment(line).score, line).toBeLessThan(0)
  })

  it('beats every other rule — a plug stuffed with hooks is still a plug', () => {
    // Without the override this scores well: hook word, a number, and urgency. A Short
    // that opens on a plug is dead on arrival however good the rest of the clip is.
    const s = scoreSegment('Subscribe today and you could save 50 percent right now.')
    expect(s.score).toBeLessThan(0)
    expect(s.reason).toMatch(/housekeeping/)
  })

  it('does not mistake ordinary speech for a plug', () => {
    expect(scoreSegment('The reason nobody watches import cover is that it is boring.').score).toBeGreaterThan(0)
  })
})

describe('Roman Urdu scores, not just English', () => {
  it('picks up the contradiction, the question, the stake', () => {
    // This channel is spoken in mixed Roman Urdu. An English-only word list was blind
    // to roughly half of every script's strongest moments.
    for (const line of [
      'Lekin asal haqiqat yeh hai ke reserves gir rahe hain.',
      'Kyun koi import cover ki baat nahi karta?',
      'Aap ka nuqsan is mein sab se zyada hai.'
    ]) {
      expect(scoreSegment(line).score, line).toBeGreaterThan(0)
    }
  })

  it('scores a Roman Urdu hook comparably to its English twin', () => {
    const urdu = scoreSegment('Lekin asal wajah kuch aur hai aur aap ko nuqsan ho raha hai.')
    const english = scoreSegment('But the actual reason is different and you are losing money.')
    // Not identical wording, so not identical scores — but the Urdu line must not be
    // scored as filler while the English one is a hook.
    expect(urdu.score).toBeGreaterThan(0)
    expect(english.score).toBeGreaterThan(0)
  })

  it('rewards naming a real institution', () => {
    expect(scoreSegment('State Bank reserves fell again this month.').score).toBeGreaterThan(0)
    expect(scoreSegment('PSX volumes tell a different story here.').score).toBeGreaterThan(0)
  })
})
