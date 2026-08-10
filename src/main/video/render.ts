import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeFfmpegProgressLogger, runFfmpeg } from './ffmpeg'
import { chooseEncoderForJob, encoderLabel, isHardware, runEncodeWithFallback } from './encoder'
import { finishingChain, templateFor, titleAlphaExpr, type VideoTemplate } from './templates'
import { YOUTUBE_LOUDNESS } from './onePass'
import { buildAutoZoomFilter, planShots } from './autoZoom'
import { pace } from '../../shared/pacing'
import type { ImageShot, SceneTransition, VideoStyle } from '../../shared/types'

export type VideoResolution = '1080p' | '1440p' | '4k' | '8k'
export type { VideoStyle } from '../../shared/types'
export type VideoAspect = '16:9' | '9:16' | '1:1'

/** Colors + sizing that give each preset style a distinct look. */
export interface StyleTheme {
  /** Background fill (hex 0xRRGGBB) when no images/animation are used. */
  bgColor: string
  /** Title text color. */
  titleColor: string
  /** Section-card text color. */
  cardColor: string
  /** Waveform color+alpha for showwaves (0xRRGGBB@a). */
  waveColor: string
  /** Multiplier applied to base font sizes. */
  fontScale: number
  /** Animated-gradient endpoints + type for the moving background. */
  gradFrom: string
  gradTo: string
  gradType: 'linear' | 'radial' | 'circular'
}

export const STYLE_THEMES: Record<VideoStyle, StyleTheme> = {
  cinematic: { bgColor: '0x0B0F1A', titleColor: '0xF5E9C8', cardColor: '0xFFFFFF', waveColor: '0xE8B923@0.85', fontScale: 1, gradFrom: '0x0B0F1A', gradTo: '0x1A2A44', gradType: 'radial' },
  cartoon: { bgColor: '0x1B6CA8', titleColor: '0xFFF14D', cardColor: '0xFFFFFF', waveColor: '0xFF5DA2@0.9', fontScale: 1.12, gradFrom: '0x1B6CA8', gradTo: '0x33B0E0', gradType: 'linear' },
  anime: { bgColor: '0x14122B', titleColor: '0xFF9EE6', cardColor: '0xB6F0FF', waveColor: '0x8A7CFF@0.9', fontScale: 1.06, gradFrom: '0x14122B', gradTo: '0x3A2A6B', gradType: 'radial' },
  neon: { bgColor: '0x05010D', titleColor: '0x39FF14', cardColor: '0x00E5FF', waveColor: '0xFF00E5@0.9', fontScale: 1, gradFrom: '0x05010D', gradTo: '0x2A004A', gradType: 'radial' },
  minimal: { bgColor: '0xF5F5F0', titleColor: '0x111111', cardColor: '0x222222', waveColor: '0x888888@0.8', fontScale: 1, gradFrom: '0xF5F5F0', gradTo: '0xE2E2DA', gradType: 'linear' },

  // Cinematic variants
  noir: { bgColor: '0x0A0A0A', titleColor: '0xF2F2F2', cardColor: '0xD8D8D8', waveColor: '0xFFFFFF@0.75', fontScale: 1, gradFrom: '0x000000', gradTo: '0x2E2E2E', gradType: 'linear' },
  blockbuster: { bgColor: '0x061218', titleColor: '0xFFB169', cardColor: '0xE8F6FF', waveColor: '0xFF8C42@0.9', fontScale: 1.04, gradFrom: '0x061821', gradTo: '0x1E5C6E', gradType: 'radial' },
  'vintage-film': { bgColor: '0x1A140C', titleColor: '0xF3D9A4', cardColor: '0xF7ECD8', waveColor: '0xD9A441@0.85', fontScale: 1, gradFrom: '0x1A140C', gradTo: '0x4A3520', gradType: 'linear' },
  documentary: { bgColor: '0x141618', titleColor: '0xFFFFFF', cardColor: '0xE6E6E6', waveColor: '0xB0B0B0@0.8', fontScale: 0.98, gradFrom: '0x141618', gradTo: '0x30363B', gradType: 'linear' },

  // Cartoon variants
  'cartoon-3d': { bgColor: '0x1E4FA3', titleColor: '0xFFE066', cardColor: '0xFFFFFF', waveColor: '0x6BE3FF@0.9', fontScale: 1.1, gradFrom: '0x1E4FA3', gradTo: '0x59A5F5', gradType: 'radial' },
  comic: { bgColor: '0xF2E7C9', titleColor: '0xD62828', cardColor: '0x1A1A1A', waveColor: '0x003049@0.9', fontScale: 1.14, gradFrom: '0xF2E7C9', gradTo: '0xFFD166', gradType: 'linear' },
  watercolour: { bgColor: '0xFBF6EE', titleColor: '0x4A5D6B', cardColor: '0x33424E', waveColor: '0x8FB3C7@0.8', fontScale: 1.04, gradFrom: '0xFBF6EE', gradTo: '0xDCE9F0', gradType: 'linear' },

  // Anime variants
  'anime-90s': { bgColor: '0x1C1A24', titleColor: '0xF6C6A8', cardColor: '0xE9E1D6', waveColor: '0xC98F7A@0.85', fontScale: 1.04, gradFrom: '0x1C1A24', gradTo: '0x46374A', gradType: 'linear' },
  'anime-pastoral': { bgColor: '0x123A2E', titleColor: '0xFFF4C2', cardColor: '0xEAFBEF', waveColor: '0x8FD9A8@0.85', fontScale: 1.06, gradFrom: '0x123A2E', gradTo: '0x3E8E6B', gradType: 'radial' },
  'anime-dark': { bgColor: '0x0C0C10', titleColor: '0xC8102E', cardColor: '0xD6D6DE', waveColor: '0x8A0F26@0.9', fontScale: 1.02, gradFrom: '0x0C0C10', gradTo: '0x2A1016', gradType: 'radial' },

  infographic: { bgColor: '0xFFFFFF', titleColor: '0x0B3C5D', cardColor: '0x1D3557', waveColor: '0x457B9D@0.85', fontScale: 1, gradFrom: '0xFFFFFF', gradTo: '0xDCE9F2', gradType: 'linear' }
}

