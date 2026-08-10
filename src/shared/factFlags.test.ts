import { describe, expect, it } from 'vitest'
import { flagUnverifiedClaims } from './factFlags'

describe('flagUnverifiedClaims (the fact-check pass)', () => {
  it('flags currency figures and big-number units', () => {
    const flags = flagUnverifiedClaims('The deal is worth PKR 4,500 and the debt hit 2.3 billion this year.')
    const kinds = flags.map((f) => f.kind)
    expect(kinds).toContain('figure')
    expect(flags.some((f) => f.excerpt.includes('PKR 4,500'))).toBe(true)
    expect(flags.some((f) => f.excerpt.includes('2.3 billion'))).toBe(true)
  })

  it('flags percentages in English, Roman Urdu and Urdu script', () => {
    expect(flagUnverifiedClaims('Inflation reached 38% last month.').some((f) => f.kind === 'percentage')).toBe(true)
    expect(flagUnverifiedClaims('Mehngai 38 fisad tak pohanch gayi.').some((f) => f.kind === 'percentage')).toBe(true)
    expect(flagUnverifiedClaims('مہنگائی 38 فیصد ہو گئی۔').some((f) => f.kind === 'percentage')).toBe(true)
  })

  it('flags years, superlatives and vague attributions', () => {
    const flags = flagUnverifiedClaims(
      'In 2019 the market saw its highest crash ever. Experts say it could repeat. Sab se bara nuqsan tha.'
    )
    const kinds = flags.map((f) => f.kind)
    expect(kinds).toContain('date')
    expect(kinds).toContain('superlative')
    expect(kinds).toContain('attribution')
  })

  it('returns nothing for a claim-free script', () => {
    expect(flagUnverifiedClaims('Aaj hum aik simple guide banayenge. Follow the steps calmly.')).toEqual([])
  })

  it('never explodes on a huge script and caps its output', () => {
    const huge = 'The rate is 12% and experts say it was the highest ever in 2020. '.repeat(500)
    const flags = flagUnverifiedClaims(huge)
    expect(flags.length).toBeLessThanOrEqual(60)
    expect(flags.length).toBeGreaterThan(0)
  })

  it('deduplicates identical claims instead of spamming', () => {
    const flags = flagUnverifiedClaims('38% today. 38% tomorrow. 38% forever.')
    expect(flags.filter((f) => f.kind === 'percentage')).toHaveLength(1)
  })
})
