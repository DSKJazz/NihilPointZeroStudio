/**
 * One bug here would be invisible and ruinous: shot lengths that do not sum to the
 * narration length. The audio is already recorded, so any drift puts picture and voice
 * out of step — a fraction of a second per shot becomes seconds by the end of a
 * twenty-minute video. Every test below checks the total survives.
 */
import { describe, expect, it } from 'vitest'
import { MAX_SHOT_SEC, MIN_SHOT_SEC, enforceLimits, pace, repaceBeats, report } from './pacing'

const total = (shots: { seconds: number }[]): number => shots.reduce((n, s) => n + s.seconds, 0)

describe('the total length is preserved EXACTLY — the sync-drift bug', () => {
  it('sums to the requested total across many shapes', () => {
    for (const [secs, count] of [
      [600, 40],
      [1200, 100],
      [90, 7],
      [300, 25],
      [61, 3],
      [1800, 150]
    ] as [number, number][]) {
      expect(total(pace(secs, count)), `${secs}s over ${count} shots`).toBeCloseTo(secs, 1)
    }
  })

  it('BREAKS the ceiling rather than shorten the video', () => {
    // 600s over 20 shots wants 30s each, way over the 12s ceiling. Clamping returned
    // 240s — a video shorter than its own narration, which is the exact desync bug
    // this module exists to prevent. A shot too long is a pacing weakness; a video
    // shorter than its audio is broken. The ceiling yields.
    const shots = pace(600, 20)
    expect(total(shots)).toBeCloseTo(600, 1)
    const r = report(shots)
    expect(r.overCeiling).toBeGreaterThan(0)
    // And it says so, with the fix: add more scenes.
    expect(r.headline).toMatch(/Not enough scenes|Add about \d+ more scenes/)
  })

  it('says HOW MANY more scenes are needed, not just that something is wrong', () => {
    const r = report(pace(600, 20))
    // 600s / 12s ceiling = 50 scenes needed; 20 exist, so 30 more.
    expect(r.headline).toContain('30 more scenes')
  })

  it('does not loop forever when there are more scenes than seconds', () => {
    // 100 scenes in 10 seconds is nonsense input. It must terminate, keep every scene,
    // and STILL total 10s — an impossible ask does not license desyncing the audio.
    const shots = pace(10, 100)
    expect(shots).toHaveLength(100)
    expect(total(shots)).toBeCloseTo(10, 1)
    for (const s of shots) expect(s.seconds).toBeGreaterThan(0)
  })
})

describe('it tightens toward the end, which is the whole point', () => {
  it('the last shot is shorter than the first', () => {
    // Equal time means the back half FEELS slower even with identical numbers, because
    // the viewer has been watching for fifteen minutes by then.
    const shots = pace(600, 60)
    expect(shots[shots.length - 1].seconds).toBeLessThan(shots[0].seconds)
  })

  it('shortens monotonically, with no shot longer than the one before it', () => {
    const shots = pace(600, 60)
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].seconds).toBeLessThanOrEqual(shots[i - 1].seconds + 0.001)
    }
  })

  it('tightens by roughly the intended amount, not wildly', () => {
    // Overdo this and the ending feels panicked, which loses people just as well as
    // sagging does.
    const shots = pace(600, 60)
    const ratio = shots[shots.length - 1].seconds / shots[0].seconds
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.85)
  })

  it('reports the tightening in words the user can act on', () => {
    const r = report(pace(600, 60))
    expect(r.tightensToEnd).toBe(true)
    expect(r.headline).toMatch(/opens on .*s shots, ends on .*s/)
  })
})

