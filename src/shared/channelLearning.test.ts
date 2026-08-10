/**
 * The failure this module must never commit is LYING WITH A SMALL SAMPLE. A confident
 * claim built on three videos is worse than no claim, because the user will act on it
 * and change their titles for a year based on noise. So the refusal path is tested
 * harder than the happy path.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_PER_GROUP,
  MIN_SAMPLE,
  TITLE_PATTERNS,
  formatHour,
  learnTitlePatterns,
  median,
  publishTimingReport,
  scoreTitle,
  testPattern,
  type PastVideo
} from './channelLearning'

const v = (title: string, views: number, publishedAt = '2026-07-01T18:00:00'): PastVideo => ({
  title,
  views,
  publishedAt
})

/** Twelve videos where titles WITH a number clearly outperform. */
const HISTORY: PastVideo[] = [
  v('Rupee falls 3 percent this week', 50_000),
  v('Reserves drop to 11.2 billion', 46_000),
  v('PSX gains 400 points today', 44_000),
  v('Gold crosses 250,000 per tola', 52_000),
  v('5 things about the budget', 48_000),
  v('Why the rupee is falling', 12_000),
  v('What the reserves really mean', 11_000),
  v('Understanding import cover', 9_000),
  v('The budget explained', 13_000),
  v('Gold and what comes next', 10_000),
  v('A look at the stock market', 8_000),
  v('Thoughts on the economy', 11_500)
]

