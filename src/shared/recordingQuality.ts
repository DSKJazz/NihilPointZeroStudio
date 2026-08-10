/**
 * The numbers that decide whether a recording looks like a camera or like a phone.
 *
 * THE ACTUAL PROBLEM
 * Resolution is what everyone reaches for, and it is not the thing that gives a phone
 * recording away. Browsers default `MediaRecorder` to roughly 2.5 Mbit/s no matter what
 * you hand it, which is about a third of what 1080p needs and a fifteenth of what 4K
 * needs. Record 4K at the default and you get a soft, blocky 4K file — bigger than
 * 1080p and visibly worse than a plain camera. Setting the bitrate correctly is the
 * single biggest quality lever there is, and it costs nothing.
 *
 * WHERE THE NUMBERS COME FROM
 * The anchors below are YouTube's own recommended upload bitrates for SDR video. That
 * is deliberate: these videos are going to YouTube, and matching what YouTube asks for
 * means its re-encode starts from a clean source instead of trying to rescue a
 * starved one. Nothing here is a guess — every anchor is a published figure, and
 * everything between them is interpolated by pixel count.
 *
 *   height   30 fps    60 fps
 *   720p     5 Mbps    7.5 Mbps
 *   1080p    8 Mbps    12 Mbps
 *   1440p    16 Mbps   24 Mbps
 *   2160p    45 Mbps   68 Mbps
 *
 * Every 60 fps figure is exactly 1.5x its 30 fps figure, which is where the frame-rate
 * rule below comes from.
 */

export type QualityTier = 'balanced' | 'youtube' | 'master'
export type CaptureContent = 'camera' | 'screen'

export interface QualityChoice {
  id: QualityTier
  label: string
  detail: string
}

export const QUALITY_TIERS: QualityChoice[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Smaller files, still clean. Good when storage or the upload is tight.'
  },
  {
    id: 'youtube',
    label: 'YouTube quality',
    detail: "Exactly what YouTube asks uploads to be. This is the right choice almost always."
  },
  {
    id: 'master',
    label: 'Master',
    detail: 'Well above what YouTube needs, for footage you will cut and re-export.'
  }
]

/** Multipliers applied to the YouTube anchor rate. `youtube` is 1.0 by definition. */
const TIER_FACTOR: Record<QualityTier, number> = {
  balanced: 0.6,
  youtube: 1,
  master: 1.8
}

/**
 * Screen capture is given more because the failure mode is different: small text goes
 * mushy long before a face does, and mushy text in a tutorial is unusable.
 */
const CONTENT_FACTOR: Record<CaptureContent, number> = {
  camera: 1,
  screen: 1.25
}

/** YouTube's published anchors, as (16:9 pixel count, bits per second at 30 fps). */
const ANCHORS: { pixels: number; bps: number }[] = [
  { pixels: 1280 * 720, bps: 5_000_000 },
  { pixels: 1920 * 1080, bps: 8_000_000 },
  { pixels: 2560 * 1440, bps: 16_000_000 },
  { pixels: 3840 * 2160, bps: 45_000_000 }
]

export const RESOLUTIONS: { label: string; height: number; note: string }[] = [
  { label: '720p', height: 720, note: 'Small files. Fine for a talking head on a phone screen.' },
  { label: '1080p', height: 1080, note: 'What most YouTube videos are. Safe everywhere.' },
  { label: '1440p', height: 1440, note: 'Noticeably sharper on a big screen.' },
  { label: '4K', height: 2160, note: 'Best, and lets you crop or zoom later without losing detail.' },
  // Kept because the Recorder has always offered it. Almost nothing can genuinely
  // record 8K, and a camera that cannot hands back its real best instead — which the
  // Recorder then reports honestly rather than pretending. Above the last anchor the
  // rate holds 4K's bits-per-pixel steady, which lands 8K30 at 180 Mbps.
  { label: '8K', height: 4320, note: 'Only if your camera really does it. Enormous files.' }
]

export const FRAME_RATES: { label: string; fps: number; note: string }[] = [
  { label: '24 fps', fps: 24, note: 'Cinematic. Slightly softer motion.' },
  { label: '30 fps', fps: 30, note: 'The normal choice for talking to camera.' },
  { label: '60 fps', fps: 60, note: 'Smoothest. Best for screens, movement and gaming.' }
]

/** Width for a height, at 16:9, always even (encoders reject odd dimensions). */
export function widthFor(height: number): number {
  return Math.round((height * 16) / 9 / 2) * 2
}

