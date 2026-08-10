/**
 * Does everything to a video in ONE encode instead of one encode per step.
 *
 * THE LEAK THIS PLUGS
 * Six things in this app can each rewrite a video: enhance, captions, watermark, trim,
 * shorts and export. Each one was a separate ffmpeg run — decode the whole file,
 * re-compress it, write a new file. Run a video through four of them and it has been
 * compressed four times. Every pass throws away detail the previous pass kept, and
 * none of it comes back. The result is a finished video visibly softer than the one
 * that came out of the renderer, for no reason the user could ever see or explain.
 *
 * Compressing four times at good settings is still worse than compressing ONCE at
 * mediocre ones. So the fix is not better settings — it is fewer passes.
 *
 * TWO RULES, AND THEY ARE THE WHOLE MODULE
 *
 *   1. Combine. Captions, watermark, colour polish and trim all become one filter
 *      chain and one encode. Four generations of loss become one.
 *
 *   2. Never re-encode a stream nothing touched. Burning subtitles changes the picture
 *      and leaves the sound alone — so the sound is COPIED, bit for bit. Cleaning the
 *      voice leaves the picture alone, so the picture is copied. A trim on its own
 *      touches neither, and becomes a pure copy: instant, and lossless.
 *
 * Pure. The exact command can be asserted without running ffmpeg, which matters because
 * the failure here is silent — a wrongly re-encoded stream still plays fine, it just
 * looks slightly worse, forever.
 */
import { AUDIO_ENHANCE_FILTER, VIDEO_ENHANCE_FILTER } from './enhance'
import { escapeSubtitlesPath, fontsDirArg } from './captions'
import { overlayXY, type WatermarkPosition } from './watermark'

export interface OnePassOps {
  /** Clean the voice: de-noise, level, broadcast loudness. Touches audio only. */
  enhanceAudio?: boolean
  /** Colour and sharpen. Touches video only. */
  enhanceVideo?: boolean
  /** Burn an .srt in. Touches video only. */
  subtitlePath?: string
  /** Overlay a logo. Touches video only. */
  watermark?: { logoPath: string; widthPx: number; position?: WatermarkPosition; margin?: number }
  /** Cut a window out. Touches NEITHER stream — it selects, it does not alter. */
  trim?: { startSec: number; endSec?: number }
  /**
   * Bring the whole thing to YouTube's own delivery loudness. Deliver louder and
   * YouTube turns you down, taking the punch you mixed for with it. Audio only.
   */
  normaliseLoudness?: boolean
}

export interface OnePassPlan {
  args: string[]
  /** True when the picture had to be re-compressed. */
  reencodesVideo: boolean
  /** True when the sound had to be re-compressed. */
  reencodesAudio: boolean
  /** Plain English, for the activity log and the UI. */
  summary: string
}

/** YouTube normalises to −14 LUFS. Matching it means nothing is turned down later. */
export const YOUTUBE_LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'

export function touchesVideo(ops: OnePassOps): boolean {
  return Boolean(ops.enhanceVideo || ops.subtitlePath || ops.watermark)
}

export function touchesAudio(ops: OnePassOps): boolean {
  return Boolean(ops.enhanceAudio || ops.normaliseLoudness)
}

/**
 * Builds one command for every requested operation.
 *
 * `encoderArgs` comes from the hardware-encoder detector, so the single remaining
 * encode also runs on the graphics chip when there is one.
 */
