/**
 * This is the module that stands between a typo and a published wrong number on a
 * finance channel. Two failure modes matter, and they pull in opposite directions:
 *
 *   MISSING a wrong figure  — the whole point, obviously.
 *   CRYING WOLF             — just as fatal in practice. Flag forty ordinary numbers
 *                             and the author stops reading the list, at which point
 *                             the tool protects nobody.
 *
 * Both are tested.
 */
import { describe, expect, it } from 'vitest'
import { checkNumbers, figuresFromSeries, isRoundingOf, summarise, type KnownFigure } from './numberCheck'

const KNOWN: KnownFigure[] = [
  { label: 'USD/PKR close, 2026-07-30', value: 279.42 },
  { label: 'SBP reserves', value: 11_200_000_000, unit: 'USD' },
  { label: 'KSE-100 close, 2026-07-30', value: 78_431.55 }
]

const verdictOf = (script: string, known = KNOWN): string =>
  checkNumbers(script, known).filter((c) => c.verdict !== 'ordinary')[0]?.verdict ?? 'none'

describe('catching the number that is not backed', () => {
  it('flags a figure that appears in no imported data', () => {
    const c = checkNumbers('Reserves are now 9.8 billion dollars.', KNOWN)
    const flagged = c.filter((x) => x.verdict === 'unbacked')
    expect(flagged).toHaveLength(1)
    expect(flagged[0].raw).toBe('9.8')
    expect(flagged[0].note).toMatch(/named, dated source/)
  })

  it('says where in the script it is, so the UI can jump to it', () => {
    const script = 'Nothing here yet. Then later the rate hit 412.7 against the dollar.'
    const hit = checkNumbers(script, KNOWN).find((c) => c.raw === '412.7')!
    expect(script.slice(hit.index, hit.index + hit.raw.length)).toBe('412.7')
    expect(hit.excerpt).toContain('412.7')
  })

  it('checks every figure, not just the first', () => {
    const s = summarise(checkNumbers('First 91.3, then 88.6, then 77.2.', KNOWN))
    expect(s.unbacked).toBe(3)
  })
})

describe('recognising the numbers that ARE backed', () => {
  it('matches an exact figure and names the source', () => {
    const hit = checkNumbers('The rupee closed at 279.42.', KNOWN).find((c) => c.raw === '279.42')!
    expect(hit.verdict).toBe('backed')
    expect(hit.note).toContain('USD/PKR close, 2026-07-30')
  })

  it('accepts the author’s own rounding rather than calling it an error', () => {
    // Writing 279.4 when the data says 279.42 is correct practice, not a mistake.
    // Calling it one would train the author to ignore the whole list.
    const hit = checkNumbers('The rupee closed at 279.4.', KNOWN).find((c) => c.raw === '279.4')!
    expect(hit.verdict).toBe('rounded')
    expect(hit.matched?.value).toBe(279.42)
  })

  it('rounds to the precision the SCRIPT used, not a fixed tolerance', () => {
    expect(isRoundingOf('279.4', 279.42)).toBe(true)
    expect(isRoundingOf('279', 279.42)).toBe(true)
    // Two decimals written means two decimals meant — 279.41 is a different number.
    expect(isRoundingOf('279.41', 279.42)).toBe(false)
  })

  it('matches the same figure written in different units', () => {
    // "11.2 billion" against a stored 11,200,000,000.
    expect(verdictOf('Reserves stand at 11.2 billion dollars.')).toBe('rounded')
  })

  it('matches a figure written with thousands separators', () => {
    expect(verdictOf('The index closed at 78,431.55 points.')).toBe('backed')
  })
})

describe('not crying wolf — the failure that makes a checker useless', () => {
  it('ignores small round numbers that are ordinary language', () => {
    const c = checkNumbers('Here are 3 reasons, in 2 minutes, with 5 charts.', KNOWN)
    expect(c.every((x) => x.verdict === 'ordinary')).toBe(true)
    expect(summarise(c).total).toBe(0)
  })

  it('ignores years, which are date claims and handled elsewhere', () => {
    const c = checkNumbers('Back in 2008, and again in 2022, this happened.', KNOWN)
    expect(c.every((x) => x.verdict === 'ordinary')).toBe(true)
  })

  it('does NOT dismiss a decimal just because it is small', () => {
    // "0.9 per cent" is a real claim even though the number is tiny.
    expect(verdictOf('The rupee slid 0.9 per cent this week.')).toBe('unbacked')
  })

  it('does NOT dismiss a large round number', () => {
    expect(verdictOf('Roughly 40,000 investors were affected.')).toBe('unbacked')
  })
})

describe('the summary the user actually reads', () => {
  it('says plainly when everything checks out', () => {
    const s = summarise(checkNumbers('Closed at 279.42, index 78,431.55.', KNOWN))
    expect(s.clean).toBe(true)
    expect(s.headline).toBe('All 2 figures match data you imported.')
  })

  it('leads with the count that needs attention', () => {
    const s = summarise(checkNumbers('Closed at 279.42 but reserves were 9.8 billion.', KNOWN))
    expect(s.clean).toBe(false)
    expect(s.headline).toMatch(/^1 of 2 figures is not in any data you imported/)
  })

  it('gets the singular right — sloppy grammar reads as a sloppy tool', () => {
    expect(summarise(checkNumbers('It was 91.3.', KNOWN)).headline).toMatch(/1 of 1 figure is not/)
  })

  it('says so when there is nothing to check', () => {
    expect(summarise(checkNumbers('No figures at all in this sentence.', KNOWN)).headline).toBe(
      'No figures in this script to check.'
    )
  })

  it('copes with an empty script and with no imported data', () => {
    expect(() => checkNumbers('', [])).not.toThrow()
    expect(summarise(checkNumbers('The rate was 279.42.', [])).unbacked).toBe(1)
  })
})

describe('pulling figures out of imported price data', () => {
  it('takes every field of every bar, labelled with its date', () => {
    const figures = figuresFromSeries('KSE-100', [
      { date: '2026-07-30', open: 78_100.2, high: 78_500, low: 77_900.1, close: 78_431.55, volume: 412_000_000 }
    ])
    expect(figures).toHaveLength(5)
    expect(figures.find((f) => f.value === 78_431.55)?.label).toBe('KSE-100 close, 2026-07-30')
  })

  it('skips missing and non-numeric fields instead of inventing zeroes', () => {
    // A zero that was never in the data would "back" a wrong figure in the script.
    expect(figuresFromSeries('X', [{ date: 'd', close: undefined, open: 1 }])).toHaveLength(1)
    expect(figuresFromSeries('X', [])).toEqual([])
  })

  it('feeds straight into the checker', () => {
    const known = figuresFromSeries('KSE-100', [{ date: '2026-07-30', close: 78_431.55 }])
    expect(verdictOf('The index closed at 78,431.55.', known)).toBe('backed')
  })
})
