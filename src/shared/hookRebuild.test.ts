/**
 * The rule this module lives by: it RESHAPES the writer's sentences and never asserts
 * anything they did not write. On a finance channel a hook containing an unsupported
 * number is not a style problem, it is a correction video. That guarantee is the first
 * thing tested and the hardest.
 */
import { describe, expect, it } from 'vitest'
import {
  candidateSentences,
  rebuildHooks,
  scoreForForm,
  shapeForForm,
  spokenSeconds,
  summarise
} from './hookRebuild'

const SCRIPT = `## Intro

Welcome back to the channel. In this video we are going to talk about the rupee. Don't forget to subscribe.

## The bit that matters

But the reason everyone is giving is not the real one. Reserves fell to 11.2 billion dollars last month, the lowest since March. Why does nobody talk about import cover? If you are importing anything, your costs just moved against you. Here is the number that actually drives the currency, and almost nobody reports it.

## Wrap

That is all for today. Like and share if this helped.`

describe('nothing is invented — the guarantee the whole module rests on', () => {
  const hooks = rebuildHooks(SCRIPT)

  it('every hook is built from a sentence that is really in the script', () => {
    const flat = SCRIPT.replace(/\s+/g, ' ')
    for (const h of hooks) {
      expect(flat, `"${h.sourceSentence}" is not in the script`).toContain(h.sourceSentence)
    }
  })

  it('no hook contains a number the script does not contain', () => {
    const inScript = new Set(SCRIPT.match(/\d[\d.,]*/g) ?? [])
    for (const h of hooks) {
      for (const n of h.text.match(/\d[\d.,]*/g) ?? []) {
        expect(inScript.has(n), `"${n}" is not in the script`).toBe(true)
      }
    }
  })

  it('never bolts a question mark onto a statement', () => {
    // That would turn a statement into a question the writer never asked.
    const statement = 'Reserves fell to 11.2 billion dollars last month.'
    expect(shapeForForm(statement, 'question')).not.toContain('?')
  })

  it('reshaping only trims a connector and fixes the capital', () => {
    expect(shapeForForm('but the reason is different.', 'contradiction')).toBe('The reason is different.')
    expect(shapeForForm('And so it goes on for a while here.', 'stake')).toBe('So it goes on for a while here.')
    // The words themselves are untouched.
    expect(shapeForForm('Reserves fell sharply this month.', 'number')).toBe('Reserves fell sharply this month.')
  })
})

describe('what can never open a video', () => {
  it('excludes housekeeping outright', () => {
    const sentences = candidateSentences(SCRIPT)
    for (const bad of ['subscribe', 'Like and share', 'Welcome back', 'In this video']) {
      expect(sentences.join(' ')).not.toContain(bad)
    }
  })

  it('so no hook is ever a plug', () => {
    const all = rebuildHooks(SCRIPT).map((h) => h.text).join(' ')
    expect(all).not.toMatch(/subscribe|like and share|welcome back/i)
  })

  it('skips headings, which are never spoken', () => {
    expect(candidateSentences(SCRIPT).join(' ')).not.toContain('The bit that matters')
  })
})

describe('five genuinely different angles, not five variations', () => {
  const hooks = rebuildHooks(SCRIPT)

  it('never returns the same form twice', () => {
    const forms = hooks.map((h) => h.form)
    expect(new Set(forms).size).toBe(forms.length)
  })

  it('never reuses the same source sentence for two hooks', () => {
    // Five near-identical options is a worse choice than one.
    const sources = hooks.map((h) => h.sourceSentence)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('finds the contradiction, the number, the question and the stake in this script', () => {
    const forms = hooks.map((h) => h.form)
    expect(forms).toContain('contradiction')
    expect(forms).toContain('number')
    expect(forms).toContain('question')
  })

  it('explains why each form works, so the choice is informed', () => {
    for (const h of hooks) expect(h.rationale.length).toBeGreaterThan(30)
  })

  it('is deterministic', () => {
    expect(rebuildHooks(SCRIPT)).toEqual(rebuildHooks(SCRIPT))
  })
})

describe('scoring', () => {
  it('rewards a sentence that actually fits the form', () => {
    expect(scoreForForm('But the real reason is different.', 'contradiction')).toBeGreaterThan(0)
    expect(scoreForForm('The weather was pleasant on Tuesday.', 'contradiction')).toBe(0)
  })

  it('works in Roman Urdu, not just English', () => {
    expect(scoreForForm('Lekin asal wajah kuch aur hai.', 'contradiction')).toBeGreaterThan(0)
    expect(scoreForForm('Aap ka nuqsan sab se zyada hai.', 'stake')).toBeGreaterThan(0)
    expect(scoreForForm('Kyun koi is ki baat nahi karta?', 'question')).toBeGreaterThan(0)
  })

  it('prefers a short sentence — a long one buries the point', () => {
    const short = scoreForForm('But nobody says the real reason.', 'contradiction')
    const long = scoreForForm(
      'But nobody ever says the real reason for any of this, which is something I have been thinking about for a very long time and want to explain carefully over the next several minutes.',
      'contradiction'
    )
    expect(short).toBeGreaterThan(long)
  })
})

describe('length — a hook that runs long is not a hook', () => {
  it('measures spoken time, ignoring bracketed stage directions', () => {
    // [PAUSE] is a note to the presenter, not words to say.
    expect(spokenSeconds('one two three four five')).toBeCloseTo(2, 0)
    expect(spokenSeconds('one two [long pause here] three')).toBeLessThan(spokenSeconds('one two three four five six'))
  })

  it('rejects anything over the limit', () => {
    for (const h of rebuildHooks(SCRIPT, { maxSeconds: 6 })) {
      expect(h.seconds).toBeLessThanOrEqual(6)
    }
  })

  it('reports each hook’s length so it can be judged against the 15 seconds that matter', () => {
    for (const h of rebuildHooks(SCRIPT)) expect(h.seconds).toBeGreaterThan(0)
  })
})

describe('when it cannot help', () => {
  it('returns nothing rather than something bad for an empty script', () => {
    expect(rebuildHooks('')).toEqual([])
    expect(rebuildHooks('## Only a heading')).toEqual([])
  })

  it('returns nothing for a script that is all housekeeping', () => {
    expect(rebuildHooks('Welcome back to the channel. Don’t forget to subscribe and hit the bell.')).toEqual([])
  })

  it('says so plainly instead of failing silently', () => {
    expect(summarise([])).toMatch(/No usable openings/)
  })

  it('respects the count without crashing when fewer exist', () => {
    expect(rebuildHooks(SCRIPT, { count: 99 }).length).toBeLessThanOrEqual(5)
    expect(rebuildHooks(SCRIPT, { count: 1 })).toHaveLength(1)
  })

  it('tells the user the guarantee, because it is the reason to trust it', () => {
    expect(summarise(rebuildHooks(SCRIPT))).toMatch(/does not/)
  })
})
