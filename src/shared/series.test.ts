/**
 * The failure this must never commit is reading a number that is part of the TOPIC as an
 * episode number. "Budget 2026" is not episode 2026; "PSX crosses 78000" is not episode
 * 78000. The output of this module goes into a PUBLISHED description, where a wrong guess
 * links two unrelated videos together and stays there. So the refusal cases come first
 * and there are more of them than the happy path.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_EPISODES,
  groupIntoSeries,
  normaliseSeriesName,
  outOfOrderUploads,
  parseEpisode,
  playlistOrder,
  seriesForTitle,
  seriesHeadline,
  seriesLinks,
  seriesReport,
  type SeriesInput
} from './series'

const v = (id: string, title: string, publishedAt?: string, url?: string): SeriesInput => ({ id, title, publishedAt, url })

describe('never mistaking a topic number for an episode number', () => {
  it('does not read a year as an episode', () => {
    expect(parseEpisode('Budget 2026 explained')).toBeNull()
    expect(parseEpisode('The 2026 budget')).toBeNull()
  })

  it('does not read a market figure as an episode', () => {
    expect(parseEpisode('PSX crosses 78000')).toBeNull()
    expect(parseEpisode('Gold crosses 250,000 per tola')).toBeNull()
    expect(parseEpisode('Reserves at 11')).toBeNull()
    expect(parseEpisode('Inflation hits 38 percent')).toBeNull()
  })

  it('does not read a listicle count as an episode', () => {
    expect(parseEpisode('5 things about the budget')).toBeNull()
    expect(parseEpisode('Top 10 stocks for 2026')).toBeNull()
  })

  it('a bare trailing number is never an episode', () => {
    // The single most tempting shortcut, and the one that invents false series.
    expect(parseEpisode('Reserves Watch 4')).toBeNull()
    expect(parseEpisode('Rupee report 12')).toBeNull()
  })

  it('refuses "3 of 2", which is a sentence and not a marker', () => {
    expect(parseEpisode('Only 3 of 2 targets met')).toBeNull()
  })

  it('refuses "N of M" buried in ordinary finance prose', () => {
    // "N of M" is normal in these titles. A series marker sits at the END of a title; a
    // sentence about banks does not. Without this, "Reserves fell 3 of 5 weeks" became
    // episode 3 of a series called "Reserves fell weeks".
    expect(parseEpisode('Reserves fell 3 of 5 weeks')).toBeNull()
    expect(parseEpisode('2 of 4 banks missed the target')).toBeNull()
    expect(parseEpisode('Only 3 of 5 sectors grew this quarter')).toBeNull()
    // At the end of the title it IS the marker.
    expect(parseEpisode('Budget series 2 of 5')?.episode).toBe(2)
    // And the explicit word makes it unambiguous wherever it sits.
    expect(parseEpisode('Budget Part 2 of 5 — the tax side')?.episode).toBe(2)
  })

  it('refuses a marker that leaves no series name behind', () => {
    // "#4" alone has nothing to group other videos against.
    expect(parseEpisode('#4')).toBeNull()
    expect(parseEpisode('Part 2')).toBeNull()
  })

  it('never invents a series from a single video', () => {
    expect(groupIntoSeries([v('a', 'Reserves Watch #1')])).toEqual([])
    expect(MIN_EPISODES).toBeGreaterThanOrEqual(2)
  })

  it('leaves unnumbered videos out entirely rather than calling them episode 1', () => {
    const series = groupIntoSeries([v('a', 'Why the rupee is falling'), v('b', 'The budget explained')])
    expect(series).toEqual([])
  })
})

describe('reading the markers this channel really uses', () => {
  it('reads a hash number', () => {
    expect(parseEpisode('Reserves Watch #4')).toEqual({ seriesName: 'Reserves Watch', episode: 4 })
    expect(parseEpisode('Reserves Watch # 04')).toEqual({ seriesName: 'Reserves Watch', episode: 4 })
  })

  it('reads Part and Episode in their various spellings', () => {
    expect(parseEpisode('Budget 2026 — Part 2')?.episode).toBe(2)
    expect(parseEpisode('Budget 2026 Part-2')?.episode).toBe(2)
    expect(parseEpisode('Budget 2026 (Episode 3)')?.episode).toBe(3)
    expect(parseEpisode('Budget 2026 Ep 3')?.episode).toBe(3)
    expect(parseEpisode('Budget 2026 Ep. 3')?.episode).toBe(3)
  })

  it('reads the Roman Urdu words for part and instalment', () => {
    // This channel's own vocabulary. Missing these means the feature does nothing for
    // half the back catalogue.
    expect(parseEpisode('Mehngai ki kahani Hissa 2')?.episode).toBe(2)
    expect(parseEpisode('Mehngai ki kahani Qist 3')?.episode).toBe(3)
  })

  it('reads "2 of 5" and keeps the total', () => {
    expect(parseEpisode('Budget series 2 of 5')).toEqual({ seriesName: 'Budget series', episode: 2, total: 5 })
    expect(parseEpisode('Budget series Part 2 of 5')?.total).toBe(5)
  })

  it('reads E03 but needs two digits, so a stray capital E is safe', () => {
    expect(parseEpisode('Reserves Watch E03')?.episode).toBe(3)
    expect(parseEpisode('Reserves Watch E and F')).toBeNull()
  })

  it('reads a deliberate pipe separator at the end', () => {
    expect(parseEpisode('Reserves Watch | 5')?.episode).toBe(5)
    // But not a number after a pipe mid-title, which is usually a subtitle.
    expect(parseEpisode('Reserves Watch | 5 things to know')).toBeNull()
  })

  it('strips the marker cleanly, leaving no dangling punctuation', () => {
    expect(parseEpisode('Reserves Watch — #4')?.seriesName).toBe('Reserves Watch')
    expect(parseEpisode('Reserves Watch (Part 2)')?.seriesName).toBe('Reserves Watch')
    expect(parseEpisode('Reserves Watch: Part 2')?.seriesName).toBe('Reserves Watch')
  })

  it('survives junk', () => {
    expect(parseEpisode('')).toBeNull()
    expect(parseEpisode(undefined as unknown as string)).toBeNull()
    expect(() => groupIntoSeries(undefined as unknown as SeriesInput[])).not.toThrow()
    expect(() => groupIntoSeries([null as unknown as SeriesInput])).not.toThrow()
  })
})

describe('grouping the back catalogue', () => {
  const HISTORY = [
    v('a', 'Reserves Watch #1', '2026-01-01'),
    v('b', 'Reserves Watch #2', '2026-02-01'),
    v('c', 'reserves watch #3', '2026-03-01'),
    v('d', 'Budget 2026 — Part 1', '2026-06-01'),
    v('e', 'Budget 2026 — Part 2', '2026-06-08'),
    v('f', 'Why the rupee is falling', '2026-04-01')
  ]

  it('finds both series and ignores the standalone video', () => {
    const series = groupIntoSeries(HISTORY)
    expect(series).toHaveLength(2)
    expect(series.flatMap((s) => s.episodes.map((e) => e.id))).not.toContain('f')
  })

  it('groups regardless of case and punctuation in the title', () => {
    const reserves = groupIntoSeries(HISTORY).find((s) => /reserves/i.test(s.name))!
    expect(reserves.episodes).toHaveLength(3)
    expect(normaliseSeriesName('Reserves Watch')).toBe(normaliseSeriesName('reserves-watch'))
  })

  it('does NOT group two different series that share a word', () => {
    const series = groupIntoSeries([
      v('a', 'Reserves Watch #1'),
      v('b', 'Reserves Watch #2'),
      v('c', 'Reserves Deep Dive #1'),
      v('d', 'Reserves Deep Dive #2')
    ])
    expect(series).toHaveLength(2)
  })

  it('orders by EPISODE NUMBER, not by upload date', () => {
    // Publishing out of order is normal, and date order is what puts 4 before 3.
    const series = groupIntoSeries([
      v('a', 'Reserves Watch #3', '2026-01-01'),
      v('b', 'Reserves Watch #1', '2026-02-01'),
      v('c', 'Reserves Watch #2', '2026-03-01')
    ])[0]
    expect(series.episodes.map((e) => e.episode)).toEqual([1, 2, 3])
    expect(playlistOrder(series).map((e) => e.episode)).toEqual([1, 2, 3])
  })

  it('spots a missing episode in the middle', () => {
    const series = groupIntoSeries([v('a', 'Watch #1'), v('b', 'Watch #2'), v('c', 'Watch #4')])[0]
    expect(series.gaps).toEqual([3])
    expect(seriesHeadline(series)).toMatch(/missing episode 3/)
  })

  it('spots two videos claiming the same number — a real and common mess', () => {
    const series = groupIntoSeries([v('a', 'Watch #1'), v('b', 'Watch #2'), v('c', 'Watch #2')])[0]
    expect(series.duplicates).toEqual([2])
    expect(seriesHeadline(series)).toMatch(/two videos both numbered 2/)
  })

  it('knows what the next episode number should be', () => {
    const series = groupIntoSeries([v('a', 'Watch #1'), v('b', 'Watch #4')])[0]
    // Highest plus one — not count plus one, which would suggest 3 and collide.
    expect(series.nextEpisode).toBe(5)
  })

  it('puts the biggest series first, where linking pays most', () => {
    const series = groupIntoSeries([
      v('a', 'Small #1'),
      v('b', 'Small #2'),
      v('c', 'Big #1'),
      v('d', 'Big #2'),
      v('e', 'Big #3')
    ])
    expect(series[0].name).toBe('Big')
  })

  it('flags uploads published out of episode order', () => {
    const series = groupIntoSeries([
      v('a', 'Watch #1', '2026-03-01'),
      v('b', 'Watch #2', '2026-01-01'),
      v('c', 'Watch #3', '2026-04-01')
    ])[0]
    expect(outOfOrderUploads(series).map((e) => e.episode)).toEqual([2])
  })
})

describe('the links written into a description', () => {
  const series = groupIntoSeries([
    v('a', 'Reserves Watch #1', '2026-01-01', 'https://youtu.be/aaa'),
    v('b', 'Reserves Watch #2', '2026-02-01', 'https://youtu.be/bbb'),
    v('c', 'Reserves Watch #3', '2026-03-01', 'https://youtu.be/ccc')
  ])[0]

  it('names the previous and next episodes with their real links', () => {
    const links = seriesLinks(series, 2)
    expect(links.description).toContain('Previous: Reserves Watch #1')
    expect(links.description).toContain('https://youtu.be/aaa')
    expect(links.description).toContain('Next: Reserves Watch #3')
    expect(links.description).toContain('https://youtu.be/ccc')
  })

  it('NEVER promises an episode that does not exist yet', () => {
    // "Next: episode 4" under episode 3, before 4 is published, is a link to nothing —
    // and it stays wrong in a published description until someone notices.
    const links = seriesLinks(series, 3)
    expect(links.description).not.toMatch(/Next:/)
    expect(links.pinnedComment).toMatch(/Episode 4 is being made/)
    expect(links.endScreen).toMatch(/coming soon/)
  })

  it('does not tell the viewer to start at the episode they are watching', () => {
    expect(seriesLinks(series, 1).description).not.toMatch(/Start here/)
    expect(seriesLinks(series, 2).description).toMatch(/Start here: Reserves Watch #1/)
  })

  it('lists a linkless episode by title rather than inventing a URL', () => {
    const noUrls = groupIntoSeries([v('a', 'Watch #1'), v('b', 'Watch #2')])[0]
    const links = seriesLinks(noUrls, 1)
    expect(links.description).toContain('Watch #2')
    expect(links.description).not.toMatch(/https?:|undefined|null/)
  })

  it('lists the whole series in order in the pinned comment', () => {
    // The pinned comment is where the next click actually happens.
    const links = seriesLinks(series, 1)
    expect(links.pinnedComment).toMatch(/1\. Reserves Watch #1[\s\S]*2\. Reserves Watch #2[\s\S]*3\. Reserves Watch #3/)
  })

  it('uses the total the titles declared, when they declared one', () => {
    const declared = groupIntoSeries([v('a', 'Budget 1 of 5'), v('b', 'Budget 2 of 5')])[0]
    expect(declared.declaredTotal).toBe(5)
    expect(seriesLinks(declared, 1).description).toContain('episode 1 of 5')
  })

  it('does not claim a total smaller than the episode being written', () => {
    const links = seriesLinks(series, 3)
    expect(links.description).toContain('episode 3 of 3')
    expect(links.description).not.toMatch(/of [12]\b/)
  })
})

describe('matching a new title to an existing series', () => {
  const all = groupIntoSeries([v('a', 'Reserves Watch #1'), v('b', 'Reserves Watch #2')])

  it('finds the series a numbered new title belongs to', () => {
    expect(seriesForTitle('Reserves Watch #3', all)?.name).toBe('Reserves Watch')
  })

  it('finds it from an unnumbered title too, so the number can be suggested', () => {
    expect(seriesForTitle('Reserves Watch', all)?.nextEpisode).toBe(3)
  })

  it('returns nothing for an unrelated title rather than the nearest guess', () => {
    expect(seriesForTitle('Why the rupee is falling', all)).toBeNull()
    expect(seriesForTitle('', all)).toBeNull()
  })
})

describe('what the user is told', () => {
  it('says plainly when nothing is numbered, and what to do about it', () => {
    const r = seriesReport([v('a', 'Why the rupee is falling'), v('b', 'The budget explained')])
    expect(r.series).toEqual([])
    expect(r.headline).toMatch(/None of your 2 videos are numbered/)
    expect(r.headline).toMatch(/Part 2/)
  })

  it('counts the series and the videos in them', () => {
    const r = seriesReport([v('a', 'Watch #1'), v('b', 'Watch #2'), v('c', 'Standalone video')])
    expect(r.headline).toMatch(/1 series across 2 of your 3 videos/)
  })

  it('mentions numbering problems, because they are fixable', () => {
    const r = seriesReport([v('a', 'Watch #1'), v('b', 'Watch #3')])
    expect(r.headline).toMatch(/numbering problem/)
  })

  it('handles having no videos', () => {
    expect(seriesReport([]).headline).toBe('No videos yet.')
    expect(seriesReport(undefined as unknown as SeriesInput[]).headline).toBe('No videos yet.')
  })
})
