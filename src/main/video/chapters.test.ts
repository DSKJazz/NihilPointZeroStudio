import { describe, expect, it } from 'vitest'
import { buildChapters, formatChapters, splitSections } from './chapters'

const bracketed = `
[Introduction]
Welcome to the show. Today we look at the market and what it means for you right now.
[The problem]
Debt has been climbing for years and nobody wants to talk about the real numbers behind it.
[What to do]
Here is the plan you can follow starting this week without spending anything at all.
[Closing]
Thanks for watching, and remember to think for yourself about all of this.
`

describe('splitSections', () => {
  it('finds the bracketed scene markers', () => {
    expect(splitSections(bracketed).map((s) => s.title)).toEqual([
      'Introduction',
      'The problem',
      'What to do',
      'Closing'
    ])
  })

  // Words before the first marker are still spoken. Leaving them out of the total made
  // every later timestamp land early, because the measured video length still had them.
  it('counts narrated text that appears before the first marker', () => {
    const withIntro = `Hello and welcome to the channel today.\n${bracketed}`
    const out = splitSections(withIntro)
    expect(out[0].title).toBe('Intro')
    expect(out[0].words).toBe(7)
  })

  it('adds no Intro section when the script starts with a marker', () => {
    expect(splitSections(bracketed)[0].title).toBe('Introduction')
  })

  it('falls back to paragraphs when there are no markers', () => {
    expect(splitSections('First para here.\n\nSecond para here.\n\nThird one.').length).toBe(3)
  })

  it('returns nothing for a single blob of text', () => {
    expect(splitSections('just one paragraph with no structure')).toEqual([])
  })

  it('does not count the marker text itself as spoken words', () => {
    const [first] = splitSections('[Intro]\none two three\n[Next]\nfour five')
    expect(first.words).toBe(3)
  })
})

describe('buildChapters', () => {
  it('always starts the first chapter at zero, as YouTube requires', () => {
    expect(buildChapters(bracketed, 600)[0].startSec).toBe(0)
  })

  it('orders chapters forward in time', () => {
    const secs = buildChapters(bracketed, 600).map((c) => c.startSec)
    expect(secs).toEqual([...secs].sort((a, b) => a - b))
  })

  // YouTube ignores a chapter list with fewer than three entries, so emitting one
  // would look like a feature that silently does nothing.
  it('returns nothing when there are too few sections', () => {
    expect(buildChapters('[One]\nhello there\n[Two]\ngoodbye now', 300)).toEqual([])
  })

  it('returns nothing for a zero-length video', () => {
    expect(buildChapters(bracketed, 0)).toEqual([])
  })

  // YouTube also requires each chapter to last at least 10 seconds.
  it('drops chapters closer together than ten seconds', () => {
    const out = buildChapters(bracketed, 12)
    expect(out).toEqual([])
  })

  it('keeps well-spaced chapters for a long video', () => {
    expect(buildChapters(bracketed, 1200).length).toBe(4)
  })

  // YouTube measures the LAST chapter against the end of the video. A final chapter
  // shorter than 10s makes it silently discard the entire list.
  it('drops a final chapter that ends less than ten seconds after it starts', () => {
    const shortEnding = `[One]\n${'word '.repeat(200)}\n[Two]\n${'word '.repeat(200)}\n[Three]\n${'word '.repeat(200)}\n[Four]\nword word`
    for (const c of buildChapters(shortEnding, 300)) {
      expect(300 - c.startSec).toBeGreaterThanOrEqual(10)
    }
  })

  it('still returns a usable list when the ending is long enough', () => {
    expect(buildChapters(bracketed, 1200).every((c) => 1200 - c.startSec >= 10)).toBe(true)
  })
})

describe('formatChapters', () => {
  it('labels the first entry exactly 0:00', () => {
    expect(formatChapters(buildChapters(bracketed, 600)).split('\n')[0]).toMatch(/^0:00 /)
  })

  it('pads seconds to two digits', () => {
    expect(formatChapters([{ startSec: 0, title: 'A' }, { startSec: 65, title: 'B' }])).toContain('1:05 B')
  })

  it('switches to hours for a long video', () => {
    expect(formatChapters([{ startSec: 0, title: 'A' }, { startSec: 3725, title: 'B' }])).toContain('1:02:05 B')
  })

  it('renders nothing when there are no chapters', () => {
    expect(formatChapters([])).toBe('')
  })
})
