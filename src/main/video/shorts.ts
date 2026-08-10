/**
 * MAKE SHORTS — turn one long video into several vertical (9:16) short clips with
 * burned-in captions, ready for YouTube Shorts / TikTok / Reels.
 *
 * The pipeline reuses what the studio already has: the offline Whisper transcript
 * (../speech) gives sentence-level segments with timings; this file is the PURE,
 * unit-tested layer that (a) scores and picks the best moments, and (b) builds the
 * ffmpeg args to cut + crop + caption them. Nothing here touches the network.
 */
import { escapeSubtitlesPath, type CaptionSegment } from './captions'

/** One chosen short: a window of the source video plus the lines spoken in it. */
export interface ShortMoment {
  startSec: number
  endSec: number
  /** Caption segments re-based so the clip starts at 0. */
  captions: CaptionSegment[]
  /** First words of the clip — used for its title. */
  title: string
  /** Why this moment was picked (shown to the user, so the choice isn't a black box). */
  reason: string
  /** Relative strength of the moment (higher = stronger hook). */
  score: number
}

export interface PickOptions {
  /** How many shorts to produce (default 3). */
  count?: number
  /** Target clip length window in seconds (default 20–60). */
  minSec?: number
  maxSec?: number
}

/**
 * Words and shapes that mark a strong short-form hook. Deliberately simple and
 * inspectable: no AI call, so picking moments is free, instant and offline.
 */
const HOOK_WORDS = [
  'but', 'actually', 'never', 'always', 'nobody', 'everyone', 'secret', 'mistake',
  'why', 'how', 'truth', 'wrong', 'billion', 'million', 'crore', 'lakh', 'percent',
  'crash', 'surge', 'boom', 'collapse', 'warning', 'danger', 'profit', 'loss',
  'remember', 'imagine', 'listen', 'here is', 'the reason', 'most people',
  // ROMAN URDU. This channel is spoken in mixed Roman Urdu and English, so an
  // English-only list was blind to roughly half of every script's best moments —
  // the contradiction ("lekin", "magar", "asal", "haqiqat"), the question ("kyun",
  // "kaise"), the stake ("aap", "nuqsan", "faida"), the urgency ("abhi", "aaj").
  'lekin', 'magar', 'asal', 'haqiqat', 'kyun', 'kyu', 'kaise', 'kya',
  'aap', 'apna', 'apki', 'nuqsan', 'faida', 'abhi', 'aaj', 'fisad', 'feesad',
  'arab', 'kharab', 'maslah', 'wajah',
  // Named institutions: specific, checkable, and they signal a real claim.
  'state bank', 'sbp', 'psx', 'kse', 'nccpl', 'imf', 'fbr', 'secp'
]

/**
 * Housekeeping. Never the opening line of a Short, whatever else it scores.
 *
 * Without this, "Subscribe today and you could save 50 percent right now" scores well
 * — it has a hook word, a number and urgency — and a Short that opens with a plug is
 * dead on arrival. The override has to beat every other rule, not just subtract from
 * them, which is why it returns immediately.
 */
