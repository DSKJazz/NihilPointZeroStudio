/**
 * Change a built video's background music WITHOUT touching the narration — because we
 * kept the narration as its own track when the video was built, this is exact and fully
 * offline (no AI "unmixing" needed). 'remove' drops the music and keeps only the voice;
 * 'replace' lays a new music bed under the voice. Pure arg builder + unit-tested.
 */
export type MusicMode = 'remove' | 'replace'

export function buildSetMusicArgs(params: {
  mode: MusicMode
  videoPath: string
  narrationPath: string
  /** Required when mode==='replace': the new music bed file (looped, ducked under voice). */
  musicPath?: string
  outPath: string
}): string[] {
  const { mode, videoPath, narrationPath, musicPath, outPath } = params
  const tail = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath]

  if (mode === 'remove' || !musicPath) {
    // Keep only the narration: copy the video stream, use the narration audio as-is.
    return ['-y', '-i', videoPath, '-i', narrationPath, '-map', '0:v:0', '-map', '1:a:0', ...tail]
  }

  // Replace: mix a faded-in music bed (looped) under the narration, AUTO-DUCKED — the
  // music dips automatically whenever the voice is speaking (sidechain compression),
  // then mixes with the narration. Sounds professional, no manual volume-riding.
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    narrationPath,
    '-stream_loop',
    '-1',
    '-i',
    musicPath,
    '-filter_complex',
    // The narration pad [1:a] is needed TWICE (as the sidechain key AND as an amix input),
    // but an input pad can only feed one filter — so split it first with asplit. Without
    // this, ffmpeg rejects the graph and every "Replace music" op fails.
    // Normalise both to one rate/layout before sidechain+mix, and cap peaks with a
    // level=disabled limiter (attenuate-only) so ducked-music + narration transients
    // can't clip the encoder.
    '[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[nkey][nmix];' +
      '[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.5,afade=t=in:st=0:d=1.5[mraw];' +
      '[mraw][nkey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[mus];' +
      '[nmix][mus]amix=inputs=2:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]',
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    ...tail
  ]
}

/**
 * Lays a music bed over only PART of a video (startSec → endSec), keeping the video's
 * own audio everywhere. Unlike buildSetMusicArgs this needs no separate narration track,
 * so it works on any video — including ones recorded or imported by the user.
 *
 * The bed is looped, trimmed to the region, faded at both ends, delayed to its start
 * position, then ducked under and mixed with the original audio. Pure arg builder.
 */
export function buildMusicRegionArgs(params: {
  videoPath: string
  musicPath: string
  startSec: number
  endSec: number
  outPath: string
  /** 0..1 bed level before ducking (default 0.35 — present but not competing). */
  gain?: number
  /**
   * Whether the source video has an audio stream. When it does not (a silent screen
   * recording, a downloaded clip), referencing [0:a] makes ffmpeg abort with
   * "matches no streams", so the bed is laid down on its own instead.
   */
  hasAudio?: boolean
}): string[] {
  const { videoPath, musicPath, outPath } = params
  const hasAudio = params.hasAudio ?? true
  const start = Math.max(0, params.startSec)
  const end = Math.max(start + 0.5, params.endSec)
  const span = end - start
  const gain = params.gain ?? 0.35
  // Fades scale down for a short region so a 2-second bed isn't entirely fade.
  const fade = Math.min(1.5, span / 4)

  // The bed itself: loop → trim to the region → level → fade both ends → delay into place.
  const bed =
    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `atrim=0:${span.toFixed(3)},asetpts=PTS-STARTPTS,volume=${gain},` +
    `afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${(span - fade).toFixed(3)}:d=${fade.toFixed(3)},` +
    `adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}`

  const filter = hasAudio
    ? `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vkey][vmix];` +
      `${bed}[bed];` +
      `[bed][vkey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[duck];` +
      `[vmix][duck]amix=inputs=2:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]`
    : // Nothing to duck under or mix with — just place the bed and pad the rest with silence
      // so the audio track spans the whole video rather than stopping at the region's end.
      `${bed},apad[aout]`

  return [
    '-y',
    '-i',
    videoPath,
    '-stream_loop',
    '-1',
    '-i',
    musicPath,
    '-filter_complex',
    filter,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    // Without a source audio track the padded bed is infinite, so the video length
    // must be what ends the encode.
    ...(hasAudio ? [] : ['-shortest']),
    '-movflags',
    '+faststart',
    outPath
  ]
}
