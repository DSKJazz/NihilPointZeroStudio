/**
 * Makes a chart happen instead of just being there.
 *
 * THE DIFFERENCE
 * A static chart is a slide. The eye takes it in in half a second and then waits. A
 * line that DRAWS ITSELF while you explain it holds the eye for the whole sentence,
 * because the viewer is watching to see where it ends up. Same data, same colours, and
 * it is the single cheapest upgrade in finance video.
 *
 * The same goes for a number: "reserves fell to 11.2 billion" landing as a figure that
 * counts down to 11.2 is worth ten seconds of explanation.
 *
 * WHAT THIS FILE IS
 * The maths only — for any frame, what fraction of the line is drawn and what number
 * is on screen. Pure and frame-exact, so the animation can be tested without rendering
 * a single pixel. The drawing itself is the caller's job.
 *
 * WHY EASING MATTERS MORE THAN IT SOUNDS
 * A line drawn at a perfectly constant rate looks mechanical — it is the visual
 * equivalent of a robot voice. Real motion starts gently, moves, and settles. That is
 * one function, and it is the difference between "animated chart" and "cheap animated
 * chart".
 */

/**
 * Ease-in-out cubic. Starts slow, accelerates, settles — the motion curve almost every
 * piece of polished motion design uses, because it is how physical things move.
 */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Ease-out only: quick off the mark, gentle landing. Right for a counting number. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - x, 3)
}

export interface AnimationSpec {
  /** How long the whole move takes. */
  durationSec: number
  fps: number
  /** Dead time before it starts, so it can be cued to a sentence. */
  delaySec?: number
  /** Time held on the finished state, so the eye can rest on the result. */
  holdSec?: number
}

export function totalFrames(spec: AnimationSpec): number {
  const secs = (spec.delaySec ?? 0) + Math.max(0, spec.durationSec) + (spec.holdSec ?? 0)
  return Math.max(1, Math.round(secs * Math.max(1, spec.fps)))
}

/**
 * Progress at a given frame, 0 to 1, easing applied.
 *
 * Frame-indexed rather than time-indexed on purpose: a renderer works in frames, and
 * converting back and forth is where off-by-one errors creep in and the last frame
 * lands at 0.98 instead of 1 — leaving a chart permanently, subtly unfinished.
 */
export function progressAtFrame(frame: number, spec: AnimationSpec, ease = easeInOut): number {
  const fps = Math.max(1, spec.fps)
  const delayFrames = Math.round((spec.delaySec ?? 0) * fps)
  const moveFrames = Math.max(1, Math.round(Math.max(0, spec.durationSec) * fps))
  if (frame <= delayFrames) return 0
  if (frame >= delayFrames + moveFrames) return 1
  return ease((frame - delayFrames) / moveFrames)
}

/**
 * How much of a line to draw at this frame, as a point count.
 *
 * Returns whole points plus the fraction of the way to the NEXT one, so the line can
 * be drawn part-way along a segment. Snapping to whole points makes the line advance
 * in visible jerks, one data point at a time, which looks broken on a sparse series.
 */
export interface LineProgress {
  /** Complete points to draw. */
  points: number
  /** 0-1 of the way from `points-1` to `points`. */
  partial: number
}

export function lineProgress(frame: number, pointCount: number, spec: AnimationSpec): LineProgress {
  if (pointCount <= 0) return { points: 0, partial: 0 }
  const p = progressAtFrame(frame, spec)
  const exact = p * (pointCount - 1)
  const whole = Math.floor(exact)
  return {
    points: Math.min(pointCount, whole + 1),
    partial: p >= 1 ? 0 : exact - whole
  }
}

/**
 * The number to show at this frame while counting to a target.
 *
 * `decimals` is respected throughout, not just at the end: a counter that shows
 * 11.23847 on the way to 11.2 looks like a bug, and the jitter is distracting.
 */
export function countUpValue(
  frame: number,
  from: number,
  to: number,
  spec: AnimationSpec,
  decimals = 1
): number {
  const p = progressAtFrame(frame, spec, easeOut)
  const raw = from + (to - from) * p
  const factor = 10 ** Math.max(0, Math.min(6, Math.round(decimals)))
  return Math.round(raw * factor) / factor
}

/** Formatted for screen, with thousands separators — a bare 78431.55 is hard to read. */
export function formatCounter(value: number, decimals = 1, prefix = '', suffix = ''): string {
  const fixed = value.toFixed(Math.max(0, Math.min(6, Math.round(decimals))))
  const [whole, frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${prefix}${grouped}${frac ? `.${frac}` : ''}${suffix}`
}

/**
 * Scales data values into pixel coordinates.
 *
 * The y-axis is padded by 8% so the highest point is never welded to the top edge —
 * a line touching the frame edge reads as clipped, as though data is missing.
 */
export interface Plot {
  x: (index: number) => number
  y: (value: number) => number
  min: number
  max: number
}

export function makePlot(
  values: number[],
  width: number,
  height: number,
  padding = { top: 24, right: 24, bottom: 32, left: 56 }
): Plot {
  const finite = values.filter((v) => Number.isFinite(v))
  let min = finite.length ? Math.min(...finite) : 0
  let max = finite.length ? Math.max(...finite) : 1
  if (min === max) {
    // A flat series would divide by zero. Give it a band so it draws as a flat line
    // through the middle rather than vanishing or crashing.
    min -= 1
    max += 1
  }
  const span = max - min
  min -= span * 0.08
  max += span * 0.08

  const innerW = Math.max(1, width - padding.left - padding.right)
  const innerH = Math.max(1, height - padding.top - padding.bottom)
  const lastIndex = Math.max(1, values.length - 1)

  return {
    x: (index: number) => padding.left + (innerW * Math.min(Math.max(index, 0), lastIndex)) / lastIndex,
    y: (value: number) => {
      const clamped = Math.min(Math.max(value, min), max)
      return padding.top + innerH - (innerH * (clamped - min)) / (max - min)
    },
    min,
    max
  }
}

/**
 * The point list to stroke at this frame, including the part-way point on the current
 * segment. This is what makes the line grow smoothly rather than in steps.
 */
export function visiblePath(
  values: number[],
  frame: number,
  spec: AnimationSpec,
  plot: Plot
): { x: number; y: number }[] {
  if (!values.length) return []
  const { points, partial } = lineProgress(frame, values.length, spec)
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < points; i++) out.push({ x: plot.x(i), y: plot.y(values[i]) })
  if (partial > 0 && points < values.length) {
    const a = values[points - 1]
    const b = values[points]
    out.push({
      x: plot.x(points - 1 + partial),
      y: plot.y(a + (b - a) * partial)
    })
  }
  return out
}
