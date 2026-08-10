/**
 * Puts the right picture on the right SENTENCE, not the right topic.
 *
 * THE DIFFERENCE, AND IT IS THE WHOLE FEATURE
 * Today a video about the rupee gets rupee-ish visuals spread across it. That is
 * topic-level matching, and it is what makes a video feel like a slideshow with a
 * voice over the top. What holds attention is the picture arriving ON the words:
 * you say "reserves fell to eleven point two billion" and the reserves chart appears
 * exactly there, then leaves when you move on.
 *
 * The gap between those two is not intelligence, it is TIMING. The app already knows
 * what each sentence says and when it is spoken. Nothing was joining the two up.
 *
 * WHY NO AI
 * Matching a sentence to a visual is a lookup, not a judgement: the sentence contains
 * "reserves", the library has a reserves chart, done. Rules mean it is instant, free,
 * offline, identical every run, and — the part that matters on a finance channel —
 * it can never decide a sentence about inflation deserves a picture of a rocket.
 *
 * Bilingual throughout. Half of every script on this channel is Roman Urdu, and a
 * matcher blind to "mehngai" is blind to half the video.
 */

export interface TimedLine {
  startSec: number
  endSec: number
  text: string
}

/** Something the studio can put on screen. */
export interface VisualAsset {
  id: string
  /** Words that should summon it. Matched case-insensitively, whole-word. */
  keywords: string[]
  /** What it is, for the UI. */
  label: string
  /** Lower shows first when two assets tie. */
  priority?: number
}

export interface BrollCue {
  startSec: number
  endSec: number
  assetId: string
  label: string
  /** The word in the narration that summoned it — so the choice is never a mystery. */
  trigger: string
}

/**
 * The concepts this channel actually talks about, in both languages it is spoken in.
 * Used when the caller has no library of its own — it turns the matcher into something
 * useful on day one rather than something that needs configuring first.
 */
export const FINANCE_CONCEPTS: VisualAsset[] = [
  { id: 'rupee', label: 'Rupee / currency', keywords: ['rupee', 'rupees', 'pkr', 'dollar', 'usd', 'exchange rate', 'rupya', 'dollar rate'] },
  { id: 'reserves', label: 'Foreign reserves', keywords: ['reserves', 'reserve', 'import cover', 'zakhair'] },
  { id: 'inflation', label: 'Inflation', keywords: ['inflation', 'cpi', 'prices', 'mehngai', 'mehngayi'] },
  { id: 'interest', label: 'Interest rate', keywords: ['interest rate', 'policy rate', 'discount rate', 'sood', 'shrah'] },
  { id: 'psx', label: 'Stock market', keywords: ['psx', 'kse', 'index', 'stock', 'stocks', 'shares', 'bazaar', 'hissa'] },
  { id: 'imf', label: 'IMF', keywords: ['imf', 'bailout', 'tranche', 'programme', 'program'] },
  { id: 'gold', label: 'Gold', keywords: ['gold', 'sona', 'tola', 'bullion'] },
  { id: 'oil', label: 'Oil / fuel', keywords: ['oil', 'petrol', 'diesel', 'fuel', 'petroleum', 'tel'] },
  { id: 'debt', label: 'Debt', keywords: ['debt', 'loan', 'loans', 'qarz', 'borrowing'] },
  { id: 'budget', label: 'Budget / tax', keywords: ['budget', 'tax', 'taxes', 'fbr', 'revenue', 'tax rate'] },
  { id: 'bank', label: 'State Bank', keywords: ['state bank', 'sbp', 'central bank', 'monetary policy'] },
  { id: 'export', label: 'Trade', keywords: ['exports', 'export', 'imports', 'import', 'trade deficit', 'bara-mad'] }
]

/**
 * Minimum time a picture stays up. Anything shorter is a flash — the viewer registers
 * that something changed without registering what, which is worse than leaving the
 * previous shot alone.
 */
export const MIN_CUE_SEC = 2.5

/**
 * Maximum. Past this the picture stops supporting the words and becomes wallpaper the
 * eye has already finished reading.
 */
export const MAX_CUE_SEC = 9

