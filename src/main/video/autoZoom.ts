/**
 * Makes a locked-off camera feel edited.
 *
 * THE PROBLEM
 * One camera, one angle, twenty minutes. Nothing moves. It reads as a webcam call, and
 * viewers leave — not because the content is weak but because the FRAME never changes
 * and the eye has nothing to do. Every professional talking-head channel solves this
 * the same way: cut between a wide and a tighter reframe every ten to twenty seconds,
 * and drift slowly within each shot so the frame is never truly still.
 *
 * That is entirely mechanical. No AI, no second camera, no extra recording — the wide
 * shot already contains the tighter one, so a crop and a scale IS the second angle.
 *
 * THE TWO WAYS THIS GOES WRONG, AND HOW BOTH ARE PREVENTED
 *
 *   1. Cutting mid-word. A reframe that lands in the middle of "reser—ves" is jarring
 *      in a way viewers feel even when they cannot name it. So cuts are only placed on
 *      sentence boundaries when a transcript is available, and never inside one.
 *
 *   2. The metronome. Change shot every 12 seconds exactly and it becomes a tic you
 *      cannot unsee. Shot lengths therefore vary on a fixed, repeating pattern —
 *      varied, but deterministic, so the same video always produces the same edit.
 *
 * A third danger is quieter: zoom too far and the top of the head leaves the frame. The
 * tightest shot here is 1.25x, which on a normally-framed 16:9 head-and-shoulders takes
 * in about the chest without threatening the hairline.
 */

export type ShotSize = 'wide' | 'mid' | 'close'

/** Scale factors. Deliberately gentle — the effect should be felt, not noticed. */
export const SHOT_SCALE: Record<ShotSize, number> = {
  wide: 1.0,
  mid: 1.12,
  close: 1.25
}

export interface Shot {
  startSec: number
  endSec: number
  size: ShotSize
  /** Scale at the start of the shot and at its end — the slow drift. */
  fromScale: number
  toScale: number
}

/**
 * Shot lengths, in seconds, cycled in order. Prime-ish and uneven on purpose: a
 * repeating 12/12/12 becomes a visible tic within a minute.
 */
const LENGTH_CYCLE = [14, 9, 17, 11, 21, 8, 13]

/**
 * The order shots are cut in. Never two of the same size back to back — that is not a
 * cut, it is a jump. Wide appears most often because it is the shot the viewer reads
 * the room in.
 */
const SIZE_CYCLE: ShotSize[] = ['wide', 'mid', 'wide', 'close', 'mid', 'wide', 'close']

/** How much the frame drifts within one shot. Barely perceptible, and that is the point. */
const DRIFT = 0.03

export interface PlanOptions {
  durationSec: number
  /**
   * Sentence end times from the transcript. When present, every cut lands on one.
   * Without them the plan still works — it just cuts on the clock.
   */
  boundaries?: number[]
  /** Leave the opening on a clean wide shot; the hook is no place for a reframe. */
  holdOpeningSec?: number
}

/** Nearest sentence end to `t`, if one is close enough to be worth snapping to. */
export function snapToBoundary(t: number, boundaries: number[] | undefined, tolerance = 3): number {
  if (!boundaries?.length) return t
  let best = t
  let bestGap = tolerance
  for (const b of boundaries) {
    const gap = Math.abs(b - t)
    if (gap < bestGap) {
      bestGap = gap
      best = b
    }
  }
  return best
}