const BOILERPLATE =
  /\b(?:subscribe|like and share|as i (?:said|mentioned)|in (?:this|today'?s) video|welcome back|link in (?:the )?description|hit the bell|channel ko)\b/i

/** Scores one segment as the OPENING line of a short. Pure. */
export function scoreSegment(text: string): { score: number; reason: string } {
  if (BOILERPLATE.test(text)) return { score: -100, reason: 'housekeeping — never opens a short' }
  const t = text.toLowerCase()
  let score = 0
  const reasons: string[] = []
  const hits = HOOK_WORDS.filter((w) => t.includes(w))
  if (hits.length) {
    score += Math.min(3, hits.length) * 2
    reasons.push(`hook words (${hits.slice(0, 3).join(', ')})`)
  }
  if (/\d/.test(t)) {
    score += 2
    reasons.push('has a concrete number')
  }
  if (/\?/.test(text)) {
    score += 2
    reasons.push('opens with a question')
  }
  // Sentences of ~8–30 words carry a complete thought without rambling.
  const words = text.trim().split(/\s+/).length
  if (words >= 8 && words <= 30) {
    score += 1
    reasons.push('well-sized opening line')
  }
  return { score, reason: reasons.length ? reasons.join(' · ') : 'covers a distinct part of the video' }
}

/**
 * Picks the best `count` non-overlapping moments. Each starts on a sentence boundary,
 * grows by whole segments until it fits the target length, and is spread across the
 * source so shorts don't all come from the same minute. Pure + unit-tested.
 */
export function pickShortMoments(segments: CaptionSegment[], opts: PickOptions = {}): ShortMoment[] {
  const count = Math.max(1, opts.count ?? 3)
  const minSec = Math.max(5, opts.minSec ?? 20)
  const maxSec = Math.max(minSec + 5, opts.maxSec ?? 60)
  const usable = segments.filter((s) => s.text.trim() && s.end > s.start)
  if (!usable.length) return []

  // Build a candidate window starting at every segment.
  const candidates: ShortMoment[] = []
  for (let i = 0; i < usable.length; i++) {
    const start = usable[i].start
    const window: CaptionSegment[] = []
    let j = i
    while (j < usable.length && usable[j].end - start <= maxSec) {
      window.push(usable[j])
      j++
    }
    if (!window.length) continue
    const endSec = window[window.length - 1].end
    const length = endSec - start
    // Too short to be a real short (unless it's all the video has).
    if (length < minSec && i > 0) continue
    const { score, reason } = scoreSegment(usable[i].text)
    // Slight bonus for landing near the ideal ~35s length.
    const lengthFit = 1 - Math.min(1, Math.abs(length - 35) / 35)
    candidates.push({
      startSec: start,
      endSec,
      captions: window.map((s) => ({ text: s.text, start: s.start - start, end: s.end - start })),
      title: usable[i].text.trim().split(/\s+/).slice(0, 8).join(' ').replace(/[.,;:]+$/, ''),
      reason,
      score: score + lengthFit * 2
    })
  }
  if (!candidates.length) return []

  // Greedily take the strongest, skipping anything that overlaps an already-chosen clip.
  const chosen: ShortMoment[] = []
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= count) break
    const overlaps = chosen.some((k) => c.startSec < k.endSec && c.endSec > k.startSec)
    if (!overlaps) chosen.push(c)
  }
  return chosen.sort((a, b) => a.startSec - b.startSec)
}

/** The Windows Fonts dir, escaped for the subtitles filter's `fontsdir=`. */
function fontsDirArg(): string {
  return `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts`.replace(/\\/g, '/').replace(/:/g, '\\:')
}

export interface ShortRenderSpec {
  srcPath: string
  outPath: string
  startSec: number
  endSec: number
  /** Path to the clip's .srt (already re-based to the clip's own timeline). */
  srtPath?: string
  /** Output height; width is derived 9:16 (default 1920 → 1080x1920). */
  height?: number
}

/**
 * ffmpeg args to cut one moment and reframe it vertically (9:16) with big, centred
 * captions in the short-form style. Crops the middle of the frame — for talking-head and
 * b-roll footage that keeps the subject — then scales to exactly 1080x1920. Pure.
 */
export function buildShortArgs(spec: ShortRenderSpec): string[] {
  const h = spec.height ?? 1920
  const w = Math.round((h * 9) / 16 / 2) * 2
  // crop to a 9:16 slice of the source (centred), then scale to the exact target.
  const filters = [
    `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'`,
    `scale=${w}:${h}:flags=lanczos`,
    `setsar=1`
  ]
  if (spec.srtPath) {
    // Short-form caption look: large, bold, high-contrast, sitting above the UI chrome.
    const style = 'FontName=Arial,FontSize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=2,MarginV=180'
    filters.push(
      `subtitles='${escapeSubtitlesPath(spec.srtPath)}':fontsdir='${fontsDirArg()}':force_style='${style}'`
    )
  }
  return [
    '-y',
    '-ss',
    spec.startSec.toFixed(3),
    '-to',
    spec.endSec.toFixed(3),
    '-i',
    spec.srcPath,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    spec.outPath
  ]
}
