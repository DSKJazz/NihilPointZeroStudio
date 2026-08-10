/**
 * Generates a real, downloadable YouTube thumbnail IMAGE (1280x720 PNG) for free,
 * offline, via ffmpeg: a bold headline over a themed two-tone background with an
 * accent bar. Pure arg/text builders are unit-tested; renderThumbnail runs ffmpeg.
 *
 * This is NOT AI-invented artwork (that needs a paid/GPU image model) — it's a clean,
 * styled text-over-background thumbnail, the kind that reliably gets clicks for
 * finance/commentary content. A background image can be supplied to sit behind it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from './ffmpeg'
import { STYLE_THEMES } from './render'
import type { VideoStyle } from '../../shared/types'

const W = 1280
const H = 720

function boldFontArg(): string {
  const path = `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts\\arialbd.ttf`
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

function fileArg(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** Removes characters that fight with drawtext and upper-cases for punch. */
export function sanitizeHeadline(text: string): string {
  return text.replace(/[^A-Za-z0-9 ,.!?%&/$-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

/**
 * Wraps a headline into up to `maxLines` lines of roughly `maxPerLine` characters,
 * breaking on word boundaries. Pure + unit-tested.
 */
export function splitHeadline(text: string, maxPerLine = 16, maxLines = 3): string[] {
  const words = sanitizeHeadline(text).split(' ').filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length <= maxPerLine) {
      cur = candidate
    } else {
      if (cur) lines.push(cur)
      cur = w
      if (lines.length >= maxLines - 1) break
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  return lines.length ? lines : ['THUMBNAIL']
}

export interface ThumbTheme {
  bgColor: string
  accentColor: string
  textColor: string
}

/** Derives a thumbnail palette from a video style theme. */
export function thumbThemeFor(style: VideoStyle = 'cinematic'): ThumbTheme {
  const t = STYLE_THEMES[style] ?? STYLE_THEMES.cinematic
  return { bgColor: t.bgColor, accentColor: t.waveColor.split('@')[0], textColor: t.titleColor }
}

/**
 * Builds the ffmpeg args for the thumbnail. `lineFiles` are absolute paths to text
 * files (one per headline line); `bgImage` optionally replaces the flat background.
 * Pure (no fs) so it can be unit-tested.
 */
export function buildThumbnailArgs(params: {
  lineFiles: string[]
  theme: ThumbTheme
  outPath: string
  bgImage?: string
}): string[] {
  const { lineFiles, theme, outPath, bgImage } = params
  const font = boldFontArg()
  const fontSize = lineFiles.length >= 3 ? 120 : lineFiles.length === 2 ? 150 : 190
  const lineH = fontSize + 24
  const blockTop = Math.round((H - lineFiles.length * lineH) / 2)

  const chains: string[] = []
  // Background: an image (scaled to cover) or a flat themed color, then a left accent bar.
  if (bgImage) {
    chains.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.35:t=fill[bg]`
    )
  } else {
    chains.push(`[0:v]drawbox=x=0:y=0:w=18:h=${H}:color=${theme.accentColor}:t=fill[bg]`)
  }

  let prev = 'bg'
  lineFiles.forEach((lf, i) => {
    const y = blockTop + i * lineH
    const next = `t${i}`
    chains.push(
      `[${prev}]drawtext=expansion=none:fontfile='${font}':textfile='${fileArg(lf)}':fontcolor=${theme.textColor}:` +
        `fontsize=${fontSize}:x=60:y=${y}:shadowcolor=black@0.8:shadowx=4:shadowy=4[${next}]`
    )
    prev = next
  })

  const filter = chains.join(';')
  const args = ['-y']
  if (bgImage) args.push('-i', bgImage)
  else args.push('-f', 'lavfi', '-i', `color=c=${theme.bgColor}:s=${W}x${H}`)
  args.push('-filter_complex', filter, '-map', `[${prev}]`, '-frames:v', '1', outPath)
  return args
}

/** Renders a thumbnail PNG at outPath from a headline + style (optional bg image). */
export async function renderThumbnail(
  headline: string,
  style: VideoStyle,
  outPath: string,
  bgImage?: string
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'thumb-'))
  try {
    const lines = splitHeadline(headline)
    const lineFiles = lines.map((line, i) => {
      const p = join(scratch, `line${i}.txt`)
      writeFileSync(p, line, 'utf-8')
      return p
    })
    await runFfmpeg(buildThumbnailArgs({ lineFiles, theme: thumbThemeFor(style), outPath, bgImage }))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