describe('median, not mean — one viral video must not set the strategy', () => {
  it('is the middle value', () => {
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('ignores a single outlier that would wreck a mean', () => {
    // A mean here is 200,020. The typical video got 20 views, and that is the video
    // being planned — unrepeatable luck is not a strategy.
    expect(median([10, 20, 30, 1_000_000])).toBe(25)
  })

  it('handles empty and non-numeric input', () => {
    expect(median([])).toBe(0)
    expect(median([NaN, 1, 3])).toBe(2)
  })
})

describe('refusing to draw a conclusion from too little data', () => {
  it('says "not enough" below the minimum sample', () => {
    const f = testPattern(HISTORY.slice(0, 4), TITLE_PATTERNS[0])
    expect(f.trustworthy).toBe(false)
    expect(f.headline).toMatch(/not enough videos to tell yet/)
  })

  it('says "not enough" when one GROUP is too small, even with plenty of videos', () => {
    // Twenty videos, but nineteen have a number. One video is not a control group,
    // and this is the subtler version of the same mistake.
    const lopsided = [
      ...Array.from({ length: 19 }, (_, i) => v(`Video ${i} about 5 things`, 30_000)),
      v('No digits here at all', 90_000)
    ]
    const f = testPattern(lopsided, TITLE_PATTERNS[0])
    expect(f.withoutCount).toBe(1)
    expect(f.trustworthy).toBe(false)
  })

  it('still REPORTS the untrustworthy test rather than hiding it', () => {
    // Hiding it makes the tool look like it did nothing. Showing it with "not enough
    // yet" tells the user what was checked and why no answer came back.
    const findings = learnTitlePatterns(HISTORY.slice(0, 3))
    expect(findings).toHaveLength(TITLE_PATTERNS.length)
    expect(findings.every((f) => !f.trustworthy)).toBe(true)
  })

  it('the thresholds themselves are sane', () => {
    expect(MIN_SAMPLE).toBeGreaterThanOrEqual(8)
    expect(MIN_PER_GROUP).toBeGreaterThanOrEqual(3)
    expect(MIN_PER_GROUP * 2).toBeLessThanOrEqual(MIN_SAMPLE)
  })

  it('never claims a difference under 10% is real', () => {
    // Noise. Reporting it would send the user chasing nothing.
    const flat = Array.from({ length: 12 }, (_, i) => v(i % 2 ? `Video ${i} has 5 things` : 'Video no digits', 30_000))
    const f = testPattern(flat, TITLE_PATTERNS[0])
    expect(f.headline).toMatch(/no real difference/)
  })
})

describe('finding what really works on this channel', () => {
  it('spots the pattern that genuinely outperforms', () => {
    const f = testPattern(HISTORY, TITLE_PATTERNS[0])
    expect(f.trustworthy).toBe(true)
    expect(f.liftPercent).toBeGreaterThan(100)
    expect(f.headline).toMatch(/does \d+% better on your channel/)
  })

  it('always reports the sample size alongside the claim', () => {
    // "40% better" means nothing without knowing it is based on 6 videos vs 6.
    const f = testPattern(HISTORY, TITLE_PATTERNS[0])
    expect(f.headline).toContain(`${f.withCount} vs ${f.withoutCount} videos`)
  })

  it('reports a pattern that HURTS as clearly as one that helps', () => {
    const inverted = HISTORY.map((x) => ({ ...x, views: 60_000 - x.views }))
    const f = testPattern(inverted, TITLE_PATTERNS[0])
    expect(f.liftPercent).toBeLessThan(0)
    expect(f.headline).toMatch(/WORSE/)
  })

  it('puts trustworthy findings before untrustworthy ones', () => {
    const findings = learnTitlePatterns(HISTORY)
    const firstUntrusted = findings.findIndex((f) => !f.trustworthy)
    if (firstUntrusted !== -1) {
      expect(findings.slice(firstUntrusted).every((f) => !f.trustworthy)).toBe(true)
    }
  })

  it('tests Roman Urdu titles as a pattern in their own right', () => {
    expect(TITLE_PATTERNS.some((p) => p.name.includes('Roman Urdu'))).toBe(true)
    expect(TITLE_PATTERNS.find((p) => p.name.includes('Roman Urdu'))!.test('Mehngai kyun barh rahi hai')).toBe(true)
  })

  it('survives junk in the history', () => {
    expect(() => learnTitlePatterns([{ title: undefined as unknown as string, views: 1, publishedAt: 'x' }])).not.toThrow()
    expect(() => learnTitlePatterns(undefined as unknown as PastVideo[])).not.toThrow()
    expect(() => learnTitlePatterns([])).not.toThrow()
  })
})

describe('scoring a proposed title', () => {
  it('gives REASONS, not just a number', () => {
    // A score of 73 tells the user nothing to act on.
    const s = scoreTitle('Rupee falls 4 percent this month', HISTORY)
    expect(s.grounded).toBe(true)
    expect(s.reasons.length).toBeGreaterThan(0)
    expect(s.reasons.join(' ')).toMatch(/your channel/)
  })

  it('rewards a title carrying what works for this channel', () => {
    const good = scoreTitle('Reserves drop 8 percent in one month', HISTORY)
    const bad = scoreTitle('Some thoughts on the economy', HISTORY)
    expect(good.score).toBeGreaterThan(bad.score)
  })

  it('names what is MISSING, which is the actionable part', () => {
    const s = scoreTitle('Thoughts on the economy', HISTORY)
    expect(s.reasons.join(' ')).toMatch(/Missing/)
  })

  it('refuses to score at all without enough history, and says why', () => {
    const s = scoreTitle('Anything at all', HISTORY.slice(0, 4))
    expect(s.grounded).toBe(false)
    expect(s.score).toBe(0)
    expect(s.reasons[0]).toMatch(/Not enough history/)
    // And it is honest that general advice is the only alternative, and worth less.
    expect(s.reasons[0]).toMatch(/General advice/)
  })
})

describe('when your audience actually shows up', () => {
  const timed = (day: string, hour: number, views: number): PastVideo =>
    v(`Video ${day} ${hour}`, views, `${day}T${String(hour).padStart(2, '0')}:00:00`)

  it('refuses to name a best time from too few videos', () => {
    const r = publishTimingReport([timed('2026-07-06', 18, 50_000), timed('2026-07-07', 9, 10_000)])
    expect(r.trustworthy).toBe(false)
    expect(r.bestDay).toBeNull()
    expect(r.headline).toMatch(/too few to say/)
  })

  it('names the best day once there is enough, with the sample size', () => {
    // 2026-07-06 is a Monday. Six strong Mondays, six weak Thursdays.
    const history = [
      ...Array.from({ length: 6 }, (_, i) => timed(`2026-07-${String(6 + i * 7).padStart(2, '0')}`, 18, 50_000)),
      ...Array.from({ length: 6 }, (_, i) => timed(`2026-07-${String(2 + i * 7).padStart(2, '0')}`, 9, 8_000))
    ]
    const r = publishTimingReport(history)
    expect(r.trustworthy).toBe(true)
    expect(r.bestDay).toBe('Monday')
    expect(r.headline).toMatch(/median .* views across \d+ videos/)
  })

  it('will not name a best slot that only has one or two videos in it', () => {
    const history = [
      ...Array.from({ length: 10 }, (_, i) => timed(`2026-07-${String(6 + i).padStart(2, '0')}`, 9, 10_000)),
      timed('2026-08-01', 3, 900_000) // one freak result at 3am
    ]
    const r = publishTimingReport(history)
    expect(r.bestHour).not.toBe(3)
  })

  it('handles no videos, and unparseable dates', () => {
    expect(publishTimingReport([]).headline).toMatch(/No published videos/)
    expect(() => publishTimingReport([{ title: 'x', views: 1, publishedAt: 'not a date' }])).not.toThrow()
    expect(publishTimingReport([{ title: 'x', views: 1, publishedAt: 'not a date' }]).byDay).toEqual([])
  })

  it('reads hours the way a person says them', () => {
    expect(formatHour(0)).toBe('12am')
    expect(formatHour(9)).toBe('9am')
    expect(formatHour(12)).toBe('12pm')
    expect(formatHour(18)).toBe('6pm')
    expect(formatHour(25)).toBe('1am')
    expect(formatHour(-1)).toBe('11pm')
  })
})
