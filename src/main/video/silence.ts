/**
 * Cuts the dead air out of a talking-head recording.
 *
 * WHY THIS IS THE BEST RETENTION EDIT THERE IS
 * On a twenty-minute unscripted take there is typically two to four minutes of nothing:
 * the pause while you find your place, the breath before a hard word, the two seconds
 * after you fluff a line. Nobody watches those. They are where people leave. Cutting
 * them is the single edit that lifts retention on EVERY video, forever, and it is
 * mechanical work no human should be doing by hand.
 *
 * WHY NOT `silenceremove`
 * ffmpeg has a one-line filter for this. It is wrong for speech: it works on the audio
 * stream alone, so the video is left behind and lips stop matching words. It also has
 * no notion of "leave a beat" — it clamps every gap to zero and the result sounds
 * breathless and machine-made, which is worse than the pauses were.
 *
 * So this DETECTS the silences, decides which are worth cutting, deliberately LEAVES a
 * short pause at each one, and then cuts video and audio together on the same marks.
 *
 * The detection is parsed from ffmpeg's `silencedetect`; every decision after that is
 * pure and unit-tested, because the failure mode is a video with words chopped off —
 * and you only find out by watching the whole thing.
 */

// KeepSpan and SilenceSummary live in shared/types.ts: they cross the IPC wire to the
// renderer and the phone, and the preload cannot import from src/main.
import type { KeepSpan, SilenceSummary } from '../../shared/types'
export type { KeepSpan, SilenceSummary }

export interface SilenceSpan {
  startSec: number
  endSec: number
}


/**
 * How quiet counts as silence, in dBFS. −32 dB is chosen for a real room rather than a
 * studio: a treated booth would allow −40, but a bedroom with a fan and traffic outside
 * never gets there, and a threshold that never triggers is a feature that does nothing.
 */
export const DEFAULT_THRESHOLD_DB = -32

/**
 * Gaps shorter than this are natural speech rhythm, not dead air. Cutting them is what
 * makes an edit sound frantic. Comma pauses run 0.2-0.5 s; sentence breaks 0.5-0.8 s.
 */
export const DEFAULT_MIN_SILENCE_SEC = 0.9

/**
 * What is LEFT at each cut. Not zero, on purpose: speech with every gap removed is
 * exhausting and obviously machine-cut. A quarter-second reads as a tight edit; zero
 * reads as a glitch.
 */
export const DEFAULT_KEEP_PAUSE_SEC = 0.25

/** ffmpeg args that measure the silences without producing a file. */
export function detectArgs(input: string, thresholdDb = DEFAULT_THRESHOLD_DB, minSec = DEFAULT_MIN_SILENCE_SEC): string[] {
  return [
    '-hide_banner',
    '-i',
    input,
    '-af',
    `silencedetect=noise=${thresholdDb}dB:d=${minSec}`,
    '-f',
    'null',
    '-'
  ]
}

/**
 * Reads ffmpeg's silencedetect output.
 *
 * It prints `silence_start: 12.34` and `silence_end: 15.67 | silence_duration: 3.33`
 * on stderr, interleaved with everything else. A trailing silence that runs to the end
 * of the file gets a start with no end — handled by the caller, which knows the
 * duration; inventing one here would be guessing.
 */
