/**
 * The guarantee: every question returned is a real sentence a real person typed, quoted
 * verbatim. That is what makes the output actionable — you can check it. A paraphrase
 * that sounds right but corresponds to no actual comment is the failure this must never
 * commit, so it is the first thing tested.
 *
 * The second concern is bilingual: roughly half of these comments will be Roman Urdu,
 * and Roman Urdu questions frequently carry no question mark at all.
 */
import { describe, expect, it } from 'vitest'
import { isQuestion, mineQuestions, similarity, stem, summarise, topicWords, type RawComment } from './commentMining'

const c = (text: string, likes = 0): RawComment => ({ text, likes })

describe('every returned question is verbatim — never paraphrased', () => {
  const comments = [
    c('Why is import cover falling so fast?'),
    c('Sir why is the import cover dropping?'),
    c('Can you explain import cover please'),
    c('kya import cover ka matlab samjhaye')
  ]

  it('the representative is one of the real comments', () => {
    const texts = comments.map((x) => x.text)
    for (const cluster of mineQuestions(comments, { minCount: 1 })) {
      expect(texts).toContain(cluster.representative)
    }
  })

  it('every example is a real comment too', () => {
    const texts = comments.map((x) => x.text)
    for (const cluster of mineQuestions(comments, { minCount: 1 })) {
      for (const ex of cluster.examples) expect(texts).toContain(ex)
    }
  })

  it('picks the SHORTEST phrasing as the representative — the clearest one', () => {
    const clusters = mineQuestions(
      [c('Why is import cover falling?'), c('Sir I wanted to ask, why exactly is the import cover figure falling so much lately?')],
      { minCount: 1 }
    )
    expect(clusters[0].representative).toBe('Why is import cover falling?')
  })
})

describe('spotting a question', () => {
  it('takes anything with a question mark', () => {
    expect(isQuestion('What about gold?')).toBe(true)
  })

  it('takes Roman Urdu questions with NO question mark', () => {
    // This is the common case in these comments. Relying on "?" would silently throw
    // away half the input.
    expect(isQuestion('kya sona lena chahiye is waqt')).toBe(true)
    expect(isQuestion('kaise calculate karte hain import cover')).toBe(true)
    expect(isQuestion('bhai reserves ka kya hoga')).toBe(true)
  })

  it('takes "chahiye" and "ya nahi", the commonest forms here', () => {
    // A stress pass found two people both asking "should I buy gold right now" in Roman
    // Urdu and the module returning nothing: no question mark, and none of the English
    // or Urdu question WORDS. These two forms carry the question on their own.
    expect(isQuestion('sona lena chahiye is waqt')).toBe(true)
    expect(isQuestion('gold abhi lena chahiye ya nahi')).toBe(true)
    expect(isQuestion('reserves barhenge ya nahin')).toBe(true)
  })

  it('groups two people asking that same question', () => {
    const clusters = mineQuestions(
      [{ text: 'sona lena chahiye is waqt ya nahi' }, { text: 'kya sona lena chahiye abhi' }],
      { minCount: 2 }
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].count).toBe(2)
  })

  it('takes English questions written without punctuation', () => {
    expect(isQuestion('how do you work out import cover')).toBe(true)
  })

  it('rejects praise, which is most comments', () => {
    for (const praise of ['Nice', 'Great video', 'Thanks sir', 'Zabardast', 'Bohat acha', 'First', 'Mashallah']) {
      expect(isQuestion(praise), praise).toBe(false)
    }
  })

  it('rejects things too short to be a question', () => {
    expect(isQuestion('?')).toBe(false)
    expect(isQuestion('')).toBe(false)
    expect(isQuestion('ok?')).toBe(false)
  })

  it('does not choke on undefined or junk', () => {
    expect(isQuestion(undefined as unknown as string)).toBe(false)
    expect(() => mineQuestions([{ text: undefined as unknown as string }])).not.toThrow()
    expect(() => mineQuestions(undefined as unknown as RawComment[])).not.toThrow()
  })
})

describe('grouping the same question asked differently', () => {
  it('groups English and Roman Urdu asking the same thing', () => {
    const clusters = mineQuestions(
      [
        c('Why is import cover falling?'),
        c('Sir import cover kyun gir raha hai'),
        c('Explain import cover please')
      ],
      { minCount: 2 }
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0].count).toBe(3)
  })

  it('does NOT group two genuinely different questions', () => {
    const clusters = mineQuestions(
      [
        c('Why is import cover falling?'),
        c('Why is import cover falling so fast?'),
        c('Should I buy gold now?'),
        c('Is gold a good buy right now?')
      ],
      { minCount: 2 }
    )
    expect(clusters).toHaveLength(2)
    const reps = clusters.map((x) => x.representative.toLowerCase())
    expect(reps.some((r) => r.includes('cover'))).toBe(true)
    expect(reps.some((r) => r.includes('gold'))).toBe(true)
  })

  it('counts one person posting twice as ONE person', () => {
    const clusters = mineQuestions(
      [c('Why is import cover falling?'), c('Why is import cover falling?'), c('why is import cover falling?')],
      { minCount: 1 }
    )
    expect(clusters[0].count).toBe(1)
  })

  it('shows WHICH words grouped them, so the user can disagree', () => {
    const clusters = mineQuestions([c('Why is import cover falling?'), c('import cover kyun gir raha hai')], { minCount: 2 })
    expect(clusters[0].keywords.length).toBeGreaterThan(0)
    expect(clusters[0].keywords.join(' ')).toMatch(/cover|import/)
  })
})

