/**
 * Stops a long video from sagging in the middle and dying at the end.
 *
 * WHAT ACTUALLY HAPPENS IN A LONG VIDEO
 * Attention does not fall off a cliff, it drains. The pattern is the same on nearly
 * every long-form channel: the opening is tight because it was edited hardest, the
 * middle settles into a rhythm, and the last third gets slower — longer shots, less
 * variety — precisely where the remaining viewers are the ones most worth keeping.
 *
 * The cause is not laziness. It is that shots are given EQUAL time. `secondsPerScene =
 * duration / sceneCount` is the arithmetic the app uses today, and equal time means the
 * back half feels slower than the front half even though the numbers are identical —
 * because the viewer has been watching for fifteen minutes by then.
 *
 * So this deliberately TIGHTENS toward the end. Same total length, same scenes, shots
 * that get shorter as the video goes on. It costs nothing and it is the opposite of
 * what happens by default.
 *
 * A hard ceiling on any single shot matters too. Past about twelve seconds a static
 * visual has been fully read and becomes wallpaper, whatever else is going on.
 */

/** Longest any one shot may run. Past this the picture has been read and is furniture. */
export const MAX_SHOT_SEC = 12

/** Shortest. Below this the viewer registers a change without registering what. */
export const MIN_SHOT_SEC = 2.5

/**
 * How much tighter the end is than the start. 0.7 means the final shots run at 70% of
 * the opening shots' length.
 *
 * Chosen conservatively on purpose. Push this much further and the ending feels
 * panicked rather than urgent, which loses people just as effectively as sagging does.
 */
export const END_TIGHTEN = 0.7

export interface PacedShot {
  index: number
  seconds: number
}

/**
 * Spreads `totalSeconds` across `count` shots, front-loaded so each is a little shorter
 * than the last.
 *
 * The total is preserved EXACTLY. That is not a nicety: the narration is already
 * recorded, so if the shot lengths do not sum to the audio length the picture and the
 * voice drift apart, and by the end of a twenty-minute video they are seconds out.
 */
export function pace(totalSeconds: number, count: number): PacedShot[] {
  const total = Math.max(0, totalSeconds)
  const n = Math.max(0, Math.floor(count))
  if (!n || !total) return []
  if (n === 1) return [{ index: 0, seconds: round3(total) }]

  // Linear ramp from 1.0 down to END_TIGHTEN, then normalised so the weights sum to
  // exactly the total. Normalising is what keeps the audio in sync.
  const weights: number[] = []
  for (let i = 0; i < n; i++) {
    weights.push(1 + (END_TIGHTEN - 1) * (i / (n - 1)))
  }
  const weightSum = weights.reduce((a, b) => a + b, 0)

  const shots: PacedShot[] = weights.map((w, index) => ({
    index,
    seconds: (total * w) / weightSum
  }))

  return enforceLimits(shots, total)
}

/**
 * Applies the floor and ceiling, then gives back the difference so the total is exact.
 *
 * THE CEILING YIELDS RATHER THAN THE TOTAL. A test caught this: 600 seconds over 40
 * shots wants 15s each, which is over the 12s ceiling, and clamping returned 480s —
 * silently making the video two minutes shorter than its own narration. That is the
 * precise audio-desync bug this module exists to prevent, committed by the safety
 * feature meant to prevent it.
 *
 * So when the limits genuinely cannot hold the total, they are exceeded on purpose and
 * the fact is REPORTED. A shot slightly too long is a pacing weakness; a video shorter
 * than its own audio is broken. Never trade the second to protect the first.
 */
export function enforceLimits(shots: PacedShot[], totalSeconds: number): PacedShot[] {
  const out = shots.map((s) => ({ ...s, seconds: clamp(s.seconds, MIN_SHOT_SEC, MAX_SHOT_SEC) }))
  let drift = totalSeconds - out.reduce((n, s) => n + s.seconds, 0)

  // Up to a few passes: each pass can only move shots that are not already at a limit,
  // so one pass is not always enough. Bounded, because a video with more scenes than
  // seconds cannot be satisfied and must not loop forever.
  for (let pass = 0; pass < 8 && Math.abs(drift) > 0.001; pass++) {
    const movable = out.filter((s) =>
      drift > 0 ? s.seconds < MAX_SHOT_SEC - 0.001 : s.seconds > MIN_SHOT_SEC + 0.001
    )
    if (!movable.length) break
    const share = drift / movable.length
    for (const s of movable) {
      const next = clamp(s.seconds + share, MIN_SHOT_SEC, MAX_SHOT_SEC)
      drift -= next - s.seconds
      s.seconds = next
    }
  }

  // Every shot is pinned at a limit and there is still time unaccounted for. The TOTAL
  // wins, always: a video whose pictures do not add up to its own narration is broken,
  // while a shot outside the comfortable range is only a weakness. `report()` says so.
  //
  // Scaled proportionally rather than shifted by an equal share. An equal share needs a
  // floor to stay positive, and that floor then wins and breaks the total all over
  // again: `pace(5, 12)` clamped twelve shots to the 2.5s MINIMUM (30s), tried to remove
  // 25s, hit a 0.1s floor on every shot and returned 1.2s of pictures for a 5-second
  // narration. Scaling cannot do that — the sum is exactly the total by construction,
  // and the tightening survives because every shot shrinks by the same ratio.
  if (Math.abs(drift) > 0.001 && out.length) {
    const current = out.reduce((n, s) => n + s.seconds, 0)
    if (current > 0) {
      const scale = totalSeconds / current
      for (const s of out) s.seconds = s.seconds * scale
    } else {
      const share = totalSeconds / out.length
      for (const s of out) s.seconds = share
    }
  }

  // Rounding to milliseconds is the LAST thing that can break the total, and it does:
  // 0.5s over 200 shots is 0.0025 each, which rounds to 0.003 and sums to 0.6. So the
  // rounding residual is handed back out in whole milliseconds — largest shots first,
  // where a millisecond is least visible — and the sum is exact by construction.
  const rounded = out.map((s) => ({ ...s, seconds: round3(s.seconds) }))
  let steps = Math.round((totalSeconds - rounded.reduce((n, s) => n + s.seconds, 0)) * 1000)
  if (steps !== 0 && rounded.length) {
    const order = rounded.map((s, i) => ({ v: s.seconds, i })).sort((a, b) => b.v - a.v)
    const dir = steps > 0 ? 1 : -1
    for (let k = 0; steps !== 0; k = (k + 1) % order.length) {
      const target = rounded[order[k].i]
      // Never take a shot to zero or below: a zero-length shot is a dropped scene.
      if (dir < 0 && target.seconds <= 0.001) {
        if (rounded.every((r) => r.seconds <= 0.001)) break
        continue
      }
      target.seconds = round3(target.seconds + dir * 0.001)
      steps -= dir
    }
  }
  return rounded
}

