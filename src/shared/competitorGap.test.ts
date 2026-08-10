/**
 * The failure this must never commit is calling something a gap when the channel has
 * already covered it. That sends the user to make a video they have already made — the
 * one outcome worse than no suggestion at all, because it costs a whole production.
 *
 * The second is claiming demand from a single competitor video. One upload is somebody
 * else's experiment, not evidence that anyone wants it.
 */
import { describe, expect, it } from 'vitest'
import {
  FINANCE_TOPICS,
  MIN_COMPETITOR_VIDEOS,
  gapReport,
  searchQueries,
  topicsOf,
  type CompetitorVideo,
  type MyVideoTitle
} from './competitorGap'

const them = (title: string, viewCount: number, channelTitle = 'Other Channel'): CompetitorVideo => ({
  title,
  channelTitle,
  viewCount
})

describe('never calling something a gap that is already covered', () => {
  it('a topic this channel has covered is never a gap, however popular elsewhere', () => {
    const mine: MyVideoTitle[] = [{ title: 'Why the reserves are falling' }]
    const theirs = [
      them('Reserves crisis explained', 900_000, 'A'),
      them('Import cover at record low', 800_000, 'B'),
      them('Zakhair kam ho rahe hain', 700_000, 'C')
    ]
    const r = gapReport(mine, theirs)
    expect(r.gaps.map((g) => g.topicId)).not.toContain('reserves')
    expect(r.shared).toContain('Foreign reserves')
  })

  it('matches the topic across BOTH languages', () => {
    // Covering it in Roman Urdu still counts as covering it.
    const mine: MyVideoTitle[] = [{ title: 'Mehngai kyun barh rahi hai' }]
    const theirs = [them('Inflation hits 38 percent', 100_000, 'A'), them('CPI data explained', 90_000, 'B')]
    expect(gapReport(mine, theirs).gaps.map((g) => g.topicId)).not.toContain('inflation')
  })

  it('a single competitor video is never a gap', () => {
    const r = gapReport([{ title: 'Reserves' }], [them('Crypto in Pakistan', 500_000, 'A')])
    expect(r.gaps).toEqual([])
    expect(MIN_COMPETITOR_VIDEOS).toBeGreaterThanOrEqual(2)
  })

  it('cannot call anything a gap with no history of your own to compare against', () => {
    const r = gapReport([], [them('Gold hits a record', 100_000, 'A'), them('Sona mehnga', 90_000, 'B')])
    expect(r.gaps).toEqual([])
    expect(r.headline).toMatch(/none of yours/)
  })
})

describe('finding a real gap', () => {
  const mine: MyVideoTitle[] = [
    { title: 'Why the reserves are falling' },
    { title: 'Rupya kyun gir raha hai' },
    { title: 'The budget explained' }
  ]
  const theirs = [
    them('Gold crosses 250,000 per tola', 400_000, 'A'),
    them('Sona lena chahiye is waqt?', 350_000, 'B'),
    them('Gold price outlook', 300_000, 'C'),
    them('Reserves at a record low', 50_000, 'A'),
    them('Crypto tax in Pakistan', 20_000, 'D'),
    them('Bitcoin for Pakistanis', 18_000, 'E')
  ]

  it('names the topic, with the real videos behind it', () => {
    const r = gapReport(mine, theirs)
    const gold = r.gaps.find((g) => g.topicId === 'gold')!
    expect(gold).toBeTruthy()
    expect(gold.competitorVideos).toBe(3)
    expect(gold.channels.sort()).toEqual(['A', 'B', 'C'])
    // The claim must be checkable: the titles are quoted from the input.
    const inputTitles = theirs.map((t) => t.title)
    for (const ex of gold.examples) expect(inputTitles).toContain(ex.title)
  })

  it('ranks by demonstrated demand, not by count', () => {
    const r = gapReport(mine, theirs)
    // Gold: 3 videos, median 350k. Crypto: 2 videos, median 19k. Gold must lead.
    expect(r.gaps[0].topicId).toBe('gold')
  })

  it('uses the MIDDLE video, so one viral upload cannot fake demand', () => {
    const oneViral = [them('Crypto in Pakistan', 5_000_000, 'A'), them('Bitcoin basics', 1_000, 'B')]
    const r = gapReport(mine, oneViral)
    const crypto = r.gaps.find((g) => g.topicId === 'crypto')!
    // A mean would say 2.5 million. The typical video got 1,000-ish.
    expect(crypto.medianViews).toBeLessThan(100_000)
  })

  it('says in the headline that you have never covered it', () => {
    const gold = gapReport(mine, theirs).gaps.find((g) => g.topicId === 'gold')!
    expect(gold.headline).toMatch(/never covered it/)
    expect(gold.headline).toMatch(/3 videos from 3 other channels/)
  })
})

