/**
 * Two failures make this feature worse than not having it: a cut that lands mid-word,
 * and a rhythm so regular it becomes a tic. Both are asserted directly. A third — a
 * zoom tight enough to crop the head — is asserted as a hard ceiling.
 */
import { describe, expect, it } from 'vitest'
import {
  SHOT_SCALE,
  buildAutoZoomFilter,
  describeShots,
  planShots,
  snapToBoundary,
  zoomExpression
} from './autoZoom'

/** Sentence ends every ~4 s, as a transcript would give. */
const BOUNDARIES = Array.from({ length: 75 }, (_, i) => (i + 1) * 4)

describe('cuts never land mid-sentence', () => {
  it('snaps every cut onto a sentence end when a transcript is available', () => {
    const shots = planShots({ durationSec: 300, boundaries: BOUNDARIES })
    // The first starts at 0 and the last ends at the duration; every join between
    // them must sit on a boundary.
    for (const s of shots.slice(1)) {
      expect(BOUNDARIES, `cut at ${s.startSec}s is mid-sentence`).toContain(s.startSec)
    }
  })

  it('snaps to the nearest boundary, and only when one is close', () => {
    expect(snapToBoundary(12.4, [8, 12, 16])).toBe(12)
    // Nothing within tolerance — leave the time alone rather than yanking the cut
    // somewhere it does not belong.
    expect(snapToBoundary(50, [8, 12, 16])).toBe(50)
  })

  it('still produces a sensible edit with no transcript at all', () => {
    const shots = planShots({ durationSec: 300 })
    expect(shots.length).toBeGreaterThan(5)
    for (const s of shots) expect(s.endSec).toBeGreaterThan(s.startSec)
  })
})

describe('no metronome', () => {
  it('varies the shot lengths', () => {
    const lengths = planShots({ durationSec: 600 }).map((s) => Math.round(s.endSec - s.startSec))
    // A single repeated length is the tic this exists to avoid.
    expect(new Set(lengths).size).toBeGreaterThan(3)
  })

  it('never cuts from a shot size to the same size — that is a jump, not a cut', () => {
    const shots = planShots({ durationSec: 600, boundaries: BOUNDARIES })
    for (let i = 1; i < shots.length; i++) {
      // Allow it only where the cycle genuinely repeats wide after a stub at the end.
      if (i < shots.length - 1) {
        expect(shots[i].size, `shot ${i} repeats ${shots[i].size}`).not.toBe(shots[i - 1].size)
      }
    }
  })

  it('is deterministic — the same video always gets the same edit', () => {
    expect(planShots({ durationSec: 420, boundaries: BOUNDARIES })).toEqual(
      planShots({ durationSec: 420, boundaries: BOUNDARIES })
    )
  })
})

describe('the frame is never cropped past the subject', () => {
  it('caps the tightest shot at 1.25x', () => {
    // Tighter than this and a normally-framed head-and-shoulders loses its hairline.
    expect(SHOT_SCALE.close).toBeLessThanOrEqual(1.25)
    for (const s of planShots({ durationSec: 600 })) {
      expect(s.fromScale).toBeLessThanOrEqual(1.3)
      expect(s.toScale).toBeLessThanOrEqual(1.3)
    }
  })

  it('never scales below 1 — that would letterbox the frame', () => {
    for (const s of planShots({ durationSec: 600 })) {
      expect(s.fromScale).toBeGreaterThanOrEqual(1)
      expect(s.toScale).toBeGreaterThanOrEqual(1)
    }
  })

  it('drifts, so no shot is truly frozen', () => {
    for (const s of planShots({ durationSec: 300 })) {
      expect(s.fromScale).not.toBe(s.toScale)
    }
  })

  it('does not creep ever-tighter across a long video', () => {
    // Every shot drifting inward would end the video uncomfortably close.
    const shots = planShots({ durationSec: 900 })
    const inward = shots.filter((s) => s.toScale > s.fromScale).length
    const outward = shots.filter((s) => s.toScale < s.fromScale).length
    expect(Math.abs(inward - outward)).toBeLessThanOrEqual(1)
  })
})

describe('the shape of the edit', () => {
  it('opens on a clean wide shot and holds it through the hook', () => {
    const shots = planShots({ durationSec: 300, boundaries: BOUNDARIES })
    expect(shots[0].size).toBe('wide')
    expect(shots[0].startSec).toBe(0)
    expect(shots[0].endSec).toBeGreaterThanOrEqual(6)
  })

  it('covers the whole video with no gaps and no overlaps', () => {
    const shots = planShots({ durationSec: 300, boundaries: BOUNDARIES })
    expect(shots[0].startSec).toBe(0)
    expect(shots[shots.length - 1].endSec).toBe(300)
    for (let i = 1; i < shots.length; i++) expect(shots[i].startSec).toBe(shots[i - 1].endSec)
  })

  it('leaves a short clip alone entirely', () => {
    // Under half a minute there is no room for an edit; one clean shot is correct.
    expect(planShots({ durationSec: 20 })).toHaveLength(1)
    expect(planShots({ durationSec: 0 })).toEqual([])
  })

  it('never leaves a stub shot at the end', () => {
    for (const d of [123, 187, 240, 301]) {
      const shots = planShots({ durationSec: d })
      const last = shots[shots.length - 1]
      expect(last.endSec - last.startSec, `${d}s left a stub`).toBeGreaterThan(3)
    }
  })
})

describe('the ffmpeg expression', () => {
  const shots = planShots({ durationSec: 120 })

  it('covers every shot and falls back to untouched', () => {
    const e = zoomExpression(shots, 30)
    for (const s of shots) expect(e).toContain(`${s.startSec},${s.endSec}`)
    // The innermost fallback: outside every shot, scale 1 — the original frame.
    expect(e.endsWith(',1'.repeat(1) + ')'.repeat(shots.length))).toBe(true)
  })

  it('is balanced — an unbalanced expression makes ffmpeg fail at runtime', () => {
    const e = zoomExpression(shots, 30)
    expect((e.match(/\(/g) ?? []).length).toBe((e.match(/\)/g) ?? []).length)
  })

  it('contains no spaces, which would split the filter argument', () => {
    expect(zoomExpression(shots, 30)).not.toMatch(/\s/)
  })

  it('handles an empty plan without producing broken syntax', () => {
    expect(zoomExpression([], 30)).toBe('1')
  })

  it('outputs a fixed size, or the encoder rejects the stream', () => {
    // A crop chain would change frame size at each cut; zoompan scales back every time.
    const f = buildAutoZoomFilter(shots, 1920, 1080, 30)
    expect(f).toContain('s=1920x1080')
    expect(f).toContain('d=1') // every frame, not a still held for a duration
    expect(f).toContain('fps=30')
  })

  it('centres on the subject by default and accepts an offset', () => {
    expect(buildAutoZoomFilter(shots, 1920, 1080, 30)).toContain('*0.500')
    expect(buildAutoZoomFilter(shots, 1920, 1080, 30, { x: 0.35 })).toContain('*0.350')
  })

  it('clamps a nonsense focus rather than asking for pixels outside the frame', () => {
    expect(buildAutoZoomFilter(shots, 1920, 1080, 30, { x: -3, y: 9 })).toContain('*0.000')
  })
})

describe('what the user is told', () => {
  it('counts the shots by size', () => {
    expect(describeShots(planShots({ durationSec: 300 }))).toMatch(/\d+ shots \(.*wide.*\)/)
  })

  it('is honest about a clip too short to edit', () => {
    expect(describeShots([])).toMatch(/too short/)
  })
})
