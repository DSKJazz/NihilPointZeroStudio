/**
 * The rule this module lives or dies by: it REARRANGES the user's words and never
 * invents any. On a finance channel a paraphrased number is a liability, so the tests
 * check provenance as hard as they check formatting.
 */
import { describe, expect, it } from 'vitest'
import {
  chapters,
  communityPost,
  keySentences,
  linkedInPost,
  repurpose,
  sections,
  thread,
  whatsappBroadcast,
  youtubeDescription
} from './repurpose'

const SCRIPT = `## Why the rupee moved this week

The rupee closed at 279.4 against the dollar on Thursday, down from 277.1 a week earlier. That is a slide of just under one per cent in five sessions, and the reason is not the one being reported everywhere.

## What the reserves actually say

State Bank reserves fell to 11.2 billion dollars, the lowest reading since March. Import cover is now under two months, which is the number that actually drives the currency.

## What this means for your money

If you hold dollars you have made money doing nothing this week. If you are planning to import anything, your costs just moved against you and they are unlikely to move back quickly.

## What I would watch next

The next reserves print lands in two weeks. Watch import cover, not the headline number.`

const INPUT = { title: 'Why the rupee slid this week', body: SCRIPT, tags: ['PSX', 'Rupee', 'Pakistan'] }

describe('splitting the script up', () => {
  it('finds the sections from the headings the user already wrote', () => {
    const s = sections(SCRIPT)
    expect(s.map((x) => x.title)).toEqual([
      'Why the rupee moved this week',
      'What the reserves actually say',
      'What this means for your money',
      'What I would watch next'
    ])
  })

  it('treats a script with no headings as one section rather than failing', () => {
    const s = sections('Just one long paragraph with no headings at all in it.')
    expect(s).toHaveLength(1)
    expect(s[0].text).toContain('one long paragraph')
  })

  it('copes with an empty script', () => {
    expect(sections('')).toEqual([])
    expect(() => repurpose({ title: '', body: '' })).not.toThrow()
  })
})

describe('chapters follow YouTube’s rules, or are not emitted at all', () => {
  it('starts at 00:00 — YouTube ignores the whole list otherwise', () => {
    expect(chapters(SCRIPT)[0].at).toBe(0)
  })

  it('produces none rather than a broken list when there are under three', () => {
    // Two chapters is not "nearly right", it is rejected. Better to show none.
    expect(chapters('## One\ntext here\n\n## Two\nmore text')).toEqual([])
  })

  it('keeps at least ten seconds between chapters', () => {
    const c = chapters(SCRIPT)
    for (let i = 1; i < c.length; i++) expect(c[i].at - c[i - 1].at).toBeGreaterThanOrEqual(10)
  })

  it('times them from the narration, so they match the finished video', () => {
    // Section one is ~55 spoken words; at 150 wpm that is ~22 s, so chapter two
    // lands near there rather than at some arbitrary interval.
    const c = chapters(SCRIPT, 150)
    expect(c[1].at).toBeGreaterThan(10)
    expect(c[1].at).toBeLessThan(45)
  })

  it('moves the marks when the speaking pace changes', () => {
    const slow = chapters(SCRIPT, 100)
    const fast = chapters(SCRIPT, 200)
    expect(slow[1].at).toBeGreaterThan(fast[1].at)
  })
})

describe('nothing is invented — every line traces back to the script', () => {
  const pack = repurpose(INPUT)

  it('every thread post after the first is the user’s own sentence', () => {
    for (const post of pack.thread.slice(1)) {
      const sentence = post.split('\n\n')[0].replace(/…$/, '')
      expect(SCRIPT.replace(/\s+/g, ' ')).toContain(sentence.replace(/\s+/g, ' ').slice(0, 60))
    }
  })

  it('does not put a number in the output that is not in the script', () => {
    const inScript = new Set(SCRIPT.match(/\d[\d.,]*/g) ?? [])
    const everything = [
      pack.youtubeDescription,
      pack.communityPost,
      pack.linkedIn,
      pack.whatsapp,
      ...pack.thread
    ].join('\n')
    for (const n of everything.match(/\d[\d.,]*/g) ?? []) {
      // Timestamps and thread counters are generated; every other number must be the
      // user's. This is the check that matters most on a finance channel.
      const isTimestamp = /^\d{1,2}$/.test(n)
      if (!isTimestamp) expect(inScript.has(n), `"${n}" is not in the script`).toBe(true)
    }
  })
})

describe('YouTube description', () => {
  it('opens with the hook, then the chapters', () => {
    const d = youtubeDescription(INPUT)
    expect(d.indexOf('The rupee closed at 279.4')).toBe(0)
    expect(d).toContain('Chapters:')
    expect(d).toContain('0:00 Why the rupee moved this week')
  })

  it('adds the link and hashtags when given, and nothing when not', () => {
    expect(youtubeDescription({ ...INPUT, url: 'https://x.test/v' })).toContain('https://x.test/v')
    expect(youtubeDescription(INPUT)).toContain('#PSX #Rupee #Pakistan')
    expect(youtubeDescription({ title: 't', body: SCRIPT })).not.toContain('#')
  })

  it('strips anything that would break a hashtag', () => {
    expect(youtubeDescription({ ...INPUT, tags: ['PSX 100 Index!', 'rupee-watch'] })).toContain('#PSX100Index #rupeewatch')
  })
})

describe('the thread', () => {
  it('numbers every post, so it does not read as scattered posts', () => {
    const t = thread(INPUT)
    expect(t[0]).toContain(`(1/${t.length})`)
    expect(t[t.length - 1]).toContain(`(${t.length}/${t.length})`)
  })

  it('never exceeds 280 characters — the platform would cut it silently', () => {
    const long = 'x'.repeat(400)
    for (const post of thread({ title: 'T', body: `## A\n${long}. ${long}.` })) {
      expect(post.length).toBeLessThanOrEqual(280)
    }
  })

  it('puts the link on the last post only', () => {
    const t = thread({ ...INPUT, url: 'https://x.test/v' })
    expect(t[t.length - 1]).toContain('https://x.test/v')
    expect(t.slice(0, -1).join('\n')).not.toContain('https://x.test/v')
  })

  it('still returns something for a script it cannot break up', () => {
    expect(thread({ title: 'Just a title', body: '' })).toEqual(['Just a title'])
  })
})

describe('the shorter formats', () => {
  it('the community post ends on a question', () => {
    expect(communityPost(INPUT).trimEnd().endsWith('?')).toBe(true)
  })

  it('WhatsApp is the shortest, and uses WhatsApp’s own bold markup', () => {
    const w = whatsappBroadcast(INPUT)
    expect(w.startsWith('*Why the rupee slid this week*')).toBe(true)
    expect(w.length).toBeLessThan(communityPost(INPUT).length)
    expect(w.length).toBeLessThan(400)
  })

  it('LinkedIn uses bullets, because nobody reads a wall there', () => {
    expect(linkedInPost(INPUT).split('•').length - 1).toBeGreaterThanOrEqual(2)
  })
})

describe('key sentences', () => {
  it('skips fragments too short to stand alone', () => {
    const s = keySentences('## A\nRight. So. Yes. This one is a genuinely complete thought worth posting on its own.', 5)
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('genuinely complete thought')
  })

  it('respects the limit', () => {
    expect(keySentences(SCRIPT, 2)).toHaveLength(2)
  })
})