describe('ranking — what to make first', () => {
  it('five people asking beats two heavily-liked comments', () => {
    // Likes on one comment are noisy — thread position, bots, a joke that landed.
    // Distinct people asking is not. Count must win. This failed at the original
    // like-cap of count*20, where 900 likes on a pair outranked five real askers.
    const asked = [
      c('Why is import cover falling?'),
      c('Sir import cover kyun gir raha'),
      c('Explain import cover'),
      c('How is import cover calculated'),
      c('What does import cover mean')
    ]
    const liked = [c('Should I buy gold now?', 500), c('Is gold worth buying?', 400)]
    const clusters = mineQuestions([...asked, ...liked], { minCount: 2 })
    expect(clusters[0].representative.toLowerCase()).toMatch(/import|cover/)
  })

  it('uses likes as a tie-breaker, capped so one comment cannot dominate', () => {
    const a = mineQuestions([c('Why gold up?', 10_000), c('Why is gold up?', 10_000)], { minCount: 2 })
    expect(a[0].likes).toBe(20_000)
    // The cap keeps the score in the same order of magnitude as the count.
    expect(a[0].score).toBeLessThan(200)
  })

  it('ignores anything asked only once by default', () => {
    // One person asking is not a video. Two is a signal.
    expect(mineQuestions([c('Why is import cover falling?')])).toEqual([])
  })

  it('respects the limit', () => {
    const comments = Array.from({ length: 40 }, (_, i) => [c(`Why does topic${i} matter?`), c(`what about topic${i}`)]).flat()
    expect(mineQuestions(comments, { minCount: 2, limit: 5 }).length).toBeLessThanOrEqual(5)
  })

  it('is deterministic', () => {
    const comments = [c('Why gold up?'), c('Why is gold up?'), c('Import cover kya hai'), c('What is import cover')]
    expect(mineQuestions(comments, { minCount: 2 })).toEqual(mineQuestions(comments, { minCount: 2 }))
  })
})

describe('the word matching underneath', () => {
  it('stems just enough to match reserve and reserves', () => {
    expect(stem('reserves')).toBe(stem('reserve'))
    expect(stem('falling')).toBe(stem('fall'))
  })

  it('does not over-stem into nonsense', () => {
    // Aggressive stemming makes unrelated words collide, which merges unrelated
    // questions and destroys the whole signal.
    expect(stem('gold')).not.toBe(stem('golden'))
    expect(stem('is')).toBe('is')
  })

  it('drops filler in both languages', () => {
    const words = topicWords('Sir bhai please kya ye reserves ka matlab hai')
    expect(words).not.toContain('sir')
    expect(words).not.toContain('bhai')
    expect(words).not.toContain('kya')
    expect(words.some((w) => w.startsWith('reserv'))).toBe(true)
  })

  it('a long rambling comment cannot swallow a short one', () => {
    // Jaccard over the union, not just overlap — otherwise any comment containing many
    // words matches everything.
    const short = topicWords('gold price')
    const rambling = topicWords('gold price reserves inflation rupee dollar imf budget tax psx index oil debt')
    expect(similarity(short, rambling)).toBeLessThan(0.34)
  })

  it('similarity is symmetric and bounded', () => {
    const a = topicWords('why is import cover falling')
    const b = topicWords('import cover kyun gir raha hai')
    expect(similarity(a, b)).toBe(similarity(b, a))
    expect(similarity(a, a)).toBe(1)
    expect(similarity(a, [])).toBe(0)
  })
})

describe('what the user is told', () => {
  it('leads with the most-asked question, quoted', () => {
    const s = summarise(mineQuestions([c('Why gold up?'), c('Why is gold up?')], { minCount: 2 }), 200)
    expect(s).toMatch(/most asked, 2 times: "/)
  })

  it('says so honestly when nothing recurred yet', () => {
    expect(summarise([], 150)).toMatch(/nothing was asked more than once/)
  })

  it('handles having no comments at all', () => {
    expect(summarise([], 0)).toBe('No comments to read yet.')
  })
})
