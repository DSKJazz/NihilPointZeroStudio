/**
 * Animation bugs are the kind you only see by watching: a line that stops at 98%, a
 * counter that jitters through 11.23847, a chart welded to the top edge so it looks
 * clipped. All three are asserted here frame by frame, without rendering a pixel.
 */
import { describe, expect, it } from 'vitest'
import {
  countUpValue,
  easeInOut,
  easeOut,
  formatCounter,
  lineProgress,
  makePlot,
  progressAtFrame,
  totalFrames,
  visiblePath,
  type AnimationSpec
} from './chartAnimation'

const SPEC: AnimationSpec = { durationSec: 2, fps: 30 }

describe('easing — the difference between animated and cheaply animated', () => {
  it('starts and ends exactly at the ends', () => {
    for (const ease of [easeInOut, easeOut]) {
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
    }
  })

  it('never goes backwards', () => {
    for (const ease of [easeInOut, easeOut]) {
      let last = -1
      for (let t = 0; t <= 1.001; t += 0.02) {
        const v = ease(t)
        expect(v).toBeGreaterThanOrEqual(last - 1e-9)
        last = v
      }
    }
  })

  it('is NOT linear — a constant rate is the visual equivalent of a robot voice', () => {
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(easeInOut(0.75)).toBeGreaterThan(0.75)
  })

  it('ease-out is quick off the mark, which is right for a counting number', () => {
    expect(easeOut(0.25)).toBeGreaterThan(0.25)
  })

  it('clamps nonsense input instead of producing a wild value', () => {
    expect(easeInOut(-5)).toBe(0)
    expect(easeInOut(99)).toBe(1)
  })
})

describe('frame maths — where off-by-one bugs live', () => {
  it('reaches EXACTLY 1 on the final frame', () => {
    // A line stopping at 0.98 leaves the chart permanently, subtly unfinished — and
    // it is invisible in code review.
    expect(progressAtFrame(60, SPEC)).toBe(1)
    expect(progressAtFrame(61, SPEC)).toBe(1)
  })

  it('is exactly 0 before it starts', () => {
    expect(progressAtFrame(0, SPEC)).toBe(0)
    expect(progressAtFrame(0, { ...SPEC, delaySec: 1 })).toBe(0)
    expect(progressAtFrame(30, { ...SPEC, delaySec: 1 })).toBe(0)
  })

  it('honours a delay, so the chart can be cued to a sentence', () => {
    const delayed: AnimationSpec = { durationSec: 2, fps: 30, delaySec: 1 }
    expect(progressAtFrame(45, delayed)).toBeGreaterThan(0)
    expect(progressAtFrame(90, delayed)).toBe(1)
  })

  it('counts the hold, so the eye can rest on the result', () => {
    expect(totalFrames({ durationSec: 2, fps: 30, holdSec: 1 })).toBe(90)
    expect(totalFrames({ durationSec: 2, fps: 30, delaySec: 1, holdSec: 1 })).toBe(120)
  })

  it('never returns zero frames, whatever it is given', () => {
    expect(totalFrames({ durationSec: 0, fps: 0 })).toBeGreaterThanOrEqual(1)
    expect(totalFrames({ durationSec: -5, fps: 30 })).toBeGreaterThanOrEqual(1)
  })
})