describe('the opposite, which nobody ever says out loud', () => {
  it('names topics only THIS channel covers', () => {
    const mine: MyVideoTitle[] = [
      { title: 'Remittances hit a record' },
      { title: 'Remittances and the rupee' },
      { title: 'Overseas workers sending more' }
    ]
    const theirs = [them('Gold price today', 10_000, 'A'), them('Sona ka bhao', 9_000, 'B')]
    const r = gapReport(mine, theirs)
    expect(r.onlyMine.map((o) => o.topic)).toContain('Remittances')
    expect(r.onlyMine.find((o) => o.topic === 'Remittances')!.myVideos).toBe(3)
  })

  it('sorts them by how heavily invested you are', () => {
    const mine: MyVideoTitle[] = [
      { title: 'Property prices' },
      { title: 'Wheat support price' },
      { title: 'Wheat and the IMF deal' },
      { title: 'Gandum ki keemat' }
    ]
    const r = gapReport(mine, [them('Gold today', 1, 'A'), them('Sona', 1, 'B')])
    expect(r.onlyMine[0].topic).toBe('Agriculture')
  })
})

describe('topic matching', () => {
  it('matches whole words only', () => {
    // "oil" must not fire on "boiling", "tax" not on "taxonomy".
    expect(topicsOf('A boiling controversy').map((t) => t.id)).not.toContain('oil')
    expect(topicsOf('The taxonomy of markets').map((t) => t.id)).not.toContain('budget')
  })

  it('a title can be about more than one subject', () => {
    const ids = topicsOf('The IMF deal and the rupee').map((t) => t.id)
    expect(ids).toContain('imf')
    expect(ids).toContain('rupee')
  })

  it('reports how many competitor videos matched nothing, rather than hiding them', () => {
    const r = gapReport([{ title: 'Reserves' }], [them('My holiday vlog', 100, 'A'), them('Cooking show', 50, 'B')])
    expect(r.unmatched).toBe(2)
  })

  it('every topic has keywords in both languages where the word differs', () => {
    // A vocabulary that only covers English would miss half this channel's own titles.
    const bilingual = FINANCE_TOPICS.filter((t) =>
      t.keywords.some((k) => /mehngai|zakhair|rupya|sood|bazaar|sona|qarz|tel|bijli|zameen|gandum|bachat|bara-mad|fasal|mehangai|rupaya|zakhaire/i.test(k))
    )
    expect(bilingual.length).toBeGreaterThanOrEqual(10)
  })

  it('survives junk', () => {
    expect(topicsOf('')).toEqual([])
    expect(() => topicsOf(undefined as unknown as string)).not.toThrow()
    expect(() => gapReport(undefined as never, undefined as never)).not.toThrow()
    expect(() => gapReport([null as never], [null as never])).not.toThrow()
    expect(gapReport([], []).headline).toMatch(/No competitor videos/)
  })
})

describe('what to search for', () => {
  it('searches this channel’s own beats first', () => {
    const mine: MyVideoTitle[] = [
      { title: 'Reserves fell again' },
      { title: 'Zakhair kam' },
      { title: 'Gold today' }
    ]
    const q = searchQueries(mine, FINANCE_TOPICS, 4)
    expect(q[0]).toMatch(/Foreign reserves/)
  })

  it('also searches untouched subjects, or a gap could never be found', () => {
    // Searching only what you already cover can only ever confirm coverage.
    const mine: MyVideoTitle[] = [{ title: 'Reserves fell again' }]
    const q = searchQueries(mine, FINANCE_TOPICS, 8)
    expect(q.length).toBe(8)
    expect(q.some((x) => !/reserves/i.test(x))).toBe(true)
  })

  it('handles no history', () => {
    expect(searchQueries([]).length).toBeGreaterThan(0)
    expect(() => searchQueries(undefined as never)).not.toThrow()
  })
})