/** Whole-word match, so "import" does not fire on "important". */
function mentions(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Which asset a single line calls for, if any. */
export function matchLine(text: string, library: VisualAsset[]): { asset: VisualAsset; trigger: string } | null {
  let best: { asset: VisualAsset; trigger: string } | null = null
  let bestScore = Infinity
  for (const asset of library) {
    for (const keyword of asset.keywords) {
      if (!mentions(text, keyword)) continue
      // Longer keywords are more specific: "import cover" should beat "import".
      const score = (asset.priority ?? 0) * 100 - keyword.length
      if (score < bestScore) {
        bestScore = score
        best = { asset, trigger: keyword }
      }
    }
  }
  return best
}

export interface CueOptions {
  /** Total length, so the last cue cannot run past the end of the video. */
  durationSec: number
  minSec?: number
  maxSec?: number
}

/**
 * Turns timed narration into a cue list.
 *
 * Consecutive lines calling for the SAME picture are merged into one cue rather than
 * cutting back to an identical image — a cut to the same frame reads as a glitch.
 */
export function planBroll(lines: TimedLine[], library: VisualAsset[], options: CueOptions): BrollCue[] {
  const duration = Math.max(0, options.durationSec)
  const minSec = options.minSec ?? MIN_CUE_SEC
  const maxSec = options.maxSec ?? MAX_CUE_SEC
  if (!duration) return []

  const cues: BrollCue[] = []
  for (const line of lines) {
    if (line.endSec <= line.startSec) continue
    const hit = matchLine(line.text, library)
    if (!hit) continue

    const last = cues[cues.length - 1]
    // Same picture, and directly following on — extend rather than cut to itself.
    if (last && last.assetId === hit.asset.id && line.startSec - last.endSec < 1) {
      last.endSec = Math.min(line.endSec, duration)
      continue
    }
    cues.push({
      startSec: Math.max(0, Math.min(line.startSec, duration)),
      endSec: Math.min(line.endSec, duration),
      assetId: hit.asset.id,
      label: hit.asset.label,
      trigger: hit.trigger
    })
  }

  // Clamp lengths, then drop anything that is still only a flash.
  return cues
    .map((c) => ({ ...c, endSec: Math.min(c.endSec, c.startSec + maxSec, duration) }))
    .filter((c) => c.endSec - c.startSec >= minSec)
}

export interface BrollSummary {
  cues: number
  coveredSec: number
  coveragePercent: number
  headline: string
}

export function summarise(cues: BrollCue[], durationSec: number): BrollSummary {
  const coveredSec = cues.reduce((n, c) => n + (c.endSec - c.startSec), 0)
  const coveragePercent = durationSec > 0 ? Math.round((coveredSec / durationSec) * 100) : 0
  const headline = cues.length
    ? `${cues.length} picture${cues.length === 1 ? '' : 's'} timed to what you actually say — ${coveragePercent}% of the video has something on screen.`
    : 'No visuals matched. Add keywords for the things you talk about, or name them more directly in the script.'
  return { cues: cues.length, coveredSec, coveragePercent, headline }
}

/**
 * `overlay` timing for one cue, ready to drop into a filter chain. `enable` is what
 * makes the picture appear and disappear on the words rather than sitting there for
 * the whole video.
 */
export function cueEnableExpr(cue: BrollCue): string {
  return `between(t,${cue.startSec.toFixed(3)},${cue.endSec.toFixed(3)})`
}

/**
 * Turns a script into timed lines using reading speed, for when there is no transcript.
 *
 * The narration does not exist yet when b-roll is being planned — it is generated later
 * in the same build — so the timing has to come from the words. Time is shared out in
 * proportion to WORD COUNT rather than sentence count: a twenty-word sentence takes
 * roughly twice as long to say as a ten-word one, and splitting evenly puts every cue
 * progressively further from the word that earned it.
 *
 * Stage directions are dropped. They are not spoken, so counting them would push every
 * later cue late by however long the brackets would have taken to read.
 */
export function timedLinesFromScript(body: string, durationSec: number): TimedLine[] {
  const total = Math.max(0, durationSec)
  const spoken = (body ?? '')
    .split('\n')
    .filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line))
    .join(' ')
    .replace(/\[[^\]]*\]/g, ' ')
  const sentences = spoken
    .split(/(?<=[.!?۔])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!sentences.length || !total) return []

  const words = sentences.map((s) => Math.max(1, s.split(/\s+/).filter(Boolean).length))
  const totalWords = words.reduce((a, b) => a + b, 0)
  const lines: TimedLine[] = []
  let at = 0
  sentences.forEach((text, i) => {
    const span = (total * words[i]) / totalWords
    lines.push({ startSec: at, endSec: Math.min(total, at + span), text })
    at += span
  })
  return lines
}
