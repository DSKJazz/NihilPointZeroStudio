/**
 * The "no voice / silent" narration option: build the video with a completely silent
 * audio track so the user can record their own voice over it afterwards.
 *
 * The track still needs a LENGTH, because the whole render is paced off the narration's
 * duration. With no speech to measure we estimate how long the script would take to read
 * aloud, so the visuals land where the user's own narration will.
 */
import { runFfmpeg } from './ffmpeg'

/** Words per minute for calm narration — deliberately unhurried, matching TTS pacing. */
const WORDS_PER_MINUTE = 150
const MIN_SECONDS = 5
const MAX_SECONDS = 60 * 60

/**
 * How long the script would take to read aloud, in seconds. Pure + tested.
 *
 * Every [bracketed] span is dropped, not just the ALL-CAPS full-line ones the TTS
 * path strips: nobody recording their own narration reads the camera directions out,
 * so counting them would leave the video running past the end of their voice.
 */
export function estimateReadingSeconds(body: string): number {
  const words = (body || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  if (!words) return MIN_SECONDS
  const seconds = (words / WORDS_PER_MINUTE) * 60
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)))
}

/** Writes `seconds` of digital silence to `outPath` as a WAV the renderer can measure. */
export async function writeSilentTrack(seconds: number, outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=stereo',
    '-t',
    String(Math.max(MIN_SECONDS, seconds)),
    '-c:a',
    'pcm_s16le',
    outPath
  ])
}