describe('the limits', () => {
  it('respects the ceiling WHENEVER IT CAN', () => {
    // 600s over 60 shots wants 10s each — comfortably inside the 12s ceiling, so the
    // ceiling must hold. It only yields when arithmetic makes it impossible.
    for (const s of pace(600, 60)) expect(s.seconds).toBeLessThanOrEqual(MAX_SHOT_SEC + 0.001)
  })

  it('respects the floor whenever it can', () => {
    // 300s over 60 shots wants 5s each — above the 2.5s floor, so the floor holds.
    for (const s of pace(300, 60)) expect(s.seconds).toBeGreaterThanOrEqual(MIN_SHOT_SEC - 0.001)
  })

  it('breaks the FLOOR too, rather than lengthen the video', () => {
    // 30s over 40 shots is 0.75s each, under the floor. Holding the floor would make a
    // 30-second video 100 seconds long — the same desync bug in the other direction.
    const shots = pace(30, 40)
    expect(total(shots)).toBeCloseTo(30, 1)
  })

  it('redistributes what clamping costs rather than swallowing it', () => {
    const shots = enforceLimits(
      [
        { index: 0, seconds: 40 },
        { index: 1, seconds: 5 },
        { index: 2, seconds: 5 }
      ],
      50
    )
    // 50s across 3 shots cannot fit under a 12s ceiling (36s max), so the ceiling
    // yields and the 50s is preserved — evenly, since all three are pinned.
    expect(total(shots)).toBeCloseTo(50, 1)
    for (const s of shots) expect(s.seconds).toBeGreaterThan(MAX_SHOT_SEC)
  })

  it('warns when a video has too few scenes for its length', () => {
    // The user should be told to add scenes rather than left wondering why the picture
    // sits still. 1200s over 20 shots is 60s a shot — nowhere near the ceiling.
    const r = report(pace(1200, 20))
    expect(r.overCeiling).toBeGreaterThan(0)
    expect(r.headline).toMatch(/Not enough scenes/)
    expect(r.headline).toMatch(/more scenes/)
  })

  it('the warning is the ONLY thing standing between the user and a static video', () => {
    // Silently exceeding the ceiling with no warning would be the worst of both worlds:
    // a video that looks static and no indication why. Assert the report always fires.
    for (const [secs, count] of [[600, 20], [1200, 20], [3600, 30]] as [number, number][]) {
      expect(report(pace(secs, count)).headline, `${secs}s/${count}`).toMatch(/Not enough scenes/)
    }
  })
})

describe('edge cases that would otherwise crash a render', () => {
  it('handles one shot', () => {
    expect(pace(45, 1)).toEqual([{ index: 0, seconds: 45 }])
    expect(report(pace(45, 1)).headline).toMatch(/One shot/)
  })

  it('handles zero and negative input', () => {
    expect(pace(0, 10)).toEqual([])
    expect(pace(600, 0)).toEqual([])
    expect(pace(-100, 10)).toEqual([])
    expect(report([]).headline).toBe('Nothing to pace.')
  })

  it('handles a fractional count without producing a fractional shot', () => {
    expect(pace(60, 4.7)).toHaveLength(4)
  })

  it('is deterministic', () => {
    expect(pace(600, 60)).toEqual(pace(600, 60))
  })
})

describe('re-timing an existing beat list', () => {
  const beats = Array.from({ length: 10 }, () => ({ durationSec: 6 }))

  it('keeps every beat and the total length', () => {
    const out = repaceBeats(beats)
    expect(out).toHaveLength(10)
    expect(total(out.map((b) => ({ seconds: b.durationSec })))).toBeCloseTo(60, 1)
  })

  it('tightens the later beats', () => {
    const out = repaceBeats(beats)
    expect(out[9].durationSec).toBeLessThan(out[0].durationSec)
  })

  it('LEAVES ALONE a beat the writer deliberately timed', () => {
    // If the author set a shot to 3 seconds it is because that is what the line needs.
    // Overruling it is the tool fighting the author.
    const mixed = [
      { durationSec: 3, lockedDuration: true },
      { durationSec: 6 },
      { durationSec: 6 },
      { durationSec: 9, lockedDuration: true }
    ]
    const out = repaceBeats(mixed)
    expect(out[0].durationSec).toBe(3)
    expect(out[3].durationSec).toBe(9)
    expect(total(out.map((b) => ({ seconds: b.durationSec })))).toBeCloseTo(24, 1)
  })

  it('does nothing when every beat is locked, rather than mangling them', () => {
    const locked = [
      { durationSec: 4, lockedDuration: true },
      { durationSec: 8, lockedDuration: true }
    ]
    expect(repaceBeats(locked)).toEqual(locked)
  })

  it('handles an empty list', () => {
    expect(repaceBeats([])).toEqual([])
  })

  it('can re-time to a NEW total, for when narration length changed', () => {
    const out = repaceBeats(beats, 120)
    expect(total(out.map((b) => ({ seconds: b.durationSec })))).toBeCloseTo(120, 1)
  })
})
