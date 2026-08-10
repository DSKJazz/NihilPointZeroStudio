import { describe, expect, it } from 'vitest'
import { buildCustomSlideshowFilter, KEN_BURNS_MOTIONS, planCustomShots, planSlideshowShots, zoompanExpr } from './render'

describe('planSlideshowShots', () => {
  it('turns few images over a long video into many varied shots (no 3-image ping-pong)', () => {
    const shots = planSlideshowShots(3, 30)
    expect(shots).toHaveLength(5) // ~one shot per 6s
    expect(shots.map((s) => s.imageIndex)).toEqual([0, 1, 2, 0, 1]) // round-robin
    // Consecutive shots use different camera moves.
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].motion).not.toBe(shots[i - 1].motion)
    }
  })

  it('never uses fewer shots than images', () => {
    const shots = planSlideshowShots(3, 6)
    expect(shots.length).toBeGreaterThanOrEqual(3)
  })

  it('gives a single image multiple moving shots', () => {
    const shots = planSlideshowShots(1, 30)
    expect(shots.length).toBeGreaterThan(1)
    expect(shots.every((s) => s.imageIndex === 0)).toBe(true)
    expect(new Set(shots.map((s) => s.motion)).size).toBeGreaterThan(1)
  })

  it('caps the shot count so the filtergraph stays sane', () => {
    expect(planSlideshowShots(2, 600)).toHaveLength(12)
  })

  // Regression: the old min(12, max(imgs, …)) clamp order let the 12-shot cap beat
  // the one-shot-per-image floor, silently discarding every image past the 12th —
  // e.g. 18 of 30 freshly generated AI scene images never appeared in the video.
  it('shows EVERY image even when there are more than 12', () => {
    const shots = planSlideshowShots(30, 1500)
    expect(shots).toHaveLength(30)
    expect(new Set(shots.map((s) => s.imageIndex)).size).toBe(30)
  })

  it('is safe for zero/degenerate inputs', () => {
    expect(planSlideshowShots(0, 0).length).toBeGreaterThanOrEqual(1)
  })
})

describe('planCustomShots (user pacing — Scene Studio "Stays N sec")', () => {
  it('uses EVERY image exactly once, in order — no cap, no round-robin', () => {
    const shots = planCustomShots(Array.from({ length: 20 }, () => ({})), 600)
    expect(shots).toHaveLength(20)
    expect(shots.map((s) => s.imageIndex)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('scales the user seconds so the total exactly matches the narration', () => {
    const shots = planCustomShots([{ seconds: 10 }, { seconds: 30 }], 20)
    const total = shots.reduce((a, s) => a + (s.seconds ?? 0), 0)
    expect(total).toBeCloseTo(20, 5)
    // proportions preserved: 1:3
    expect((shots[1].seconds ?? 0) / (shots[0].seconds ?? 1)).toBeCloseTo(3, 5)
  })

  it('unspecified seconds share the time equally with specified ones', () => {
    const shots = planCustomShots([{ seconds: 5 }, {}], 10)
    expect(shots[0].seconds).toBeCloseTo(5, 5)
    expect(shots[1].seconds).toBeCloseTo(5, 5)
  })

  it('the first shot never gets a transition (nothing to arrive from)', () => {
    const shots = planCustomShots([{ transition: 'fade' }, { transition: 'slideleft' }], 10)
    expect(shots[0].transition).toBeUndefined()
    expect(shots[1].transition).toBe('slideleft')
  })
})

describe('buildCustomSlideshowFilter (xfade chain)', () => {
  const layout = { w: 1280, h: 720 } as never

  it('a single shot needs no xfade', () => {
    const { filter, outLabel } = buildCustomSlideshowFilter(
      [{ imageIndex: 0, motion: 'zoom-in', seconds: 5 }],
      layout
    )
    expect(outLabel).toBe('[s0]')
    expect(filter).not.toContain('xfade')
  })

  it('chains xfades at offsets equal to the accumulated VISIBLE lengths', () => {
    const { filter, outLabel } = buildCustomSlideshowFilter(
      [
        { imageIndex: 0, motion: 'zoom-in', seconds: 4 },
        { imageIndex: 1, motion: 'pan-right', seconds: 6, transition: 'fade' },
        { imageIndex: 2, motion: 'zoom-out', seconds: 5, transition: 'slideleft' }
      ],
      layout
    )
    expect(outLabel).toBe('[vout]')
    expect(filter).toContain('xfade=transition=fade:duration=0.500:offset=4.000')
    expect(filter).toContain('xfade=transition=slideleft:duration=0.500:offset=10.000')
  })

  it("a 'cut' arrives as a 1-frame fade (visually a hard cut)", () => {
    const { filter } = buildCustomSlideshowFilter(
      [
        { imageIndex: 0, motion: 'zoom-in', seconds: 4 },
        { imageIndex: 1, motion: 'pan-left', seconds: 4, transition: 'cut' }
      ],
      layout
    )
    expect(filter).toContain('xfade=transition=fade:duration=0.040:offset=4.000')
  })

  it('clamps a transition so it cannot eat a very short shot', () => {
    const { filter } = buildCustomSlideshowFilter(
      [
        { imageIndex: 0, motion: 'zoom-in', seconds: 1 },
        { imageIndex: 1, motion: 'pan-right', seconds: 1, transition: 'fade' }
      ],
      layout
    )
    // 0.5s wanted, clamp = 0.4 * min(1,1) = 0.4
    expect(filter).toContain('duration=0.400')
  })
})

describe('zoompanExpr', () => {
  it('builds a valid-looking zoompan for each motion with size + fps', () => {
    for (const m of KEN_BURNS_MOTIONS) {
      const expr = zoompanExpr(m, 150, 1920, 1080)
      expect(expr.startsWith('zoompan=')).toBe(true)
      expect(expr).toContain('s=1920x1080')
      expect(expr).toContain('d=150')
      expect(expr).toContain('fps=25')
    }
  })

  it('zoom-in ramps up and zoom-out ramps down', () => {
    expect(zoompanExpr('zoom-in', 150, 1920, 1080)).toContain('min(1.0+0.0015*on,1.5)')
    expect(zoompanExpr('zoom-out', 150, 1920, 1080)).toContain('pzoom-0.0015')
  })

  it('pans move horizontally in opposite directions', () => {
    expect(zoompanExpr('pan-right', 150, 1920, 1080)).toContain(`min(on/150,1)`)
    expect(zoompanExpr('pan-left', 150, 1920, 1080)).toContain(`(1-min(on/150,1))`)
  })
})
