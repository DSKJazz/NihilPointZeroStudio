/**
 * THE 493-SHOT INCIDENT, pinned so it can never come back.
 *
 * Seen on the user's screen (2026-08-08): a long Roman-Urdu script of short sentences,
 * a 606-second target, and the direct-from-script planner produced 493 shots of exactly
 * 2 seconds each. The arithmetic failed in two places: the beat count ignored the
 * target entirely (two sentences per beat, however many that made), and the scaler
 * multiplied-rounded-clamped per beat, so the 2s floor pushed the real total to 986s —
 * a "606-second" film that was 63% longer than asked and unwatchable as flashes.
 *
 * The contract now: the target decides how many shots fit (a shot needs ~6s to register
 * and carry narration), and the requested seconds are distributed by largest-remainder,
 * which sums to the target EXACTLY — not approximately, exactly, that is the method's
 * whole point.
 */
import { describe, expect, it } from 'vitest'
import { storyboardFromScript } from './storyboard'

/** A long script of short sentences, like the real one (Roman Urdu, one thought per line). */
function longScript(sentences: number): string {
  const lines: string[] = []
  for (let i = 0; i < sentences; i++) {
    lines.push(`Roz subah market khulti hai aur log screens ke samne baith jate hain number ${i}.`)
  }
  return lines.join('\n')
}

type Beat = { durationSec: number; narration?: string }
const beatsOf = (doc: unknown): Beat[] => (doc as { beats: Beat[] }).beats

describe('the 493-shot incident', () => {
  it('caps the shot count by the target length instead of the sentence count', () => {
    // ~986 sentences → the OLD planner made 493 beats. A 606s film holds ~101 six-second
    // shots; the new planner must not exceed that.
    const doc = storyboardFromScript({ title: 't', brief: longScript(986), totalSeconds: 606 })
    const beats = beatsOf(doc)
    expect(beats.length).toBeLessThanOrEqual(Math.round(606 / 6))
    expect(beats.length).toBeGreaterThan(50)
  })

  it('the durations sum to the requested total EXACTLY — to the second', () => {
    for (const total of [606, 60, 137, 3600]) {
      const doc = storyboardFromScript({ title: 't', brief: longScript(400), totalSeconds: total })
      const sum = beatsOf(doc).reduce((a, b) => a + b.durationSec, 0)
      expect(sum, `target ${total}s`).toBe(total)
    }
  })

  it('no beat collapses to a 2-second flash when a target is set', () => {
    const doc = storyboardFromScript({ title: 't', brief: longScript(986), totalSeconds: 606 })
    for (const b of beatsOf(doc)) expect(b.durationSec).toBeGreaterThanOrEqual(4)
  })

  it('every sentence still ends up narrated — grouping loses nothing', () => {
    const doc = storyboardFromScript({ title: 't', brief: longScript(100), totalSeconds: 120 })
    const narration = beatsOf(doc).map((b) => b.narration ?? '').join(' ')
    for (const n of [0, 50, 99]) expect(narration).toContain(`number ${n}`)
  })

  it('longer narration gets proportionally longer time on screen', () => {
    const brief = [
      'Short line here today.',
      'This is a much longer sentence with many more words that plainly needs far more speaking time than the short one beside it in every reasonable world.'
    ].join('\n')
    const doc = storyboardFromScript({ title: 't', brief, totalSeconds: 60 })
    const beats = beatsOf(doc)
    if (beats.length === 2) {
      expect(beats[1].durationSec).toBeGreaterThan(beats[0].durationSec)
    }
  })

  it('without a target, behaviour stays as it always was: paced by the words themselves', () => {
    const doc = storyboardFromScript({ title: 't', brief: longScript(10) })
    const beats = beatsOf(doc)
    expect(beats.length).toBe(5)
    for (const b of beats) {
      expect(b.durationSec).toBeGreaterThanOrEqual(4)
      expect(b.durationSec).toBeLessThanOrEqual(120)
    }
  })
})
