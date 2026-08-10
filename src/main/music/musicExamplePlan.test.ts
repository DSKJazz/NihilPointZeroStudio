/**
 * The music examples must be three genuinely different beds, each with a reason —
 * a list of names with no reasons is the half-answer this app is trying to stop giving.
 */
import { describe, expect, it } from 'vitest'
import { musicExamplePlan } from './mood'

describe('musicExamplePlan', () => {
  it('always offers exactly three distinct moods, each with a why', () => {
    for (const text of ['', 'markets crashed and panic spread with heavy losses', 'munafa aur growth aur acha news']) {
      const plan = musicExamplePlan(text)
      expect(plan).toHaveLength(3)
      expect(new Set(plan.map((p) => p.mood)).size).toBe(3)
      for (const p of plan) expect(p.why.length).toBeGreaterThan(20)
    }
  })

  it('leads with what the script itself points at', () => {
    const plan = musicExamplePlan('crash crisis panic warning losses fall gir gaya nuqsan')
    expect(plan[0].mood).toBe('tense')
    // The script-led pick explains itself from the script; the padding says it is a contrast.
    expect(plan[0].why).not.toMatch(/contrast to compare/)
    expect(plan[2].why).toMatch(/contrast to compare/i)
  })
})