/** The 30 fps anchor rate for any height, interpolated by pixel count. */
function baseBitrateAt30(height: number): number {
  const pixels = Math.max(1, widthFor(height) * height)
  const first = ANCHORS[0]
  const last = ANCHORS[ANCHORS.length - 1]
  // Below and above the table, hold the nearest anchor's bits-per-pixel steady rather
  // than extrapolating a curve nobody published.
  if (pixels <= first.pixels) return (first.bps * pixels) / first.pixels
  if (pixels >= last.pixels) return (last.bps * pixels) / last.pixels
  for (let i = 1; i < ANCHORS.length; i++) {
    const lo = ANCHORS[i - 1]
    const hi = ANCHORS[i]
    if (pixels <= hi.pixels) {
      const t = (pixels - lo.pixels) / (hi.pixels - lo.pixels)
      return lo.bps + t * (hi.bps - lo.bps)
    }
  }
  return last.bps
}

/**
 * Frame rate scales the rate by exactly the ratio YouTube's own table uses: 60 fps
 * costs 1.5x what 30 fps costs, and everything else is linear in between. NOT double —
 * consecutive frames are similar, so twice the frames is nowhere near twice the bits.
 */
export function frameRateFactor(fps: number): number {
  const clamped = Math.min(Math.max(fps, 1), 120)
  return 1 + (0.5 * (clamped - 30)) / 30
}

export interface BitrateInput {
  height: number
  fps: number
  tier: QualityTier
  content: CaptureContent
}

/** Video bits per second to hand to MediaRecorder. Rounded to a whole kbit. */
export function videoBitrate({ height, fps, tier, content }: BitrateInput): number {
  const bps =
    baseBitrateAt30(height) * frameRateFactor(fps) * TIER_FACTOR[tier] * CONTENT_FACTOR[content]
  // Floor at 1 Mbit: below that even a slideshow falls apart, and no tier should be
  // able to multiply its way down there.
  return Math.max(1_000_000, Math.round(bps / 1000) * 1000)
}

/**
 * Audio. Opus is transparent for speech well below these, but narration is the whole
 * product here and the bytes are trivial next to the video.
 */
export function audioBitrate(tier: QualityTier): number {
  return { balanced: 128_000, youtube: 192_000, master: 256_000 }[tier]
}

/** Roughly how big the file will be, so nobody is surprised by a 12 GB recording. */
export function estimateBytes(videoBps: number, audioBps: number, seconds: number): number {
  return Math.round(((videoBps + audioBps) / 8) * Math.max(0, seconds))
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Containers and codecs, best first.
 *
 * H.264 leads deliberately. Phones and most laptops encode it in dedicated hardware,
 * which at 1080p60 and 4K is the difference between a smooth recording and one that
 * silently drops frames while the CPU melts. It is also what the file is transcoded to
 * afterwards, so starting there turns a re-encode into a copy. VP9 is a good software
 * fallback; plain webm is the last resort that every browser has.
 */
export const VIDEO_MIME_PREFERENCE = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

/** Audio-only, for narrating without showing your face. */
export const AUDIO_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm'
]

/**
 * `isSupported` is injected rather than read from MediaRecorder directly so this stays
 * a pure function — which is the only way to test the ordering.
 */
export function pickMime(preference: string[], isSupported: (type: string) => boolean): string | undefined {
  for (const type of preference) {
    try {
      if (isSupported(type)) return type
    } catch {
      // A browser that throws on an odd codec string is telling us "no".
    }
  }
  return undefined
}

/** File extension implied by a chosen MIME type. */
export function extensionFor(mime: string | undefined): string {
  if (!mime) return 'webm'
  if (mime.startsWith('video/mp4') || mime.startsWith('audio/mp4')) return 'mp4'
  if (mime.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}

/**
 * Camera constraints. `ideal`, never `exact`: a phone that cannot do 4K should hand
 * back its best instead of refusing to record at all, which is what `exact` does.
 */
export function videoConstraints(
  height: number,
  fps: number,
  opts: { deviceId?: string; facing?: 'user' | 'environment' } = {}
): MediaTrackConstraints {
  return {
    deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
    facingMode: opts.facing ? { ideal: opts.facing } : undefined,
    width: { ideal: widthFor(height) },
    height: { ideal: height },
    frameRate: { ideal: fps }
  }
}

/**
 * What the camera ACTUALLY gave, which is often not what was asked for. Worth showing:
 * "you asked for 4K, this phone gave 1080p" is the difference between a user trusting
 * the app and quietly wondering why their footage looks soft.
 */
export function describeActual(settings: { width?: number; height?: number; frameRate?: number }): string {
  const h = settings.height
  const w = settings.width
  const f = settings.frameRate
  if (!h || !w) return 'Camera started.'
  const name = RESOLUTIONS.find((r) => r.height === h)?.label ?? `${h}p`
  return `Recording at ${w}x${h} (${name})${f ? `, ${Math.round(f)} fps` : ''}.`
}
