/**
 * How a finished recording is turned into the file kept in the studio.
 *
 * THE POINT: DO NOT THROW AWAY WHAT WAS JUST CAPTURED
 * The Recorder now captures at YouTube's own bitrates. Re-encoding that at ffmpeg's
 * defaults would hand most of it straight back — every re-encode of an already-lossy
 * video loses something, and there is no reason to pay that twice.
 *
 * So there are three routes, in order of preference:
 *   1. Already H.264 and no enhancement asked for → copy the streams. Instant, and
 *      bit-for-bit the file the camera produced.
 *   2. Needs converting (VP9/VP8 webm) → transcode at CRF 18, which is the point where
 *      the difference from the source stops being visible.
 *   3. Enhancement asked for → the existing enhance pass, unchanged.
 *
 * Pure functions, so the exact arguments can be tested without running ffmpeg.
 */
import { AUDIO_ENHANCE_FILTER, buildEnhanceArgs } from '../video/enhance'

export interface SaveOptions {
  /** Clean the voice and polish the picture. Always costs a re-encode. */
  enhance?: boolean
  /** True when the browser already recorded H.264, which is the common case now. */
  sourceIsH264?: boolean
}

/**
 * CRF 18 with a real preset, not `veryfast`. The old settings were chosen when the
 * capture bitrate was the browser's ~2.5 Mbit default and there was little to protect;
 * there is now.
 */
const HIGH_QUALITY = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p']

export function recordingVideoArgs(input: string, out: string, opts: SaveOptions = {}): string[] {
  if (opts.enhance) return buildEnhanceArgs(input, out, { audio: true, video: true })
  if (opts.sourceIsH264) {
    // Nothing is decoded or re-encoded here — the streams are lifted into an MP4 as
    // they are. `+faststart` still applies so the file starts playing before it has
    // fully downloaded, which matters when it is watched from the phone.
    return ['-y', '-i', input, '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', out]
  }
  return ['-y', '-i', input, ...HIGH_QUALITY, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
}

/**
 * Voice-only: narrating without appearing on camera.
 *
 * `-vn` is not optional. Without it ffmpeg will happily notice the cover art some
 * containers carry and try to make a video out of it.
 *
 * The cleanup chain is the video enhancer's, imported rather than copied, so the
 * user's voice sounds the same whichever way they recorded.
 */
export function recordingAudioArgs(input: string, out: string, opts: SaveOptions = {}): string[] {
  const args = ['-y', '-i', input, '-vn']
  if (opts.enhance) args.push('-af', AUDIO_ENHANCE_FILTER)
  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)
  return args
}
