/**
 * Speeding up spoken audio without turning it into a chipmunk.
 *
 * THE TWO WAYS TO DO THIS, AND WHY ONLY ONE IS USABLE
 * The obvious way is to play the samples faster (`asetrate`). That raises the pitch with
 * the speed, and at 2× a human voice becomes a cartoon — unintelligible for proofreading,
 * which is the entire point. `atempo` stretches time while HOLDING the pitch, so a voice
 * at 2× still sounds like the same person talking quickly.
 *
 * THE LIMIT, MEASURED RATHER THAN ASSUMED
 * `atempo` is widely documented as accepting 0.5–2.0, and older ffmpeg builds enforced
 * exactly that. The bundled binary was probed directly instead of trusting it:
 *
 *   ffmpeg 7.0.2-static:  tempo <double> (from 0.5 to 100)
 *   atempo=0.4  → REJECTED, "Value 0.400000 for parameter 'tempo' out of range [0.5 - 100]"
 *   atempo=3.0  → accepted, 12s in → 4.01s out
 *
 * So the FLOOR of 0.5 is real and hard-enforced — ask for 0.4 and the graph is rejected
 * at build time, which means no output file at all rather than a bad-sounding one. The
 * ceiling of 2.0 is NOT enforced in this version.
 *
 * WHY IT STILL CHAINS ABOVE 2×
 * Because the chain is the one form that is valid on every ffmpeg. `atempo=3` works on
 * the currently bundled 7.0.2 and is rejected by the builds that enforce the old ceiling;
 * `atempo=2,atempo=1.5` works on both. ffmpeg-static gets bumped from time to time, and
 * a silent "no output file" on a future bump is not worth the two characters saved.
 *
 * Each link resamples, so the chain is kept as SHORT as possible — two stages cover
 * everything up to 4×, which is well past anything a person can follow.
 */

/**
 * The range one `atempo` filter is chained to stay inside.
 *
 * MIN is ffmpeg's real, enforced floor (verified above). MAX is the historical documented
 * ceiling, kept as the chaining step so the emitted filter is accepted by old and new
 * ffmpeg alike.
 */
export const ATEMPO_MIN = 0.5
export const ATEMPO_MAX = 2.0

/**
 * The `atempo` factors needed to reach `speed`, in order.
 *
 * Returns an empty list for 1× — no filter at all is better than `atempo=1.0`, which
 * still resamples and still costs a little quality for no change.
 */
export function atempoFactors(speed: number): number[] {
  if (!Number.isFinite(speed) || speed <= 0) return []
  // Clamped to a range that stays intelligible; past 4× nobody can follow words anyway,
  // and the chain would grow long enough to be audible.
  const target = Math.min(4, Math.max(0.25, speed))
  if (Math.abs(target - 1) < 0.001) return []

  const factors: number[] = []
  let remaining = target
  // Take the biggest legal bite each time, so the chain is as short as possible.
  while (remaining > ATEMPO_MAX + 0.001) {
    factors.push(ATEMPO_MAX)
    remaining /= ATEMPO_MAX
  }
  while (remaining < ATEMPO_MIN - 0.001) {
    factors.push(ATEMPO_MIN)
    remaining /= ATEMPO_MIN
  }
  // Rounded to 3 places: ffmpeg parses the number, and 1.4999999999999998 in a command
  // line is noise in every log it appears in.
  const last = Math.round(remaining * 1000) / 1000
  if (Math.abs(last - 1) > 0.001) factors.push(last)
  return factors
}

/**
 * The filter string for a speed change, or an empty string when none is needed.
 * `atempo=2,atempo=1.5` for 3×.
 */
export function atempoFilter(speed: number): string {
  return atempoFactors(speed)
    .map((f) => `atempo=${f}`)
    .join(',')
}

/**
 * ffmpeg arguments to write a sped-up copy of an audio file.
 *
 * The output is 96k mono AAC on purpose: this file exists to be listened to once and
 * thrown away, so a large one wastes disk and time for no benefit. `-vn` guards the case
 * where the input has a video stream.
 */
export function buildSpeedArgs(inputPath: string, outPath: string, speed: number): string[] {
  const filter = atempoFilter(speed)
  return [
    '-y',
    '-i',
    inputPath,
    '-vn',
    ...(filter ? ['-filter:a', filter] : []),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ac',
    '1',
    outPath
  ]
}

/** How long the sped-up file will run. Used to show the listening time before rendering. */
export function spedUpSeconds(originalSeconds: number, speed: number): number {
  const factors = atempoFactors(speed)
  const effective = factors.reduce((n, f) => n * f, 1)
  return effective > 0 ? originalSeconds / effective : originalSeconds
}
