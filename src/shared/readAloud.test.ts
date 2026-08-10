/**
 * The failure this must never commit is CRYING WOLF. A finance script is full of numbers
 * and long sentences; a proofreader that flags forty things is a proofreader the user
 * switches off after one use, and then it catches nothing at all forever. So the tests
 * check restraint as hard as they check detection — a clean, ordinary finance paragraph
 * must come back with nothing flagged.
 *
 * The second thing tested hard is sentence splitting, because "11.2 billion" splitting
 * into two sentences would make every number in the script look like a fault.
 */
import { describe, expect, it } from 'vitest'
import {
  BREATH_WORDS,
  DEFAULT_SPEED,
  SPEED_CHOICES,
  UNSAYABLE_WORDS,
  awkwardNumbers,
  formatDuration,
  isMixedLanguage,
  noteAtPlaybackSecond,
  planReadAloud,
  proofread,
  repeatedWords,
  toSpokenSentences,
  tongueTwisters
} from './readAloud'

/** A clean, ordinary paragraph of the kind this channel actually publishes. */
const CLEAN = [
  'Reserves fell to 11.2 billion dollars this week.',
  'That covers about two months of imports.',
  'The State Bank says the drop came from a debt repayment.',
  'Rs. 400 billion was raised at the last auction.'
].join(' ')

describe('not crying wolf on an ordinary finance paragraph', () => {
  it('flags nothing in clean copy', () => {
    // If this ever starts failing, the checks have got greedy and the feature is dead.
    expect(proofread(CLEAN)).toEqual([])
  })

  it('leaves ordinary figures alone', () => {
    expect(awkwardNumbers('Reserves fell to 11.2 billion dollars')).toEqual([])
    expect(awkwardNumbers('It rose 3 percent')).toEqual([])
    expect(awkwardNumbers('Gold crossed 250,000 per tola')).toEqual([])
    expect(awkwardNumbers('The rate is 22%')).toEqual([])
  })

  it('leaves ordinary repeated-looking text alone', () => {
    expect(repeatedWords('The rate that that committee set')).toEqual(['that'])
    expect(repeatedWords('Reserves fell and then fell again')).toEqual([])
  })

  it('does not call ordinary prose a tongue twister', () => {
    expect(tongueTwisters('Reserves fell to eleven billion dollars')).toEqual([])
  })
})

describe('splitting into sentences the way they will be spoken', () => {
  it('does NOT split a decimal — the commonest number in these scripts', () => {
    const s = toSpokenSentences('Reserves fell to 11.2 billion dollars this week.')
    expect(s).toHaveLength(1)
    expect(s[0].text).toContain('11.2')
  })

  it('does not split on Rs. or vs.', () => {
    expect(toSpokenSentences('Rs. 400 billion was raised.')).toHaveLength(1)
    expect(toSpokenSentences('Gold vs. the dollar tells the story.')).toHaveLength(1)
  })

  it('splits on real sentence ends, including the Urdu full stop', () => {
    expect(toSpokenSentences('Reserves fell. Imports rose. Why?')).toHaveLength(3)
    expect(toSpokenSentences('Mehngai barh rahi hai۔ Sood bhi barh raha hai۔')).toHaveLength(2)
  })

  it('drops stage directions — they are not spoken and would inflate every estimate', () => {
    const withDirections = '[PAUSE]\nReserves fell to 11.2 billion.\nThat [beat] is the story.'
    const s = toSpokenSentences(withDirections)
    expect(s.map((x) => x.text).join(' ')).not.toMatch(/PAUSE|beat/)
    expect(s).toHaveLength(2)
  })

  it('timestamps each sentence so a flag can be jumped to', () => {
    const s = toSpokenSentences('One two three four five. Six seven eight nine ten.')
    expect(s[0].startSec).toBe(0)
    expect(s[1].startSec).toBeGreaterThan(0)
    expect(s[1].startSec).toBeCloseTo(s[0].seconds, 5)
  })

  it('survives empty and junk input', () => {
    expect(toSpokenSentences('')).toEqual([])
    expect(toSpokenSentences('   \n\n  ')).toEqual([])
    expect(() => toSpokenSentences(undefined as unknown as string)).not.toThrow()
    expect(toSpokenSentences('[ALL DIRECTIONS]')).toEqual([])
  })
})