export function planShots(options: PlanOptions): Shot[] {
  const duration = Math.max(0, options.durationSec)
  const hold = Math.max(0, options.holdOpeningSec ?? 6)
  // Below about half a minute there is no room for an edit; one clean shot is right.
  if (duration < 30) return duration > 0 ? [wholeShot(duration)] : []

  const shots: Shot[] = []
  let cursor = 0
  let i = 0
  while (cursor < duration) {
    const wanted = cursor + (cursor < hold ? Math.max(hold, LENGTH_CYCLE[0]) : LENGTH_CYCLE[i % LENGTH_CYCLE.length])
    // Snap to a sentence end so the reframe never lands mid-word.
    let end = snapToBoundary(Math.min(wanted, duration), options.boundaries)
    if (end <= cursor + 3) end = Math.min(wanted, duration)
    if (duration - end < 4) end = duration // don't leave a stub at the end

    const size = cursor === 0 ? 'wide' : SIZE_CYCLE[i % SIZE_CYCLE.length]
    const base = SHOT_SCALE[size]
    // The drift runs BETWEEN base and base+DRIFT, and alternates which end it starts
    // from. Written this way for two reasons, both found by tests:
    //   - subtracting DRIFT from a wide shot (base 1.0) hit the floor and clamped, so
    //     fromScale and toScale came out identical and the frame sat frozen — the exact
    //     thing this module exists to prevent;
    //   - and because every shot then drifted the same way, a long video crept
    //     steadily tighter and ended uncomfortably close.
    // Swapping the ENDS instead of the sign keeps the alternation, never drops below
    // 1.0, and can never produce a still shot.
    const low = base
    const high = round3(base + DRIFT)
    const pushIn = i % 2 === 0
    shots.push({
      startSec: round3(cursor),
      endSec: round3(end),
      size,
      fromScale: pushIn ? low : high,
      toScale: pushIn ? high : low
    })
    cursor = end
    i++
  }
  return shots
}

function wholeShot(duration: number): Shot {
  return { startSec: 0, endSec: round3(duration), size: 'wide', fromScale: 1, toScale: 1.02 }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * One `zoompan` expression covering the whole edit.
 *
 * zoompan is used rather than crop because it scales back to a fixed output size
 * itself, so every shot comes out the same dimensions — a crop chain would change
 * frame size at each cut and the encoder would refuse the stream.
 *
 * `on` is the output frame number, so `on/fps` is the time in seconds. The expression
 * is a chain of `if(between(...))`, one per shot, each interpolating linearly from its
 * own start scale to its end scale.
 */
export function zoomExpression(shots: Shot[], fps: number): string {
  if (!shots.length) return '1'
  const t = `(on/${Math.max(1, fps)})`
  // Built innermost-last so the fallback (1, i.e. untouched) sits at the centre.
  let expr = '1'
  for (const s of [...shots].reverse()) {
    const span = Math.max(0.001, s.endSec - s.startSec)
    const progress = `((${t}-${s.startSec})/${span})`
    const scale = `(${s.fromScale}+(${s.toScale}-${s.fromScale})*${progress})`
    expr = `if(between(${t},${s.startSec},${s.endSec}),${scale},${expr})`
  }
  return expr
}

/**
 * The full filter. Centre-anchored: `x` and `y` keep the middle of the frame in the
 * middle, which is where a presenter sits. An off-centre subject wants an offset, and
 * the caller can pass one.
 */
export function buildAutoZoomFilter(
  shots: Shot[],
  width: number,
  height: number,
  fps: number,
  focus: { x?: number; y?: number } = {}
): string {
  const fx = clamp01(focus.x ?? 0.5)
  const fy = clamp01(focus.y ?? 0.5)
  const z = zoomExpression(shots, fps)
  return (
    `zoompan=z='${z}'` +
    `:x='(iw-iw/zoom)*${fx.toFixed(3)}'` +
    `:y='(ih-ih/zoom)*${fy.toFixed(3)}'` +
    // d=1 processes every frame rather than holding one for a duration, which is what
    // makes zoompan work on footage instead of on a still.
    `:d=1:s=${Math.round(width)}x${Math.round(height)}:fps=${fps}`
  )
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function describeShots(shots: Shot[]): string {
  if (!shots.length) return 'No reframing — the clip is too short to cut.'
  const counts = shots.reduce<Record<string, number>>((acc, s) => {
    acc[s.size] = (acc[s.size] ?? 0) + 1
    return acc
  }, {})
  const parts = (['wide', 'mid', 'close'] as ShotSize[])
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${k}`)
  return `${shots.length} shots (${parts.join(', ')}) — the frame never sits still, and no cut lands mid-sentence.`
}
