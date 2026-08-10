/**
 * A preview is only worth having if it shows what the RENDER will do. If it drifts, the
 * user stops trusting it and goes back to rendering twenty minutes to check six seconds —
 * so the tests are mostly about the preview using the render's own maths rather than its
 * own approximation of them.
 *
 * The second concern is the frame-explosion bug already documented in makeSlideshow:
 * zoompan emits `d` frames per INPUT frame, so feeding it a looped input produces
 * seconds x fps x d frames. It produced 10,000 frames for a 4-second shot once.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_MAX_SECONDS, buildScenePreviewArgs, previewSeconds } from './scenePreview'
import { computeLayout, zoompanExpr } from './render'
import { finishingFilters, templateFor } from './templates'

const spec = {
  imagePath: 'C:\\pics\\scene1.jpg',
  outPath: 'C:\\tmp\\preview.mp4',
  seconds: 4,
  motion: 'zoom-in' as const
}

describe('it shows what the render will actually do', () => {
  it("uses the render's own zoompan expression, not a lookalike", () => {
    const args = buildScenePreviewArgs(spec).join(' ')
    // Work out the same frame size the preview does, then ask render.ts for the expression.
    const full = computeLayout('1080p', '16:9')
    const scale = 1280 / Math.max(full.w, full.h)
    const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
    expect(args).toContain(zoompanExpr('zoom-in', 100, even(full.w), even(full.h)))
  })

  it("applies the template's real finishing filters", () => {
    // Not a copy of the numbers — the same function the render uses.
    const args = buildScenePreviewArgs({ ...spec, template: 'cinematic' }).join(' ')
    for (const f of finishingFilters(templateFor('cinematic'), 1280, 720)) {
      // Sizes differ per aspect, so check the filter NAMES are all present.
      expect(args).toContain(f.split('=')[0])
    }
    expect(args).toMatch(/vignette/)   // cinematic has one
    expect(args).toMatch(/noise=alls/) // and grain
  })

  it('adds no finishing for the clean template, rather than an empty filter', () => {
    const args = buildScenePreviewArgs({ ...spec, template: 'clean' }).join(' ')
    expect(args).not.toMatch(/vignette|noise=alls|drawbox/)
    expect(args).not.toMatch(/,,|,\s*$/)  // no dangling comma from an empty entry
  })

  it("keeps the project's frame SHAPE for every aspect", () => {
    const wide = buildScenePreviewArgs({ ...spec, aspect: '16:9' }).join(' ')
    const tall = buildScenePreviewArgs({ ...spec, aspect: '9:16' }).join(' ')
    const square = buildScenePreviewArgs({ ...spec, aspect: '1:1' }).join(' ')
    expect(wide).toMatch(/crop=1280:720/)
    expect(tall).toMatch(/crop=720:1280/)
    expect(square).toMatch(/crop=1280:1280/)
  })

  it('always produces EVEN dimensions — h264 rejects odd ones', () => {
    for (const aspect of ['16:9', '9:16', '1:1'] as const) {
      const args = buildScenePreviewArgs({ ...spec, aspect }).join(' ')
      const [, w, h] = /crop=(\d+):(\d+)/.exec(args)!
      expect(Number(w) % 2, `${aspect} width ${w}`).toBe(0)
      expect(Number(h) % 2, `${aspect} height ${h}`).toBe(0)
    }
  })
})

describe('it cannot explode into thousands of frames', () => {
  it('feeds ONE input frame and asks zoompan for the rest', () => {
    // The bug this avoids: a looped input gives zoompan seconds x fps input frames and it
    // emits `d` output frames for each, so a 4-second shot became 10,000 frames.
    const args = buildScenePreviewArgs(spec)
    expect(args).not.toContain('-loop')
    expect(args).not.toContain('-stream_loop')
    expect(args[args.indexOf('-frames:v') + 1]).toBe('100') // 4s x 25fps
    expect(args.join(' ')).toContain('d=100')
  })

  it('caps a long scene so a preview stays a preview', () => {
    const args = buildScenePreviewArgs({ ...spec, seconds: 45 })
    expect(args[args.indexOf('-frames:v') + 1]).toBe(String(PREVIEW_MAX_SECONDS * 25))
    expect(previewSeconds(45)).toBe(PREVIEW_MAX_SECONDS)
  })

  it('never produces zero or a negative length from junk', () => {
    for (const seconds of [0, -5, NaN, Infinity, undefined as never]) {
      const args = buildScenePreviewArgs({ ...spec, seconds })
      const frames = Number(args[args.indexOf('-frames:v') + 1])
      expect(frames, String(seconds)).toBeGreaterThan(0)
      expect(Number.isFinite(frames), String(seconds)).toBe(true)
      expect(previewSeconds(seconds)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('the command itself', () => {
  it('is silent, and says so by dropping audio explicitly', () => {
    // The preview answers "what will this LOOK like". Generating narration for a
    // six-second look-check would make it cost what the render costs.
    expect(buildScenePreviewArgs(spec)).toContain('-an')
  })

  it('encodes as fast as possible — waiting on a preview defeats the point', () => {
    const args = buildScenePreviewArgs(spec)
    expect(args[args.indexOf('-preset') + 1]).toBe('ultrafast')
  })

  it('overwrites, and writes where it was told', () => {
    const args = buildScenePreviewArgs(spec)
    expect(args[0]).toBe('-y')
    expect(args[args.length - 1]).toBe('C:\\tmp\\preview.mp4')
  })

  it('passes a path with spaces straight through — that is an argv job', () => {
    const args = buildScenePreviewArgs({ ...spec, imagePath: 'C:\\My Pics\\a b.jpg' })
    expect(args).toContain('C:\\My Pics\\a b.jpg')
  })

  it('never emits NaN or undefined into a filter', () => {
    for (const seconds of [NaN, Infinity, -1]) {
      expect(buildScenePreviewArgs({ ...spec, seconds }).join(' ')).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('covers every camera move without breaking', () => {
    for (const motion of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const) {
      expect(() => buildScenePreviewArgs({ ...spec, motion })).not.toThrow()
      expect(buildScenePreviewArgs({ ...spec, motion }).join(' ')).toContain('zoompan')
    }
  })
})