export function parseSilences(ffmpegOutput: string): SilenceSpan[] {
  const spans: SilenceSpan[] = []
  let open: number | null = null
  for (const line of (ffmpegOutput ?? '').split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (start) {
      open = Math.max(0, Number(start[1]))
      continue
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (end && open !== null) {
      const e = Number(end[1])
      if (Number.isFinite(e) && e > open) spans.push({ startSec: open, endSec: e })
      open = null
    }
  }
  return spans
}

export interface PlanOptions {
  /** Total length, so a trailing silence can be closed and the last keep can end. */
  durationSec: number
  /** Pause left at each cut. */
  keepPauseSec?: number
  /**
   * Never cut the opening. A hard cut in the first moments looks like a broken file,
   * and the hook is the last place to introduce a jolt.
   */
  protectHeadSec?: number
  /** Likewise the very end, so the sign-off is not clipped. */
  protectTailSec?: number
}

/**
 * Turns the silences into the spans to KEEP.
 *
 * Working in keeps rather than cuts is deliberate: it makes the two things that must
 * never happen structurally impossible — spans cannot overlap, and no span can run
 * backwards. Both are trivially assertable, and both would produce a mangled video.
 */
export function planKeeps(silences: SilenceSpan[], options: PlanOptions): KeepSpan[] {
  const duration = Math.max(0, options.durationSec)
  const pause = Math.max(0, options.keepPauseSec ?? DEFAULT_KEEP_PAUSE_SEC)
  const head = Math.max(0, options.protectHeadSec ?? 1.5)
  const tail = Math.max(0, options.protectTailSec ?? 1)
  if (!duration) return []

  // Only silences fully inside the protected middle are candidates.
  const usable = silences
    .filter((s) => s.endSec > s.startSec)
    .filter((s) => s.startSec >= head && s.endSec <= duration - tail)
    .sort((a, b) => a.startSec - b.startSec)

  const keeps: KeepSpan[] = []
  let cursor = 0
  for (const s of usable) {
    // Leave the pause at the END of the outgoing clip, so a sentence lands and settles
    // rather than being cut off the instant the speaker stops.
    const keepUntil = Math.min(s.startSec + pause, s.endSec)
    if (keepUntil > cursor) keeps.push({ startSec: cursor, endSec: keepUntil })
    cursor = Math.max(cursor, s.endSec)
  }
  if (cursor < duration) keeps.push({ startSec: cursor, endSec: duration })

  // Drop anything too short to be a real shot. A 40-millisecond fragment is a flicker,
  // not an edit, and stitching hundreds of them is how this feature goes wrong.
  return keeps.filter((k) => k.endSec - k.startSec >= 0.12)
}


export function summarise(keeps: KeepSpan[], durationSec: number): SilenceSummary {
  const keptSec = keeps.reduce((n, k) => n + (k.endSec - k.startSec), 0)
  const removedSec = Math.max(0, durationSec - keptSec)
  const cuts = Math.max(0, keeps.length - 1)
  const mmss = (s: number): string =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  const headline = cuts
    ? `Removed ${mmss(removedSec)} of dead air across ${cuts} cut${cuts === 1 ? '' : 's'} — ${mmss(keptSec)} left.`
    : 'No dead air worth cutting — the take is already tight.'
  return { removedSec, keptSec, cuts, headline }
}

/**
 * Cuts video and audio together on the same marks.
 *
 * `select`/`aselect` with matching expressions is what keeps lips on words: both
 * streams are filtered by the same list of time windows in one pass. `setpts`/`asetpts`
 * then close the gaps in the timestamps — without them the output keeps the original
 * timeline and simply freezes over every cut.
 */
export function buildCutArgs(
  input: string,
  output: string,
  keeps: KeepSpan[],
  encoderArgs: string[]
): string[] {
  const expr = keeps
    .map((k) => `between(t,${k.startSec.toFixed(3)},${k.endSec.toFixed(3)})`)
    .join('+')
  return [
    '-y',
    '-i',
    input,
    '-vf',
    `select='${expr}',setpts=N/FRAME_RATE/TB`,
    '-af',
    `aselect='${expr}',asetpts=N/SR/TB`,
    ...encoderArgs,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output
  ]
}

/**
 * Finds the dead air in a file and plans the cut, without touching anything.
 *
 * Two ffmpeg passes and no encode: one silencedetect read, one duration read. Cheap
 * enough to run and SHOW the user before they decide, which is the point — a silence
 * remover that just does it is a silence remover nobody trusts with a finished take.
 */
export async function planSilenceCut(
  input: string,
  run: (args: string[]) => Promise<string>,
  duration: (file: string) => Promise<number>,
  options: { thresholdDb?: number; minSilenceSec?: number; keepPauseSec?: number } = {}
): Promise<{ keeps: KeepSpan[]; summary: SilenceSummary; durationSec: number }> {
  const durationSec = await duration(input)
  const output = await run(detectArgs(input, options.thresholdDb, options.minSilenceSec))
  const keeps = planKeeps(parseSilences(output), {
    durationSec,
    keepPauseSec: options.keepPauseSec
  })
  return { keeps, summary: summarise(keeps, durationSec), durationSec }
}