describe('catching what the ear catches and the eye does not', () => {
  it('flags a sentence too long for one breath', () => {
    const long = `${Array.from({ length: BREATH_WORDS + 4 }, (_, i) => `word${i}`).join(' ')}.`
    const notes = proofread(long)
    expect(notes.some((n) => n.kind === 'breath')).toBe(true)
    expect(notes.find((n) => n.kind === 'breath')!.note).toContain(String(BREATH_WORDS + 4))
  })

  it('escalates to "split this" rather than "it is long" past the point of no return', () => {
    const huge = `${Array.from({ length: UNSAYABLE_WORDS + 4 }, (_, i) => `word${i}`).join(' ')}.`
    const notes = proofread(huge)
    expect(notes.some((n) => n.kind === 'unsayable')).toBe(true)
    // Not both — one sentence, one verdict about its length.
    expect(notes.filter((n) => n.kind === 'breath')).toEqual([])
    expect(notes.find((n) => n.kind === 'unsayable')!.note).toMatch(/[Ss]plit it/)
  })

  it('flags a word said twice in a row', () => {
    const notes = proofread('The the reserves fell sharply.')
    expect(notes.some((n) => n.kind === 'repeat')).toBe(true)
  })

  it('flags shorthand that cannot be read aloud', () => {
    expect(awkwardNumbers('Reserves fell to 11.2bn')).toContain('11.2bn')
    expect(awkwardNumbers('Gold hit 250k')).toContain('250k')
    expect(proofread('Reserves fell to 11.2bn dollars.').some((n) => n.kind === 'number')).toBe(true)
  })

  it('flags a bare long digit string nobody can read at a glance', () => {
    expect(awkwardNumbers('Gold crossed 250000 per tola')).toContain('250000')
  })

  it('flags ranges and ratios written with symbols', () => {
    expect(awkwardNumbers('Inflation is 11-12%')).toContain('11-12%')
    expect(awkwardNumbers('A ratio of 1:3')).toContain('1:3')
  })

  it('flags a sentence that switches language mid-way', () => {
    // Fine if deliberate — but the offline voice will stumble, so it is worth hearing.
    const notes = proofread('The reserves ka matlab hai that imports are covered.')
    expect(notes.some((n) => n.kind === 'mixed-language')).toBe(true)
  })

  it('does NOT flag a sentence written wholly in Roman Urdu', () => {
    // A whole channel is written this way. Flagging it would be flagging the language.
    const notes = proofread('Mehngai kyun barh rahi hai۔')
    expect(notes.some((n) => n.kind === 'mixed-language')).toBe(false)
  })

  it('needs real evidence before calling a sentence bilingual', () => {
    // "the" is Roman Urdu for "was" AND the most common word in English. Treating it as
    // evidence flagged plain English sentences as bilingual — one false positive a
    // paragraph, which is how a proofreader gets switched off for good.
    expect(isMixedLanguage('The State Bank says the drop came from a debt repayment.')).toBe(false)
    expect(isMixedLanguage('Rs. 400 billion was raised at the last auction.')).toBe(false)
    expect(isMixedLanguage('That is par for the course in this market.')).toBe(false)
    // One unmistakable Urdu content word IS enough.
    expect(isMixedLanguage('The mehngai figure is the one that matters.')).toBe(true)
    // Two weak function words are enough.
    expect(isMixedLanguage('The reserves ka number hai the problem.')).toBe(true)
    // A single weak one is not.
    expect(isMixedLanguage('The sona price is rising.')).toBe(false)
  })

  it('flags three words in a row on the same sound, and only at three', () => {
    expect(tongueTwisters('sood sona sasta hai')).toHaveLength(1)
    expect(tongueTwisters('sood sona barha')).toEqual([])
  })

  it('orders the notes by TIME, so you can listen straight through', () => {
    const script = `${'x '.repeat(BREATH_WORDS + 2)}. Fine here. The the second problem.`
    const notes = proofread(script)
    expect(notes.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].atSecond).toBeGreaterThanOrEqual(notes[i - 1].atSecond)
    }
  })

  it('quotes the sentence verbatim, so the user can see what is meant', () => {
    const notes = proofread('Reserves fell to 11.2bn dollars this week.')
    expect(notes[0].text).toBe('Reserves fell to 11.2bn dollars this week.')
  })
})

describe('the listening plan', () => {
  it('halves the time at 2x and says how much was saved', () => {
    const words = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ') + '.'
    const at1 = planReadAloud(words, 1)
    const at2 = planReadAloud(words, 2)
    expect(at2.listenSeconds).toBeCloseTo(at1.listenSeconds / 2, 1)
    expect(at2.minutesSaved).toBeGreaterThan(0)
    expect(at2.headline).toContain('minutes quicker')
  })

  it('defaults to 2x — worth doing, and nothing is missed', () => {
    expect(DEFAULT_SPEED).toBe(2)
    expect(SPEED_CHOICES).toContain(2)
    expect(planReadAloud(CLEAN).speed).toBe(2)
  })

  it('still tells you to listen when nothing was flagged', () => {
    // The checks are countable things. The ear catches what they cannot, and the plan
    // must not imply the script is fine because a check passed.
    const p = planReadAloud(CLEAN)
    expect(p.notes).toEqual([])
    expect(p.headline).toMatch(/[Ll]isten anyway/)
  })

  it('says so plainly with no script', () => {
    expect(planReadAloud('').headline).toMatch(/Nothing to read yet/)
    expect(planReadAloud('').listenSeconds).toBe(0)
  })

  it('never divides by a zero or negative speed', () => {
    expect(planReadAloud(CLEAN, 0 as never).listenSeconds).toBeGreaterThan(0)
    expect(Number.isFinite(planReadAloud(CLEAN, -2 as never).listenSeconds)).toBe(true)
  })
})

describe('following along while it plays', () => {
  it('maps a playback moment back to the note being heard', () => {
    const script = `Fine sentence here. ${'x '.repeat(BREATH_WORDS + 2)}.`
    const plan = planReadAloud(script, 2)
    const note = plan.notes[0]
    // At double speed the note is heard at half its original timestamp.
    expect(noteAtPlaybackSecond(plan, note.atSecond / 2 + 0.1)).toEqual(note)
  })

  it('returns nothing before the first note is reached', () => {
    const script = `${'Fine words here to fill time. '.repeat(20)}${'x '.repeat(BREATH_WORDS + 2)}.`
    const plan = planReadAloud(script, 2)
    expect(noteAtPlaybackSecond(plan, 0)).toBeNull()
  })

  it('handles a plan with no notes', () => {
    expect(noteAtPlaybackSecond(planReadAloud(CLEAN), 30)).toBeNull()
  })
})

describe('durations read the way a person says them', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(372)).toBe('6m 12s')
    expect(formatDuration(48)).toBe('48s')
    expect(formatDuration(60)).toBe('1m 0s')
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(-5)).toBe('0s')
  })
})
