/**
 * The centrepiece is compareVariants, so it is tested hardest. Calling noise a winner is
 * the failure that matters: the user would change every future thumbnail on the strength
 * of a coin flip, and keep doing it because the tool agreed with them.
 *
 * The z-test values below were worked out by hand from the same formula, so they check the
 * arithmetic rather than just the code's own output.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_THUMB_CHARS,
  MIN_IMPRESSIONS,
  compareVariants,
  testPlan,
  variantProblems,
  variantsFor
} from './thumbnailTest'

describe('telling a real difference from noise', () => {
  it('refuses to call a small gap on small numbers a winner', () => {
    // 3.8% vs 4.1% on 10,000 each: z is about 1.1, well inside chance. This is the exact
    // shape of result people act on and should not.
    const c = compareVariants(
      { variantId: 'A', impressions: 10_000, clicks: 380 },
      { variantId: 'B', impressions: 10_000, clicks: 410 }
    )
    expect(c.meaningful).toBe(false)
    expect(c.headline).toMatch(/No real difference/)
    expect(c.headline).toMatch(/coin flip/)
  })

  it('does call a genuinely large difference real', () => {
    // 3% vs 6% on 10,000 each: z is about 9.9. Not chance.
    const c = compareVariants(
      { variantId: 'A', impressions: 10_000, clicks: 300 },
      { variantId: 'B', impressions: 10_000, clicks: 600 }
    )
    expect(c.meaningful).toBe(true)
    expect(c.headline).toMatch(/B really is better/)
    expect(c.headline).toMatch(/outside chance/)
  })

  it('the SAME gap becomes real once there is enough data', () => {
    // This is the whole point of the test: 3.8 vs 4.1 is noise at 10k and real at 500k.
    const small = compareVariants(
      { variantId: 'A', impressions: 10_000, clicks: 380 },
      { variantId: 'B', impressions: 10_000, clicks: 410 }
    )
    const large = compareVariants(
      { variantId: 'A', impressions: 500_000, clicks: 19_000 },
      { variantId: 'B', impressions: 500_000, clicks: 20_500 }
    )
    expect(small.meaningful).toBe(false)
    expect(large.meaningful).toBe(true)
    expect(small.differencePoints).toBeCloseTo(large.differencePoints, 1)
  })

  it('says "leave it running" below the minimum rather than guessing', () => {
    const c = compareVariants(
      { variantId: 'A', impressions: 100, clicks: 10 },
      { variantId: 'B', impressions: 100, clicks: 20 }
    )
    // 10% vs 20% looks enormous. On 100 shows each it is nothing.
    expect(c.meaningful).toBe(false)
    expect(c.headline).toMatch(/Leave it running/)
    expect(MIN_IMPRESSIONS).toBeGreaterThanOrEqual(500)
  })

  it('names the winner correctly when B is worse, not just when it is better', () => {
    const c = compareVariants(
      { variantId: 'A', impressions: 20_000, clicks: 1200 },
      { variantId: 'B', impressions: 20_000, clicks: 600 }
    )
    expect(c.meaningful).toBe(true)
    expect(c.headline).toMatch(/^A really is better/)
  })

  it('is symmetric — swapping the two cannot change whether it is real', () => {
    const a = { variantId: 'A', impressions: 30_000, clicks: 900 }
    const b = { variantId: 'B', impressions: 30_000, clicks: 1200 }
    expect(compareVariants(a, b).meaningful).toBe(compareVariants(b, a).meaningful)
  })

  it('never divides by zero or returns a non-finite rate', () => {
    for (const pair of [
      [{ variantId: 'A', impressions: 0, clicks: 0 }, { variantId: 'B', impressions: 0, clicks: 0 }],
      [{ variantId: 'A', impressions: 1000, clicks: 0 }, { variantId: 'B', impressions: 1000, clicks: 0 }],
      [{ variantId: 'A', impressions: 1000, clicks: 1000 }, { variantId: 'B', impressions: 1000, clicks: 1000 }]
    ] as const) {
      const c = compareVariants(pair[0], pair[1])
      expect(Number.isFinite(c.rateA)).toBe(true)
      expect(Number.isFinite(c.rateB)).toBe(true)
      expect(Number.isFinite(c.differencePoints)).toBe(true)
    }
  })

  it('clamps impossible input rather than reporting a rate above 100%', () => {
    // More clicks than shows is a typo. It must not produce a 500% click-through.
    const c = compareVariants(
      { variantId: 'A', impressions: 1000, clicks: 5000 },
      { variantId: 'B', impressions: 1000, clicks: 50 }
    )
    expect(c.rateA).toBeLessThanOrEqual(1)
    expect(c.a.clicks).toBe(1000)
  })

  it('survives junk', () => {
    expect(() => compareVariants(undefined as never, undefined as never)).not.toThrow()
    const c = compareVariants({ variantId: 'A', impressions: NaN, clicks: NaN } as never, {
      variantId: 'B',
      impressions: -5,
      clicks: -5
    } as never)
    expect(Number.isFinite(c.rateA)).toBe(true)
  })
})

describe('the checks that need no analytics at all', () => {
  it('catches a headline too long to read at thumbnail size', () => {
    const problems = variantProblems('Everything you could ever need to know about the reserves crisis', 'Some title')
    expect(problems.join(' ')).toMatch(/nobody reads it/)
  })

  it('catches too many words, which is a different fault from too many characters', () => {
    expect(variantProblems('one two three four five six', 'x').join(' ')).toMatch(/glanced at, not read/)
  })

  it('catches a headline that just repeats the title', () => {
    // The title sits right beside the thumbnail. Repeating it spends the one line you had.
    const problems = variantProblems('Reserves fall', 'Reserves fall to a record low')
    expect(problems.join(' ')).toMatch(/repeats the title/)
  })

  it('catches shouting', () => {
    expect(variantProblems('EVERYTHING IS COLLAPSING', 'x').join(' ')).toMatch(/shouting/)
    // …but leaves a short all-caps word alone, which is normal design.
    expect(variantProblems('IMF DEAL', 'x').join(' ')).not.toMatch(/shouting/)
  })

  it('passes a good short headline', () => {
    expect(variantProblems('11.2 billion', 'Why the reserves are falling')).toEqual([])
  })

  it('says something useful about an empty headline rather than nothing', () => {
    expect(variantProblems('', 'x').join(' ')).toMatch(/cannot judge the image|nothing here can judge/)
  })
})

describe('the variants', () => {
  const input = {
    title: 'Reserves drop 8 percent: what it means',
    script: 'Import cover is down to 2.1 months. Should you be worried about your savings?'
  }

  it('gives genuinely different angles, not one idea five times', () => {
    const v = variantsFor(input)
    expect(v.length).toBeGreaterThanOrEqual(3)
    expect(new Set(v.map((x) => x.angle)).size).toBe(v.length)
    expect(new Set(v.map((x) => x.headline.toLowerCase())).size).toBe(v.length)
  })

  it('never invents a number — it takes one from the material', () => {
    // A wrong figure on the thumbnail is a wrong figure in the most-seen part of the video.
    const number = variantsFor(input).find((x) => x.angle === 'number')
    expect(number).toBeTruthy()
    expect(`${input.title} ${input.script}`).toContain(number!.headline.replace(/\s+/g, ' '))
  })

  it('takes a question from the material rather than making one up', () => {
    const q = variantsFor(input).find((x) => x.angle === 'question')
    expect(q).toBeTruthy()
    expect(input.script).toContain(q!.headline)
  })

  it('includes a plain control, or there is nothing to compare against', () => {
    expect(variantsFor(input).some((x) => x.angle === 'plain')).toBe(true)
  })

  it('keeps what the user already wrote, so their idea is tested too', () => {
    const v = variantsFor({ ...input, headline: 'MY OWN IDEA' })
    expect(v.some((x) => x.headline === 'MY OWN IDEA')).toBe(true)
  })

  it('flags problems on its own variants rather than only on the user’s', () => {
    const v = variantsFor({ title: 'A very long title that goes on and on and will not fit anywhere at all' })
    const plain = v.find((x) => x.angle === 'plain')!
    expect(plain.headline.length).toBeLessThanOrEqual(MAX_THUMB_CHARS)
  })

  it('survives no title and junk', () => {
    expect(variantsFor({ title: '' })).toEqual([])
    expect(() => variantsFor({ title: undefined as never })).not.toThrow()
    expect(() => variantsFor({ title: 'x', script: undefined })).not.toThrow()
  })
})

describe('the plan, and the trap it exists for', () => {
  it('tells the user to swap BACK, which is what makes the test valid', () => {
    // A video's click-through falls as it ages, so the second thumbnail always fights a
    // colder audience. Without a swap back you are measuring the calendar.
    const p = testPlan({ title: 'Reserves drop 8 percent' })
    expect(p.steps.join(' ')).toMatch(/[Ss]wap BACK/)
    expect(p.warning).toMatch(/measuring the calendar/)
  })

  it('gives the same window to each, and says where the numbers are', () => {
    const p = testPlan({ title: 'Reserves drop 8 percent' })
    expect(p.steps.join(' ')).toMatch(/48 hours/)
    expect(p.steps.join(' ')).toMatch(/YouTube Studio/)
  })
})