/**
 * Builds an animated `gradients` lavfi source string for a theme — a slow, smooth
 * moving gradient that fills WxH for `durSec` seconds. Cheap at any resolution
 * (unlike per-pixel geq), so it works even at 4K/8K. Pure + unit-tested.
 */
export function buildGradientSource(theme: StyleTheme, w: number, h: number, durSec: number): string {
  return (
    `gradients=s=${w}x${h}:c0=${theme.gradFrom}:c1=${theme.gradTo}:nb_colors=2:` +
    `type=${theme.gradType}:speed=0.006:d=${durSec.toFixed(2)}:r=25`
  )
}

/** Returns the theme for a style, defaulting to cinematic. */
export function themeFor(style: VideoStyle = 'cinematic'): StyleTheme {
  return STYLE_THEMES[style] ?? STYLE_THEMES.cinematic
}

/** The SHORT side (px) for each quality tier. The long side follows the aspect ratio. */
const SHORT_SIDE: Record<VideoResolution, number> = {
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160,
  '8k': 4320
}

/**
 * Pixel [width,height] for a resolution tier + aspect. 16:9 is landscape (long side is
 * width), 9:16 is portrait (Shorts/Reels), 1:1 is square. The 16:9 values are identical
 * to before (e.g. 1080p→1920x1080), so existing videos are unchanged. Pure + tested.
 */
export function dimensionsFor(resolution: VideoResolution = '1080p', aspect: VideoAspect = '16:9'): [number, number] {
  const short = SHORT_SIDE[resolution] ?? 1080
  const long = Math.round((short * 16) / 9)
  if (aspect === '9:16') return [short, long]
  if (aspect === '1:1') return [short, short]
  return [long, short]
}