export function planOnePass(
  input: string,
  output: string,
  ops: OnePassOps,
  encoderArgs: string[]
): OnePassPlan {
  const args: string[] = ['-y']

  // Seeking before -i is by keyframe and fast; on a long video, seeking after -i means
  // decoding everything up to the mark first.
  if (ops.trim?.startSec) args.push('-ss', ops.trim.startSec.toFixed(3))
  if (ops.trim?.endSec !== undefined) args.push('-to', ops.trim.endSec.toFixed(3))
  args.push('-i', input)

  const videoWork = touchesVideo(ops)
  const audioWork = touchesAudio(ops)

  if (ops.watermark) {
    // A logo is a second input, so this needs filter_complex rather than -vf. The
    // colour grade and the subtitles have to join the SAME chain — running them as a
    // separate pass is exactly the waste this module exists to remove.
    const w = ops.watermark
    args.push('-i', w.logoPath)
    const pre: string[] = []
    if (ops.enhanceVideo) pre.push(VIDEO_ENHANCE_FILTER)
    if (ops.subtitlePath) pre.push(subtitleFilter(ops.subtitlePath))
    const base = pre.length ? `[0:v]${pre.join(',')}[base];` : ''
    const baseLabel = pre.length ? '[base]' : '[0:v]'
    args.push(
      '-filter_complex',
      `${base}[1:v]scale=${Math.max(16, Math.round(w.widthPx))}:-1[wm];` +
        `${baseLabel}[wm]overlay=${overlayXY(w.position ?? 'bottom-right', w.margin ?? 24)}[v]`,
      '-map',
      '[v]',
      '-map',
      '0:a?'
    )
  } else if (videoWork) {
    const chain: string[] = []
    if (ops.enhanceVideo) chain.push(VIDEO_ENHANCE_FILTER)
    if (ops.subtitlePath) chain.push(subtitleFilter(ops.subtitlePath))
    args.push('-vf', chain.join(','))
  }

  if (audioWork) {
    const chain: string[] = []
    if (ops.enhanceAudio) chain.push(AUDIO_ENHANCE_FILTER)
    // Loudness goes LAST. Normalising and then compressing would undo the measurement
    // the normaliser just made.
    if (ops.normaliseLoudness) chain.push(YOUTUBE_LOUDNESS)
    args.push('-af', chain.join(','))
  }

  // The point of the whole module: an untouched stream is copied, not re-compressed.
  if (videoWork) args.push(...encoderArgs)
  else args.push('-c:v', 'copy')

  if (audioWork) args.push('-c:a', 'aac', '-b:a', '192k')
  else args.push('-c:a', 'copy')

  args.push('-movflags', '+faststart', output)

  return {
    args,
    reencodesVideo: videoWork,
    reencodesAudio: audioWork,
    summary: describePlan(ops, videoWork, audioWork)
  }
}

function subtitleFilter(srtPath: string): string {
  const style = 'FontName=Arial,FontSize=22,Outline=2,Shadow=1,MarginV=40'
  return `subtitles='${escapeSubtitlesPath(srtPath)}':fontsdir='${fontsDirArg()}':force_style='${style}'`
}

function describePlan(ops: OnePassOps, video: boolean, audio: boolean): string {
  const did: string[] = []
  if (ops.trim) did.push('trimmed')
  if (ops.enhanceVideo) did.push('picture polished')
  if (ops.subtitlePath) did.push('captions burned in')
  if (ops.watermark) did.push('logo added')
  if (ops.enhanceAudio) did.push('voice cleaned')
  if (ops.normaliseLoudness) did.push('loudness set for YouTube')
  if (!did.length) return 'Nothing to change — the file was copied as it is.'
  const kept: string[] = []
  if (!video) kept.push('picture')
  if (!audio) kept.push('sound')
  const keptNote = kept.length ? ` The ${kept.join(' and ')} ${kept.length === 1 ? 'was' : 'were'} copied untouched, so no quality was lost there.` : ''
  return `${did.join(', ')} — all in one pass.${keptNote}`
}

/**
 * How many separate encodes the old way would have cost, for the same operations.
 * Used in the activity log so the saving is visible rather than theoretical.
 */
export function passesSaved(ops: OnePassOps): number {
  let n = 0
  if (ops.enhanceAudio || ops.enhanceVideo) n++
  if (ops.subtitlePath) n++
  if (ops.watermark) n++
  if (ops.trim) n++
  if (ops.normaliseLoudness) n++
  return Math.max(0, n - 1)
}
