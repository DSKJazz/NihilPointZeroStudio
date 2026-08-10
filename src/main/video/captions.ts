/**
 * Auto-captions: turn transcribed speech segments into a standard .srt subtitle file,
 * and (optionally) burn them into the video. Transcription is the bundled offline
 * Whisper (see ../speech); this file is the pure formatting + ffmpeg-arg layer.
 */
export interface CaptionSegment {
  text: string
  start: number
  end: number
}

/** SRT timestamp: HH:MM:SS,mmm. Pure. */
export function srtTime(sec: number): string {
  // Derive every field from a single rounded-milliseconds total so a fractional
  // part ≥ .9995 carries into seconds (5.9996 → 00:00:06,000, never ...05,1000).
  const total = Math.round(Math.max(0, sec) * 1000)
  const h = Math.floor(total / 3600000)
  const m = Math.floor(total / 60000) % 60
  const ss = Math.floor(total / 1000) % 60
  const ms = total % 1000
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(ss)},${p(ms, 3)}`
}

/** Builds a valid .srt document from ordered caption segments. Pure + unit-tested. */
export function buildSrt(segments: CaptionSegment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s, i) => {
      const end = s.end > s.start ? s.end : s.start + 2
      return `${i + 1}\n${srtTime(s.start)} --> ${srtTime(end)}\n${s.text.trim()}\n`
    })
    .join('\n')
}

/** Escapes a Windows/POSIX path for use inside the ffmpeg `subtitles=` filter. */
export function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** The Windows Fonts dir, escaped for the subtitles filter's `fontsdir=`. */
export function fontsDirArg(): string {
  return `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts`.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/**
 * ffmpeg args to burn an .srt into a video (re-encodes video, copies audio).
 * The bundled Windows ffmpeg has NO fontconfig, so `subtitles=` alone can't resolve a
 * font and renders nothing — we hand libass an explicit `fontsdir=` (Windows Fonts) plus
 * `force_style=FontName=Arial…` so it always finds a font, matching how drawtext is
 * pinned everywhere else.
 */
export function buildBurnSubsArgs(videoPath: string, srtPath: string, outPath: string): string[] {
  const style = 'FontName=Arial,FontSize=22,Outline=2,Shadow=1,MarginV=40'
  return [
    '-y',
    '-i',
    videoPath,
    '-vf',
    `subtitles='${escapeSubtitlesPath(srtPath)}':fontsdir='${fontsDirArg()}':force_style='${style}'`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outPath
  ]
}