/** A font that exists on every Windows install; escaped for use inside an ffmpeg filtergraph. */
function fontArg(): string {
  const path = `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts\\arial.ttf`
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** Path for a drawtext `textfile=` / input option, escaped for the filtergraph. */
function fileArg(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:')
}

export interface Layout {
  w: number
  h: number
  titleFont: number
  cardFont: number
  waveW: number
  waveH: number
  titleY: number
  waveMargin: number
}

/**
 * Pixel dimensions and proportionally-scaled font/element sizes. Everything
 * scales off width relative to 1080p, so 4K is 2x and 8K is 4x — the layout is
 * identical, just sharper. Pure + exported for unit testing.
 */
export function computeLayout(resolution: VideoResolution = '1080p', aspect: VideoAspect = '16:9'): Layout {
  const [w, h] = dimensionsFor(resolution, aspect)
  // Scale off the SHORT side so text/waveform stay readable and contained in any shape.
  // For 16:9 this equals the old w/1920 exactly (min(w,h)=h, /1080), so nothing changes.
  const k = Math.min(w, h) / 1080
  return {
    w,
    h,
    titleFont: Math.round(56 * k),
    cardFont: Math.round(72 * k),
    waveW: w,
    waveH: Math.round(220 * k),
    titleY: Math.round(90 * k),
    waveMargin: Math.round(50 * k)
  }
}

export interface AudioPlan {
  chains: string[]
  audioMap: string
  /** Ordered extra inputs after narration: 'music' then one 'sfx' per transition. */
  extraInputs: Array<'music' | 'sfx'>
}

/**
 * Builds the audio portion of the filtergraph. Pure + exported for unit testing.
 *
 * - Narration ([1:a]) always drives the waveform. When we also mix music/SFX we
 *   MUST split it first (an input pad can't feed two filters), so we `asplit`.
 * - Music is volume-lowered and fades in/out so it sits cleanly under the voice
 *   ("smart placement"): a bed, never competing with the narration.
 * - Each section transition gets a soft SFX whoosh, delayed to its timestamp.
 * - `amix ... normalize=0` keeps the narration at full level (default amix would
 *   quietly duck everything as inputs grow).
 */
export function buildAudioFilter(opts: {
  hasMusic: boolean
  sfxTimesSec: number[]
  dur: number
  layout: Layout
  /** Waveform color+alpha (0xRRGGBB@a); defaults to the cinematic gold. */
  waveColor?: string
}): AudioPlan {
  const { hasMusic, sfxTimesSec, dur, layout } = opts
  const waveColor = opts.waveColor ?? '0xE8B923@0.85'
  const wave = `showwaves=s=${layout.waveW}x${layout.waveH}:mode=cline:rate=25:colors=${waveColor}`
  const needMix = hasMusic || sfxTimesSec.length > 0
  if (!needMix) {
    // Narration only. The waveform needs the audio and so does the output, so the input
    // is split — an input pad cannot feed two filters — and the output side is levelled
    // to YouTube's own target on the way out.
    return {
      chains: [`[1:a]asplit=2[awave][anarr]`, `[awave]${wave}[wave]`, `[anarr]${YOUTUBE_LOUDNESS}[aout]`],
      audioMap: '[aout]',
      extraInputs: []
    }
  }

  // Normalise every mix input to one sample-rate + layout first — Piper narration is
  // 16 kHz mono while music/SFX are 44.1 kHz, and amix on mismatched inputs is unreliable.
  const NORM = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const chains = [`[1:a]${NORM},asplit=2[awave][anarr]`, `[awave]${wave}[wave]`]
  const mixLabels: string[] = ['[anarr]']
  const extraInputs: Array<'music' | 'sfx'> = []
  let idx = 2

  if (hasMusic) {
    const fadeOutStart = Math.max(0.1, dur - 2.5)
    chains.push(
      `[${idx}:a]${NORM},volume=0.18,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2.5[mus]`
    )
    mixLabels.push('[mus]')
    extraInputs.push('music')
    idx++
  }

  sfxTimesSec.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t * 1000))
    chains.push(`[${idx}:a]${NORM},adelay=${ms}:all=1,volume=0.5[wh${i}]`)
    mixLabels.push(`[wh${i}]`)
    extraInputs.push('sfx')
    idx++
  })

  // normalize=0 keeps narration at its authored level; the summed narration + ducked music
  // + whoosh(es) can still exceed 0 dBFS, so a final peak limiter (level=disabled = attenuate
  // overs only, never make-up gain) prevents encoder clipping.
  // …and then the whole mix is levelled to YouTube's target, LAST in the chain. YouTube
  // normalises every upload to about -14 LUFS: deliver louder and it simply turns you
  // down, which loses the dynamics you mixed rather than the loudness you wanted. TP=-1.5
  // also caps the true peak, so the limiter above it becomes belt-and-braces.
  chains.push(
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled,${YOUTUBE_LOUDNESS}[aout]`
  )
  return { chains, audioMap: '[aout]', extraInputs }
}

/**
 * Assembles the full ffmpeg argument list. Pure + exported for unit testing.
 * Inputs are, in order: the color background, the narration, then (matching
 * AudioPlan.extraInputs) the looped music and one whoosh input per SFX cue.
 */
export type BackgroundSpec =
  | { kind: 'color'; color: string }
  | { kind: 'animated'; source: string }
  | { kind: 'file'; path: string }

export function buildFfmpegArgs(params: {
  layout: Layout
  dur: number
  audioPath: string
  musicPath?: string
  sfxCount: number
  whooshPath?: string
  filter: string
  videoMap: string
  audioMap: string
  outPath: string
  /** Background: a solid color (default) or a pre-rendered slideshow file. */
  background?: BackgroundSpec
  /** `-c:v …` block (from encoder.ts). Defaults to CPU libx264. */
  videoEncoderArgs?: string[]
}): string[] {
  const { layout, dur, audioPath, musicPath, sfxCount, whooshPath, filter, videoMap, audioMap, outPath } = params
  const videoEncoderArgs = params.videoEncoderArgs ?? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']
  const bg: BackgroundSpec = params.background ?? { kind: 'color', color: '0x0B0F1A' }
  const bgInput =
    bg.kind === 'color'
      ? ['-f', 'lavfi', '-i', `color=c=${bg.color}:s=${layout.w}x${layout.h}:d=${dur.toFixed(2)}`]
      : bg.kind === 'animated'
        ? ['-f', 'lavfi', '-i', bg.source]
        : // Loop a file background: the output uses -shortest, so a background even
          // slightly shorter than the narration (stock B-roll with a failed segment,
          // a short AI clip) used to silently cut off the END of the user's video.
          // Looping makes the narration the governing duration in every case.
          ['-stream_loop', '-1', '-i', bg.path]
  const args = ['-y', ...bgInput, '-i', audioPath]
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath)
  for (let i = 0; i < sfxCount; i++) args.push('-i', whooshPath as string)
  args.push(
    '-filter_complex',
    filter,
    '-map',
    videoMap,
    '-map',
    audioMap,
    ...videoEncoderArgs,
    '-r',
    '25',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  )
  return args
}

/**
 * Derives the on-screen "cards" that cycle through the video: the bracketed
 * stage directions / section titles in the script (e.g. [PATTERN INTERRUPT],
 * [TRADE DEFICIT]). Falls back to a few generic cards if none are found.
 */
export function extractCards(body: string, title: string): string[] {
  // 1) Honour explicit [BRACKET] sections when the writer provided them.
  const bracket: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]{2,40})\]\s*$/.exec(line)
    if (m) bracket.push(m[1].trim())
  }
  const uniqueBrackets = [...new Set(bracket)]
  if (uniqueBrackets.length >= 2) return uniqueBrackets

  // 2) Otherwise DERIVE several scenes from the prose so the video has real variety
  //    (many distinct scenes/images), instead of just 3 static cards. Aim ~1 scene per
  //    ~24 words, 4–10 scenes. Each label = the opening words of a sentence-group.
  const clean = body.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ').replace(/\s+/g, ' ').trim()
  const words = clean ? clean.split(' ').filter(Boolean) : []
  if (words.length < 12) return [title.slice(0, 40) || 'FinScript', 'ANALYSIS', 'KEY TAKEAWAY']

  const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0)
  // Scale scene/section count to the SCRIPT LENGTH so long scripts aren't stuck on a few
  // static cards: ~1 section per ~22 words, 4–40. (A 25-min ~3500-word script → ~40
  // sections; the renderer paces them evenly across the narration.)
  const target = Math.min(40, Math.max(4, Math.round(words.length / 22)))
  const per = Math.max(1, Math.ceil(sentences.length / target))
  const labels: string[] = []
  for (let i = 0; i < sentences.length && labels.length < target; i += per) {
    const chunk = sentences.slice(i, i + per).join(' ')
    const label = chunk.split(' ').slice(0, 5).join(' ').replace(/[.!?,;:]+$/, '').trim()
    if (label) labels.push(label)
  }
  const unique = [...new Set(labels)]
  return unique.length >= 2 ? unique : [title.slice(0, 40) || 'FinScript', 'ANALYSIS', 'KEY TAKEAWAY']
}

/**
 * Extracts the FULL text of each `[bracketed cinematic direction]` in the script, in order,
 * as rich image-generation prompts. Unlike `extractCards` (which caps brackets at 40 chars
 * because it uses them as short ON-SCREEN labels), this keeps the entire direction — e.g.
 * "[Cinematic extreme close-up of a stressed investor's glasses reflecting a crashing red
 * ticker…]" — so the generated AI image actually FOLLOWS the writer's shot description
 * instead of a 5-word snippet of narration. Exact duplicates are collapsed; order is kept.
 * Returns [] when the script has no bracketed directions (caller then derives scenes from prose).
 */
export function extractScenePrompts(body: string): string[] {
  const prompts: string[] = []
  const seen = new Set<string>()
  // Match a bracketed block that may span multiple lines; [^\]] keeps it to a single [...] group.
  const re = /\[\s*([^\]]{8,})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    prompts.push(text)
  }
  return prompts
}

/** Removes characters that are painful inside drawtext; card text is short so this is safe. */
function sanitizeCard(text: string): string {
  return text.replace(/[^A-Za-z0-9 ,.!?%&/-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

export interface RenderOptions {
  title: string
  body: string
  audioPath: string
  durationSec: number
  outPath: string
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: VideoAspect
  /** Optional background music file, mixed (volume-lowered, faded) under the narration. */
  musicPath?: string
  /** Add a soft whoosh at each section transition. */
  soundEffects?: boolean
  /** Visual style (preset engine). Defaults to cinematic. */
  style?: VideoStyle
  /** Graphics v2 finishing template (grade/vignette/grain/letterbox/animated title). */
  template?: VideoTemplate
  /** Optional user image paths for a Ken-Burns slideshow background. */
  images?: string[]
  /** Per-image pacing/transitions (wins over `images` when present — see shared types). */
  imageShots?: ImageShot[]
  /** false = clean build: no title overlay, no section cards (nothing drawn over the picture). */
  textOverlays?: boolean
  /** A pre-rendered background video (e.g. assembled stock footage). Takes precedence. */
  backgroundVideo?: string
  /** Animated moving-gradient background (default true). Set false for a flat color. */
  animatedBg?: boolean
  onLog?: (line: string) => void
  /** Coarse, user-facing status notices (e.g. encoder choice / CPU fallback / % done). */
  onProgress?: (stage: string) => void
  /** Called once with a small preview PNG of the opening frame, so the UI can show the
   * look immediately instead of waiting for the whole render. Best-effort. */
  onPreview?: (pngPath: string) => void
}

/**
 * Renders a single small PNG of the opening frame of the chosen background, so the UI
 * can show what the video looks like right away. Cheap even at 8K (one downscaled
 * frame). Best-effort — never throws into the build.
 */
async function renderPreviewFrame(bg: BackgroundSpec, layout: Layout, previewPath: string): Promise<void> {
  const input =
    bg.kind === 'file'
      ? ['-i', bg.path]
      : bg.kind === 'animated'
        ? ['-f', 'lavfi', '-i', bg.source]
        : ['-f', 'lavfi', '-i', `color=c=${bg.color}:s=${layout.w}x${layout.h}:d=1`]
  await runFfmpeg(['-y', ...input, '-frames:v', '1', '-vf', 'scale=640:-2', previewPath])
}

/** The distinct Ken-Burns camera moves we cycle through, so consecutive shots differ. */
export type KenBurnsMotion = 'zoom-in' | 'pan-right' | 'zoom-out' | 'pan-left'
export const KEN_BURNS_MOTIONS: KenBurnsMotion[] = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left']

/**
 * The `zoompan=…` expression for one Ken-Burns move. All four are validated to run
 * with the bundled ffmpeg. Uses `on` (output frame) so motion is deterministic, and
 * `pzoom` for a smooth zoom-out. Pure + unit-tested.
 */
export function zoompanExpr(motion: KenBurnsMotion, frames: number, w: number, h: number): string {
  const common = `d=${frames}:s=${w}x${h}:fps=25`
  const center = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
  switch (motion) {
    case 'zoom-in':
      return `zoompan=z='min(1.0+0.0015*on,1.5)':${center}:${common}`
    case 'zoom-out':
      return `zoompan=z='if(lte(on,0),1.5,max(1.0,pzoom-0.0015))':${center}:${common}`
    case 'pan-right':
      return `zoompan=z='1.25':x='(iw-iw/zoom)*min(on/${frames},1)':y='ih/2-(ih/zoom/2)':${common}`
    case 'pan-left':
      return `zoompan=z='1.25':x='(iw-iw/zoom)*(1-min(on/${frames},1))':y='ih/2-(ih/zoom/2)':${common}`
  }
}

export interface SlideshowShot {
  imageIndex: number
  motion: KenBurnsMotion
  /** Visible seconds for this shot (custom pacing). Absent = equal split. */
  seconds?: number
  /** Visual transition INTO this shot from the previous one (custom pacing). */
  transition?: SceneTransition
}

/**
 * Plans the shots for a slideshow. The key fix for "the same 3 images going back and
 * forth": instead of one static shot per image, we cut a shot roughly every ~6 seconds
 * and give each a DIFFERENT camera move (cycling zoom-in / pan-right / zoom-out /
 * pan-left), reusing images round-robin. So even 3 images over a minute become ~10
 * distinct, moving shots that feel alive rather than a slow ping-pong. Pure + tested.
 */
export function planSlideshowShots(imageCount: number, durationSec: number): SlideshowShot[] {
  const imgs = Math.max(1, imageCount)
  // The image floor must WIN over the 12-shot pacing cap: with the old
  // min(12, max(imgs, …)) ordering, a 30-image build silently discarded every
  // image past the 12th — images the app had just spent minutes generating.
  const target = Math.max(imgs, Math.min(12, Math.round(Math.max(1, durationSec) / 6)))
  // Shot lengths TIGHTEN toward the end instead of every shot getting an equal slice.
  // The last third of a finance video is where people leave, and an even 6-6-6 split
  // makes the end feel exactly as slow as the beginning when it needs to feel faster.
  // `pace` normalises its weights so the seconds still sum to the full duration — the
  // narration must stay in sync, which is why the total is preserved exactly rather
  // than approximately.
  const paced = pace(durationSec, target)
  const shots: SlideshowShot[] = []
  for (let i = 0; i < target; i++) {
    shots.push({
      imageIndex: i % imgs,
      motion: KEN_BURNS_MOTIONS[i % KEN_BURNS_MOTIONS.length],
      seconds: paced[i]?.seconds
    })
  }
  return shots
}

/**
 * Plans shots from the USER's per-scene pacing (Scene Studio): every image exactly
 * once, in order — no 12-shot cap, no round-robin. The user's seconds are WEIGHTS:
 * they're scaled so the total exactly matches the narration length (so speech never
 * gets cut off), with a small floor so no shot collapses to nothing. Pure + tested.
 */
export function planCustomShots(
  wanted: { seconds?: number; transition?: SceneTransition }[],
  durationSec: number
): SlideshowShot[] {
  const n = Math.max(1, wanted.length)
  const dur = Math.max(1, durationSec)
  const weights = wanted.map((w) => (w.seconds && w.seconds > 0 ? w.seconds : dur / n))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  return wanted.map((w, i) => ({
    imageIndex: i,
    motion: KEN_BURNS_MOTIONS[i % KEN_BURNS_MOTIONS.length],
    seconds: Math.max(0.8, (weights[i] / total) * dur),
    transition: i === 0 ? undefined : w.transition
  }))
}

/**
 * Builds the ffmpeg filter graph for a slideshow with per-shot seconds and xfade
 * transitions. Chained-xfade bookkeeping (all pure, so it's unit-testable):
 * visible lengths v_i sum to the narration length; each shot's STREAM is v_i plus the
 * overlap consumed by the transition into the NEXT shot (t_{i+1}); the k-th xfade
 * starts at offset Σ_{j≤k} v_j. Net result length = Σv — speech and picture end together.
 * 'cut' is a 1-frame fade (visually identical to a hard cut, keeps one code path).
 */
export function buildCustomSlideshowFilter(
  shots: SlideshowShot[],
  layout: Layout,
  fps = 25
): { filter: string; outLabel: string } {
  const n = shots.length
  const v = shots.map((s) => Math.max(0.8, s.seconds ?? 4))
  // Transition INTO shot i (i>=1), clamped so it can't eat a whole shot.
  const t = shots.map((s, i) => {
    if (i === 0) return 0
    const kind = s.transition ?? 'cut'
    const want = kind === 'cut' ? 1 / fps : 0.5
    return Math.min(want, 0.4 * Math.min(v[i - 1], v[i]))
  })
  const segs = shots.map((shot, i) => {
    const streamLen = v[i] + (i < n - 1 ? t[i + 1] : 0)
    const frames = Math.max(1, Math.round(streamLen * fps))
    return (
      `[${i}:v]scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,` +
      `crop=${layout.w}:${layout.h},setsar=1,${zoompanExpr(shot.motion, frames, layout.w, layout.h)}[s${i}]`
    )
  })
  if (n === 1) return { filter: `${segs[0]}`, outLabel: '[s0]' }
  const chains: string[] = []
  let acc = 0 // Σ visible lengths so far = the next xfade's offset
  let prev = 's0'
  for (let i = 1; i < n; i++) {
    acc += v[i - 1]
    const kind = shots[i].transition && shots[i].transition !== 'cut' ? shots[i].transition : 'fade'
    const dur = Math.max(1 / fps, t[i])
    const out = i === n - 1 ? 'vout' : `x${i}`
    chains.push(`[${prev}][s${i}]xfade=transition=${kind}:duration=${dur.toFixed(3)}:offset=${acc.toFixed(3)}[${out}]`)
    prev = out
  }
  return { filter: `${segs.join(';')};${chains.join(';')}`, outLabel: '[vout]' }
}

/**
 * Turns per-shot seconds into per-shot FRAME counts that sum to exactly the right total.
 *
 * Rounding each shot independently loses up to half a frame per shot, and a twelve-shot
 * video is then several frames short of its own narration — small, but it is the same
 * class of drift that ends with audio running past picture. So the remainder is carried
 * and the leftover frames go to the longest shots, where one extra frame shows least.
 *
 * A missing or nonsensical seconds value falls back to an equal share rather than
 * throwing: a shot with no length is a planning gap, not a reason to lose the render.
 */
export function framesForShots(secondsList: (number | undefined)[], dur: number, fps: number): number[] {
  const n = secondsList.length
  if (!n) return []
  const totalFrames = Math.max(n, Math.round(Math.max(1, dur) * Math.max(1, fps)))
  const clean = secondsList.map((s) => (typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null))
  const sum = clean.reduce((a: number, b) => a + (b ?? 0), 0)
  const weights = clean.map((s) => (sum > 0 && s !== null ? s / sum : 1 / n))
  // Every shot needs at least one frame, or zoompan emits nothing at all for it.
  const counts = weights.map((w) => Math.max(1, Math.floor(totalFrames * w)))
  let remainder = totalFrames - counts.reduce((a, b) => a + b, 0)
  const longestFirst = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c)
  for (let k = 0; remainder > 0; k = (k + 1) % longestFirst.length) {
    counts[longestFirst[k].i]++
    remainder--
  }
  // An overshoot can only come from the one-frame floor, so it comes back off the
  // longest shots — and never below one frame, which would drop a shot entirely.
  for (let guard = 0; remainder < 0 && guard < totalFrames + n; guard++) {
    const victim = longestFirst.find(({ i }) => counts[i] > 1)
    if (!victim) break
    counts[victim.i]--
    remainder++
  }
  return counts
}

/**
 * Renders a Ken-Burns slideshow of the given images to `outPath` at the layout size
 * for `dur` seconds. Each shot cover-scales, crops to frame, then applies a varied
 * camera move (see planSlideshowShots). Pure ffmpeg — no paid service.
 */
export async function makeSlideshow(
  images: string[],
  layout: Layout,
  dur: number,
  outPath: string,
  custom?: { seconds?: number; transition?: SceneTransition }[]
): Promise<void> {
  // USER-PACED path (Scene Studio per-scene seconds/transitions): every image once,
  // in order, xfade transitions, total locked to the narration length.
  if (custom && custom.length === images.length && custom.length > 0) {
    const shots = planCustomShots(custom, dur)
    const { filter, outLabel } = buildCustomSlideshowFilter(shots, layout)
    const inputs: string[] = []
    shots.forEach((shot) => inputs.push('-i', images[shot.imageIndex]))
    await runFfmpeg([
      '-y',
      ...inputs,
      '-filter_complex',
      filter,
      '-map',
      outLabel,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '25',
      outPath
    ])
    return
  }
  const shots = planSlideshowShots(images.length, dur)
  const n = shots.length
  const fps = 25
  // Per-shot frame counts, so the tightening pacing from planSlideshowShots actually
  // reaches the picture. The old code computed ONE `slot = dur / n` and gave every shot
  // the same length, which is why every video paced identically from start to finish.
  const frameCounts = framesForShots(
    shots.map((s) => s.seconds),
    dur,
    fps
  )
  const inputs: string[] = []
  shots.forEach((shot) => {
    // Feed EXACTLY ONE frame per shot; zoompan (below, d=frames) expands that single
    // frame into `frames` output frames. The old `-loop 1 -t <slot>` fed slot*fps input
    // frames and zoompan emits `d` frames PER input frame → a ~100x frame EXPLOSION
    // (measured: 10,000 frames / 400s for a 4s shot). That made every render run far past
    // the narration length and crash ffmpeg with code 4294967295. One input frame + d=frames
    // yields exactly the intended duration.
    inputs.push('-i', images[shot.imageIndex])
  })
  const segs = shots.map((shot, i) =>
    `[${i}:v]scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,` +
    `crop=${layout.w}:${layout.h},setsar=1,${zoompanExpr(shot.motion, frameCounts[i], layout.w, layout.h)}[s${i}]`
  )
  const concatInputs = shots.map((_, i) => `[s${i}]`).join('')
  const filter = `${segs.join(';')};${concatInputs}concat=n=${n}:v=1:a=0[v]`
  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    outPath
  ])
}

/** Generates a short, soft "whoosh" transition sound (pink-noise swish). Free — no files. */
async function makeWhoosh(outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=0.35:c=pink:r=44100',
    '-af',
    'afade=t=in:d=0.03,afade=t=out:st=0.15:d=0.2,lowpass=f=2500,volume=0.9',
    outPath
  ])
}

/**
 * Renders an H.264 / AAC MP4 (YouTube-accepted) at 1080p/1440p/4K/8K: a dark
 * studio background, a persistent title, section cards that cycle in time with
 * the narration, an audio-reactive waveform, optional background music (faded &
 * ducked), and optional transition sound effects. All ffmpeg — no paid service.
 */
export async function renderVideo(opts: RenderOptions): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-video-'))
  try {
    const layout = computeLayout(opts.resolution, opts.aspect)
    const theme = themeFor(opts.style)
    const titleFont = Math.round(layout.titleFont * theme.fontScale)
    const cardFont = Math.round(layout.cardFont * theme.fontScale)
    const cards = extractCards(opts.body, opts.title).map(sanitizeCard).filter(Boolean)
    // Never let cards be empty: slot = dur/cards.length would become Infinity/NaN and every
    // enable='between(t,…)' expression would be invalid → an ffmpeg parse error.
    if (cards.length === 0) cards.push(sanitizeCard(opts.title) || 'ANALYSIS')
    const dur = Math.max(1, opts.durationSec)

    const titleFile = join(scratch, 'title.txt')
    writeFileSync(titleFile, sanitizeCard(opts.title) || 'FINSCRIPT STUDIO', 'utf-8')

    const font = fontArg()
    const slot = dur / cards.length

    // SFX at each transition (start of cards 1..N-1), only when enabled.
    const sfxTimesSec = opts.soundEffects ? cards.slice(1).map((_, i) => (i + 1) * slot) : []
    let whooshPath: string | undefined
    if (sfxTimesSec.length) {
      whooshPath = join(scratch, 'whoosh.wav')
      await makeWhoosh(whooshPath)
    }

    // Background: a Ken-Burns slideshow of the user's images if provided; otherwise a
    // themed animated moving gradient (richer than a flat color), unless explicitly
    // turned off (then a solid themed color).
    let background: BackgroundSpec =
      opts.animatedBg === false
        ? { kind: 'color', color: theme.bgColor }
        : { kind: 'animated', source: buildGradientSource(theme, layout.w, layout.h, dur) }
    // Set only for footage backgrounds — see the comment where it is assigned.
    let footageZoom: string | null = null
    const slideshowImages = opts.imageShots?.length ? opts.imageShots.map((s) => s.path) : opts.images
    if (opts.backgroundVideo) {
      // Pre-assembled footage (stock B-roll, or generated clips) — use it directly.
      //
      // Footage was the one background that sat completely still. Stills already get
      // Ken-Burns moves through makeSlideshow; a video clip got nothing, and a locked-off
      // frame for a whole minute is the single thing that most makes a video look cheap.
      // planShots cuts it into wide/mid/close beats with a slow push in or pull out on
      // each, alternating direction so it never creeps one way for the whole video.
      background = { kind: 'file', path: opts.backgroundVideo }
      footageZoom = buildAutoZoomFilter(planShots({ durationSec: dur, boundaries: sfxTimesSec }), layout.w, layout.h, 25)
    } else if (slideshowImages && slideshowImages.length) {
      // One corrupt/truncated image must not abort the whole build — fall back to the
      // animated gradient (the storyboard path already does this; the main path didn't).
      try {
        const bgPath = join(scratch, 'bg.mp4')
        await makeSlideshow(
          slideshowImages,
          layout,
          dur,
          bgPath,
          opts.imageShots?.length ? opts.imageShots.map((s) => ({ seconds: s.seconds, transition: s.transition })) : undefined
        )
        background = { kind: 'file', path: bgPath }
      } catch (err) {
        opts.onProgress?.(`Slideshow failed (${err instanceof Error ? err.message : 'error'}) — using the animated look instead.`)
      }
    }

    // Best-effort opening-frame preview so the UI shows the look immediately.
    if (opts.onPreview) {
      const previewPath = `${opts.outPath}.preview.png`
      try {
        await renderPreviewFrame(background, layout, previewPath)
        opts.onPreview(previewPath)
      } catch {
        /* preview is optional — never block the build */
      }
    }

    const audio = buildAudioFilter({ hasMusic: !!opts.musicPath, sfxTimesSec, dur, layout, waveColor: theme.waveColor })
    const chains: string[] = [...audio.chains]

    // Persistent title near the top. (Windows ffmpeg quirk: both fontfile and
    // textfile must be single-quoted with escaped colon, else "both text and
    // textfile". Timeline expressions are single-quoted so commas stay literal.)
    const tpl = templateFor(opts.template)
    // "Clean copy": nothing drawn over the picture — no title, no section cards.
    // The waveform stays (it's decoration, not text) and the finishing look stays.
    const showText = opts.textOverlays !== false

    // The slow camera move on footage goes FIRST, before any text is drawn. Zooming
    // after the title was drawn would zoom the title too — it would drift and soften
    // along with the picture, which is exactly the amateur look this is meant to remove.
    let base = '0:v'
    if (footageZoom) {
      chains.push(`[0:v]${footageZoom}[bgz]`)
      base = 'bgz'
    }

    if (showText) {
      const titleAlpha = tpl.animateTitle ? `:alpha='${titleAlphaExpr()}'` : ''
      chains.push(
        // expansion=none: drawtext expands %-sequences even in a textfile, so a headline
        // like "OIL UP 40%!" kills the whole build with "Stray %". Nothing here uses
        // text expansion, so it is switched off rather than escaped around.
        `[${base}]drawtext=expansion=none:fontfile='${font}':textfile='${fileArg(titleFile)}':fontcolor=${theme.titleColor}:fontsize=${titleFont}:x=(w-tw)/2:y=${layout.titleY}${titleAlpha}[v0]`
      )
      chains.push(`[v0][wave]overlay=x=0:y=H-h-${layout.waveMargin}[v1]`)
    } else {
      chains.push(`[${base}][wave]overlay=x=0:y=H-h-${layout.waveMargin}[v1]`)
    }

    let prev = 'v1'
    if (showText) cards.forEach((card, i) => {
      const cardFile = join(scratch, `card${i}.txt`)
      writeFileSync(cardFile, card, 'utf-8')
      const start = i * slot
      const s = start.toFixed(2)
      const end = (i === cards.length - 1 ? dur : (i + 1) * slot).toFixed(2)
      const next = `c${i}`
      const alpha = `if(lt(t,${s}),0,if(lt(t,${(start + 0.6).toFixed(2)}),(t-${s})/0.6,1))`

      if (tpl.lowerThird) {
        // Broadcast-style animated LOWER-THIRD: an accent bar + label slide in from the left.
        const barW = Math.round(layout.w * 0.42)
        const barH = Math.round(layout.h * 0.085)
        const barY = layout.h - Math.round(layout.h * 0.17)
        const travel = barW + 120
        const slide = `min((t-${s})/0.4,1)`
        const bar = `b${i}`
        chains.push(
          `[${prev}]drawbox=x='${-barW - 40}+${travel}*${slide}':y=${barY}:w=${barW}:h=${barH}:color=${tpl.accent}@0.92:t=fill:` +
            `enable='between(t,${s},${end})'[${bar}]`
        )
        chains.push(
          `[${bar}]drawtext=expansion=none:fontfile='${font}':textfile='${fileArg(cardFile)}':fontcolor=${theme.bgColor}:fontsize=${Math.round(cardFont * 0.5)}:` +
            `x='${-barW}+${travel}*${slide}':y=${barY + Math.round(barH * 0.28)}:enable='between(t,${s},${end})'[${next}]`
        )
      } else {
        // Kinetic centered card: fade in while sliding up ~40px.
        const y = `(h-th)/2 + 40*(1-min((t-${s})/0.6,1))`
        chains.push(
          `[${prev}]drawtext=expansion=none:fontfile='${font}':textfile='${fileArg(cardFile)}':fontcolor=${theme.cardColor}:fontsize=${cardFont}:` +
            `x=(w-tw)/2:y='${y}':alpha='${alpha}':enable='between(t,${s},${end})'[${next}]`
        )
      }
      prev = next
    })

    // Graphics v2 finishing: colour-grade / vignette / grain / letterbox for the template.
    const fin = finishingChain(tpl, prev, 'vfinal', layout.w, layout.h)
    if (fin) chains.push(fin)
    const videoMapLabel = fin ? '[vfinal]' : `[${prev}]`

    // Pick the fastest SAFE path: GPU for big/long jobs within hardware limits (where
    // it wins), CPU otherwise. 8K exceeds every consumer GPU's H.264 limit, so it uses
    // the CPU encoder here — and runEncodeWithFallback retries on CPU if any GPU encode
    // still fails at runtime, so a video always renders.
    const encoder = await chooseEncoderForJob(layout.w, layout.h, dur)
    const note = `Encoding via ${encoderLabel(encoder)}${isHardware(encoder) ? ' — hardware accelerated ⚡' : ''}`
    opts.onLog?.(note)
    opts.onProgress?.(note)

    const filter = chains.join(';')
    const buildArgs = (videoEncoderArgs: string[]): string[] =>
      buildFfmpegArgs({
        layout,
        dur,
        audioPath: opts.audioPath,
        musicPath: opts.musicPath,
        sfxCount: sfxTimesSec.length,
        whooshPath,
        filter,
        videoMap: videoMapLabel,
        audioMap: audio.audioMap,
        outPath: opts.outPath,
        background,
        videoEncoderArgs
      })
    // Parse ffmpeg's live "time=" so the UI shows a real percentage every second,
    // instead of a single "Rendering…" line until the very end (shared helper).
    const handleLog = makeFfmpegProgressLogger(dur, opts.onProgress, opts.onLog)
    await runEncodeWithFallback(encoder, buildArgs, { onLog: handleLog, onNotice: opts.onProgress })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Replaces a finished video's audio track with a user-recorded voice file
 * (re-encoding audio to AAC, copying the video stream). Output is a fresh MP4.
 */
export async function attachVoiceover(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ])
}
