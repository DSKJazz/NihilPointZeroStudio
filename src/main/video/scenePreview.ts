/**
 * Watch ONE scene before committing to the whole render.
 *
 * WHY THIS SAVES MORE THAN IT LOOKS
 * A scene is a still image plus a camera move plus the finishing look, and none of those
 * can be judged from the still. A photo that looks fine flat can turn out to have its
 * subject drift out of frame as the camera pushes in; a grade that suits one picture
 * crushes another. Currently the only way to find out is to render everything — twenty
 * minutes — look at the six seconds you cared about, and start again.
 *
 * WHAT MAKES A PREVIEW WORTH TRUSTING
 * It has to be the SAME treatment, not an approximation. It uses the same layout maths,
 * the same zoompan expression and the same finishing chain the real render uses, so what
 * you see is what the final video does with that scene. A preview built from a separate,
 * simpler path would eventually disagree with the render, and a preview you cannot trust
 * is worse than none — you would stop looking at it and keep rendering blind.
 *
 * WHAT IT DELIBERATELY LEAVES OUT
 * Narration. The audio is the same in the preview as in the final video by definition, and
 * generating it for a six-second look-check would make the preview cost what the render
 * costs. This answers "what will this scene LOOK like", and says so.
 */

import { computeLayout, zoompanExpr, type KenBurnsMotion } from './render'
import { finishingFilters, templateFor, type VideoTemplate } from './templates'

/** Short enough to be near-instant, long enough to see where the move ends up. */
export const PREVIEW_MAX_SECONDS = 6

/** Preview at 720p regardless of the project's resolution — it is for looking, not keeping. */
export const PREVIEW_WIDTH = 1280

export interface ScenePreviewSpec {
  imagePath: string
  outPath: string
  /** Seconds this scene runs in the real video. Clamped, so a 30s scene still previews fast. */
  seconds: number
  motion: KenBurnsMotion
  aspect?: '16:9' | '9:16' | '1:1'
  template?: VideoTemplate
}

/**
 * The ffmpeg arguments for a one-scene preview.
 *
 * ONE input frame, not a looped input. zoompan emits `d` output frames per INPUT frame, so
 * feeding it seconds×fps input frames explodes into seconds×fps×d — the frame-explosion
 * bug already documented in makeSlideshow, which produced 10,000 frames for a 4-second
 * shot. One frame in, `d=frames` out, exactly the intended length.
 */
export function buildScenePreviewArgs(spec: ScenePreviewSpec): string[] {
  const fps = 25
  const seconds = Math.min(PREVIEW_MAX_SECONDS, Math.max(1, Number.isFinite(spec.seconds) ? spec.seconds : 4))
  const frames = Math.max(1, Math.round(seconds * fps))

  // The project's own layout maths, scaled down for speed. Same shape, so the framing the
  // preview shows is the framing the render produces.
  const full = computeLayout('1080p', spec.aspect)
  const scale = PREVIEW_WIDTH / Math.max(full.w, full.h)
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  const w = even(full.w)
  const h = even(full.h)

  const chain = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    'setsar=1',
    zoompanExpr(spec.motion, frames, w, h)
  ]
  // The same finishing look the render applies — the SAME function, not a copy of the
  // numbers — so a grade that ruins this particular picture is visible here rather than
  // after twenty minutes.
  chain.push(...finishingFilters(templateFor(spec.template), w, h))

  return [
    '-y',
    '-i',
    spec.imagePath,
    '-vf',
    chain.join(','),
    '-frames:v',
    String(frames),
    '-c:v',
    'libx264',
    // ultrafast: this file is watched once and thrown away, and waiting on a preview
    // defeats the point of having one.
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-an',
    '-movflags',
    '+faststart',
    spec.outPath
  ]
}

/** How long the preview will actually run, for the UI to say before it renders. */
export function previewSeconds(sceneSeconds: number): number {
  return Math.min(PREVIEW_MAX_SECONDS, Math.max(1, Number.isFinite(sceneSeconds) ? sceneSeconds : 4))
}
