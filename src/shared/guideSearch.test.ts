/**
 * The Expert's offline search.
 *
 * The point of these tests is FORGIVENESS. A search that only works when the user
 * types the app's own vocabulary, spelled correctly, in a grammatical sentence, is no
 * use to anybody. So most of what is asserted here is deliberately badly written:
 * typos, no grammar, everyday words instead of the app's words.
 */
import { describe, expect, it } from 'vitest'
import { APP_GUIDE } from './appGuide'
import { buildGuideIndex, editDistance, normalise, queryTerms, searchGuide, stem } from './guideSearch'

const index = buildGuideIndex(APP_GUIDE)

/** The titles of whatever the search thinks answers the question. */
function titlesFor(question: string): string {
  return searchGuide(index, question)
    .map((h) => `${h.section.title}\n${h.section.body}`)
    .join('\n')
    .toLowerCase()
}

describe('the index', () => {
  it('splits the manual into a useful number of sections', () => {
    expect(index.length).toBeGreaterThan(5)
    for (const s of index) {
      expect(s.title.trim()).not.toBe('')
      expect(s.body.trim()).not.toBe('')
    }
  })
})

describe('text handling', () => {
  it('normalises away punctuation, case and emoji', () => {
    expect(normalise('  How do I—  ADD  music?! 🎵 ')).toBe('how do i add music')
  })

  it('stems plurals and -ing/-ed without mangling short words', () => {
    expect(stem('recording')).toBe('record')
    expect(stem('captions')).toBe('caption')
    expect(stem('trimmed')).toBe('trimm')
    expect(stem('cut')).toBe('cut')
    expect(stem('add')).toBe('add')
  })

  it('measures edit distance and gives up quickly beyond the bound', () => {
    expect(editDistance('teleprompter', 'teleprompter')).toBe(0)
    expect(editDistance('telepromter', 'teleprompter')).toBe(1)
    expect(editDistance('musick', 'music')).toBe(1)
    expect(editDistance('cat', 'elephant')).toBeGreaterThan(2)
  })

  it('drops filler words and keeps the meaningful ones', () => {
    const terms = queryTerms('how do I add the music to my video?')
    expect(terms).toContain('music')
    expect(terms).not.toContain('how')
    expect(terms).not.toContain('the')
  })

  it('translates everyday words into the app\'s own vocabulary', () => {
    // The user says "subtitles"; the app says "captions".
    expect(queryTerms('subtitles')).toContain('caption')
    // The user says "merge"; the app says "stitch".
    expect(queryTerms('merge two videos')).toContain('stitch')
    expect(queryTerms('my videos are missing')).toContain('library')
  })
})

describe('answering real, badly-typed questions', () => {
  it('finds music help from a typo-ridden question', () => {
    expect(titlesFor('how i add musick to my vedio')).toContain('music')
  })

  it('finds the recorder when the user says "film myself"', () => {
    expect(titlesFor('film myself with camera')).toMatch(/record|camera|presenter/)
  })

  it('finds captions when the user says subtitles', () => {
    expect(titlesFor('turn on subtitles')).toContain('caption')
  })

  it('finds the storyboard from "shot by shot"', () => {
    expect(titlesFor('plan my video shot by shot')).toMatch(/storyboard|scene/)
  })

  it('finds where work is kept when the user says their videos vanished', () => {
    expect(titlesFor('my videos are gone where did they go')).toMatch(/folder|librari|work|video/)
  })

  it('copes with no grammar at all', () => {
    expect(titlesFor('thumbnail make how')).toContain('thumbnail')
  })

  it('copes with a single word', () => {
    expect(titlesFor('timeline')).toMatch(/timeline|edit/)
  })
})

describe('honesty', () => {
  it('returns nothing rather than a wrong page for an unrelated question', () => {
    expect(searchGuide(index, 'what is the capital of France')).toEqual([])
    expect(searchGuide(index, 'zzzzzz qqqqqq')).toEqual([])
  })

  it('returns nothing for an empty or filler-only question', () => {
    expect(searchGuide(index, '')).toEqual([])
    expect(searchGuide(index, 'how do I')).toEqual([])
    expect(searchGuide(index, '?!  ')).toEqual([])
  })

  it('every answer comes from the manual verbatim — it can never invent a button', () => {
    for (const q of ['add music', 'record my screen', 'make a thumbnail']) {
      for (const hit of searchGuide(index, q)) {
        expect(APP_GUIDE).toContain(hit.section.body)
      }
    }
  })

  it('reports which words it matched, so an answer is accountable', () => {
    const hits = searchGuide(index, 'background music')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].matched.length).toBeGreaterThan(0)
  })

  it('ranks the best answer first', () => {
    const hits = searchGuide(index, 'teleprompter')
    if (hits.length > 1) expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score)
  })
})