export interface PacingReport {
  shots: number
  totalSeconds: number
  firstSeconds: number
  lastSeconds: number
  /** True when the end genuinely runs tighter than the start. */
  tightensToEnd: boolean
  /** Shots that had to sit at the ceiling — a sign of too few scenes for the length. */
  atCeiling: number
  /** Shots forced PAST the ceiling because the total could not otherwise be met. */
  overCeiling: number
  /** Shots forced BELOW the floor for the same reason — too many scenes for the length. */
  underFloor: number
  headline: string
}

export function report(shots: PacedShot[]): PacingReport {
  if (!shots.length) {
    return {
      shots: 0,
      totalSeconds: 0,
      firstSeconds: 0,
      lastSeconds: 0,
      tightensToEnd: false,
      atCeiling: 0,
      overCeiling: 0,
      underFloor: 0,
      headline: 'Nothing to pace.'
    }
  }
  const totalSeconds = round3(shots.reduce((n, s) => n + s.seconds, 0))
  const first = shots[0].seconds
  const last = shots[shots.length - 1].seconds
  const atCeiling = shots.filter((s) => s.seconds >= MAX_SHOT_SEC - 0.001).length
  const overCeiling = shots.filter((s) => s.seconds > MAX_SHOT_SEC + 0.001).length
  const underFloor = shots.filter((s) => s.seconds < MIN_SHOT_SEC - 0.001).length
  const tightensToEnd = last < first - 0.001
  let headline: string
  if (shots.length === 1) headline = 'One shot — nothing to pace.'
  else if (underFloor > shots.length / 2) {
    // The opposite problem, and just as much the user's to fix: too MANY scenes for the
    // length. Said out loud for the same reason — the total was protected instead, so
    // the shots are shorter than a picture can be read in.
    headline =
      `Too many scenes for a ${totalSeconds.toFixed(1)}s video — each one is on screen for about ` +
      `${last.toFixed(1)}s, under the ${MIN_SHOT_SEC}s a viewer needs to take a picture in. ` +
      `Use about ${Math.max(1, Math.floor(totalSeconds / MIN_SHOT_SEC))} scenes instead of ${shots.length}.`
  } else if (overCeiling) {
    // Said plainly, because the fix is the user's: more scenes. The alternative was a
    // video shorter than its own narration, which is why the ceiling was let go.
    headline =
      `Not enough scenes for a ${Math.round(totalSeconds / 60)}-minute video — shots are running ` +
      `${Math.round(last)}s each, past the ${MAX_SHOT_SEC}s where a picture stops holding the eye. ` +
      `Add about ${Math.ceil(totalSeconds / MAX_SHOT_SEC) - shots.length} more scenes.`
  } else if (atCeiling > shots.length / 2) {
    headline =
      `Shots are at the ${MAX_SHOT_SEC}s ceiling — this video has too few scenes for its length, ` +
      `so the picture will sit still. Add scenes to keep it moving.`
  } else if (tightensToEnd) {
    headline = `Paced to tighten: opens on ${first.toFixed(1)}s shots, ends on ${last.toFixed(1)}s — the last third moves fastest, where viewers usually drop.`
  } else {
    headline = `${shots.length} shots, evenly paced.`
  }
  return { shots: shots.length, totalSeconds, firstSeconds: first, lastSeconds: last, tightensToEnd, atCeiling, overCeiling, underFloor, headline }
}

/**
 * Re-times an existing beat list in place, keeping every beat and the total length.
 *
 * Beats already carrying a DELIBERATE duration are left alone — if the writer set a
 * shot to 3 seconds it is because that is what the line needs, and overruling it would
 * be the tool fighting the author.
 */
export function repaceBeats<T extends { durationSec: number; lockedDuration?: boolean }>(
  beats: T[],
  totalSeconds?: number
): T[] {
  if (!beats.length) return beats
  const lockedTotal = beats.filter((b) => b.lockedDuration).reduce((n, b) => n + b.durationSec, 0)
  const free = beats.filter((b) => !b.lockedDuration)
  if (!free.length) return beats

  const total = totalSeconds ?? beats.reduce((n, b) => n + b.durationSec, 0)
  const budget = Math.max(0, total - lockedTotal)
  const paced = pace(budget, free.length)

  let i = 0
  return beats.map((b) => (b.lockedDuration ? b : { ...b, durationSec: paced[i++]?.seconds ?? b.durationSec }))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