describe('the line draws itself smoothly', () => {
  it('ends with every point drawn', () => {
    expect(lineProgress(60, 10, SPEC)).toEqual({ points: 10, partial: 0 })
  })

  it('advances part-way along a segment rather than jumping point to point', () => {
    // Snapping to whole points makes a sparse series advance in visible jerks.
    const seen = new Set<number>()
    for (let f = 0; f <= 60; f++) seen.add(lineProgress(f, 5, SPEC).partial)
    expect(seen.size).toBeGreaterThan(5)
  })

  it('never draws more points than exist', () => {
    for (let f = 0; f <= 120; f++) {
      expect(lineProgress(f, 7, SPEC).points).toBeLessThanOrEqual(7)
    }
  })

  it('handles an empty series without throwing', () => {
    expect(lineProgress(10, 0, SPEC)).toEqual({ points: 0, partial: 0 })
    expect(visiblePath([], 10, SPEC, makePlot([], 800, 400))).toEqual([])
  })

  it('the path only ever grows as the animation runs', () => {
    const values = [1, 3, 2, 5, 4, 6]
    const plot = makePlot(values, 800, 400)
    let last = 0
    for (let f = 0; f <= 60; f += 5) {
      const n = visiblePath(values, f, SPEC, plot).length
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
    expect(visiblePath(values, 60, SPEC, plot)).toHaveLength(values.length)
  })
})

describe('the counting number', () => {
  it('lands exactly on the target', () => {
    expect(countUpValue(60, 0, 11.2, SPEC, 1)).toBe(11.2)
  })

  it('starts exactly at the start', () => {
    expect(countUpValue(0, 279.4, 11.2, SPEC, 1)).toBe(279.4)
  })

  it('never carries more precision than asked for, at ANY frame', () => {
    // A counter flickering through 11.23847 on its way to 11.2 looks like a bug.
    // Asserted numerically, not by string: JS prints 11.0 as "11", so comparing
    // toFixed() against String() tests JS's formatting rather than our rounding.
    for (let f = 0; f <= 60; f++) {
      for (const decimals of [0, 1, 2]) {
        const v = countUpValue(f, 0, 11.2345, SPEC, decimals)
        const scaled = v * 10 ** decimals
        expect(Math.abs(scaled - Math.round(scaled)), `frame ${f} @ ${decimals}dp gave ${v}`).toBeLessThan(1e-9)
      }
    }
  })

  it('and the DISPLAYED figure always shows exactly that many decimals', () => {
    // The numeric value 11 and the on-screen "11.0" are different jobs; a counter
    // that switches between "11" and "11.2" mid-count jitters in width.
    expect(formatCounter(countUpValue(60, 0, 11, SPEC, 1), 1)).toBe('11.0')
    expect(formatCounter(countUpValue(0, 0, 11.2, SPEC, 2), 2)).toBe('0.00')
  })

  it('counts DOWN as happily as up — reserves fall', () => {
    const early = countUpValue(10, 279.4, 11.2, SPEC, 1)
    const late = countUpValue(50, 279.4, 11.2, SPEC, 1)
    expect(early).toBeGreaterThan(late)
    expect(late).toBeGreaterThanOrEqual(11.2)
  })

  it('reads as a person would write it', () => {
    expect(formatCounter(78431.55, 2)).toBe('78,431.55')
    expect(formatCounter(11.2, 1, '$')).toBe('$11.2')
    expect(formatCounter(1000, 0, '', '%')).toBe('1,000%')
    expect(formatCounter(999, 0)).toBe('999')
  })
})

describe('scaling data to pixels', () => {
  const values = [10, 20, 15, 30, 25]
  const plot = makePlot(values, 800, 400)

  it('keeps the highest point clear of the top edge', () => {
    // A line touching the frame edge reads as clipped, as though data is missing.
    expect(plot.y(30)).toBeGreaterThan(24)
    expect(plot.max).toBeGreaterThan(30)
    expect(plot.min).toBeLessThan(10)
  })

  it('puts a bigger value higher up the screen', () => {
    // y grows downward in pixels; getting this backwards flips the whole chart.
    expect(plot.y(30)).toBeLessThan(plot.y(10))
  })

  it('spreads points evenly across the width', () => {
    expect(plot.x(0)).toBeLessThan(plot.x(2))
    expect(plot.x(2)).toBeLessThan(plot.x(4))
    expect(plot.x(4)).toBeLessThanOrEqual(800)
  })

  it('draws a completely flat series as a flat line rather than crashing', () => {
    // Identical values would divide by zero.
    const flat = makePlot([5, 5, 5], 800, 400)
    expect(Number.isFinite(flat.y(5))).toBe(true)
    expect(flat.max).toBeGreaterThan(flat.min)
  })

  it('survives an empty series and non-numeric junk', () => {
    expect(Number.isFinite(makePlot([], 800, 400).y(0))).toBe(true)
    expect(Number.isFinite(makePlot([NaN, 1, 2], 800, 400).y(1))).toBe(true)
  })

  it('clamps a value outside the range instead of drawing off-canvas', () => {
    expect(plot.y(9999)).toBeGreaterThanOrEqual(0)
    expect(plot.y(-9999)).toBeLessThanOrEqual(400)
  })
})
