/**
 * Rebuilds the first fifteen seconds — the part that decides everything.
 *
 * WHY THE HOOK SPECIFICALLY
 * Viewers decide inside about five seconds and are mostly gone by thirty. Every other
 * improvement in this studio is worth less than the opening, because nothing downstream
 * matters to someone who left. And the hook is the part of a script that gets written
 * FIRST, before you know what the video actually turned out to be about — so it is
 * routinely the weakest paragraph in the file.
 *
 * WHAT THIS DOES
 * The good hook is almost always already IN the script, sitting in paragraph four. So
 * this does not invent openings: it finds the strongest material the writer already
 * wrote and reshapes it into several proven opening forms, so they can pick.
 *
 * Five forms, each doing a different job:
 *   CONTRADICTION  the popular view is wrong — the highest-tension opening there is
 *   NUMBER         one concrete figure, no preamble
 *   QUESTION       an open loop the viewer wants closed
 *   STAKE          what it costs THEM, directly
 *   IN-MEDIA-RES   drop straight into the middle of the argument
 *
 * NOTHING IS INVENTED. Every candidate is built from sentences the writer wrote, and a
 * test enforces it. On a finance channel a hook containing a number the script does not
 * support is not a stylistic problem, it is a correction video.
 */

export type HookForm = 'contradiction' | 'number' | 'question' | 'stake' | 'in-media-res'

export interface HookCandidate {
  form: HookForm
  /** The proposed opening, in the writer's own words. */
  text: string
  /** Why this form works, in plain English. */
  rationale: string
  /** Where in the script the material came from, so it can be checked. */
  sourceSentence: string
  /** Rough spoken length, so it can be judged against the fifteen seconds that matter. */
  seconds: number
  score: number
}

/** Words that mark each form, in both languages this channel is spoken in. */
const MARKERS: Record<HookForm, RegExp> = {
  contradiction: /\b(?:but|however|actually|not the|nobody|no one|wrong|myth|truth is|opposite|lekin|magar|asal|haqiqat|ghalat)\b/i,
  number: /\d[\d,]*\.?\d*\s?(?:%|percent|fisad|feesad|billion|million|crore|lakh|arab|rupees?|rs\.?|dollars?|months?|days?|years?)/i,
  question: /\?|^(?:why|how|what|kya|kyun|kyu|kaise)\b/i,
  stake: /\b(?:you|your|yours|aap|apna|apni|apki|cost|costs|lose|losing|lost|save|risk|nuqsan|faida|jeb)\b/i,
  'in-media-res': /\b(?:here is|here's|look at|listen|consider|start with|dekhein|suniye)\b/i
}

/** Filler that must never open a video, whatever else it contains. */
const NEVER_OPEN =
  /\b(?:subscribe|like and share|welcome back|in (?:this|today'?s) video|my name is|as i (?:said|mentioned)|hit the bell|channel ko)\b/i

const WORDS_PER_SECOND = 150 / 60

export function spokenSeconds(text: string): number {
  const words = text.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return Math.round((words / WORDS_PER_SECOND) * 10) / 10
}

/** Sentences worth considering: long enough to carry a thought, short enough to open with. */
export function candidateSentences(script: string): string[] {
  const spoken = (script ?? '').replace(/^(?:#{1,6}\s+.*|\[[^\]]*\])$/gm, ' ')
  return spoken
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 260)
    .filter((s) => !NEVER_OPEN.test(s))
}

/** How well one sentence suits one opening form. */
export function scoreForForm(sentence: string, form: HookForm): number {
  if (!MARKERS[form].test(sentence)) return 0
  let score = 5
  // A hook has to land inside the first few seconds. Long sentences bury the point.
  const secs = spokenSeconds(sentence)
  if (secs <= 6) score += 3
  else if (secs <= 10) score += 1
  else score -= 2
  // A concrete figure strengthens every form, not just the number form.
  if (MARKERS.number.test(sentence)) score += 2
  // Speaking to the viewer directly strengthens every form too.
  if (form !== 'stake' && MARKERS.stake.test(sentence)) score += 1
  return score
}

const RATIONALE: Record<HookForm, string> = {
  contradiction:
    'Opens by contradicting what the viewer already believes. The strongest hook there is — they have to stay to find out why they are wrong.',
  number:
    'Opens on one hard figure with no preamble. Concrete beats vague, and a number signals this is reported, not opinion.',
  question:
    'Opens an loop the viewer wants closed. Works because leaving now means leaving without the answer.',
  stake: 'Tells the viewer what this costs THEM in the first breath, so the video is about them and not about the topic.',
  'in-media-res':
    'Drops straight into the middle of the argument with no setup. Nothing to skip, so nobody skips.'
}

export interface RebuildOptions {
  /** How many to return. Fewer, stronger beats a long list. */
  count?: number
  /** Target length. Past this a hook stops being a hook. */
  maxSeconds?: number
}

/**
 * The alternatives, best first.
 *
 * One per FORM, never five variations of the same idea — the whole value is that the
 * writer sees genuinely different angles on their own material and can feel which one
 * fits. Five near-identical options is a worse choice than one.
 */
export function rebuildHooks(script: string, options: RebuildOptions = {}): HookCandidate[] {
  const count = Math.max(1, options.count ?? 5)
  const maxSeconds = options.maxSeconds ?? 15
  const sentences = candidateSentences(script)
  if (!sentences.length) return []

  const forms: HookForm[] = ['contradiction', 'number', 'question', 'stake', 'in-media-res']
  const out: HookCandidate[] = []
  const used = new Set<string>()

  for (const form of forms) {
    let best: { sentence: string; score: number } | null = null
    for (const sentence of sentences) {
      if (used.has(sentence)) continue
      if (spokenSeconds(sentence) > maxSeconds) continue
      const score = scoreForForm(sentence, form)
      if (score > 0 && (!best || score > best.score)) best = { sentence, score }
    }
    if (!best) continue
    used.add(best.sentence)
    out.push({
      form,
      text: shapeForForm(best.sentence, form),
      rationale: RATIONALE[form],
      sourceSentence: best.sentence,
      seconds: spokenSeconds(best.sentence),
      score: best.score
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, count)
}

/**
 * Light reshaping only.
 *
 * Deliberately conservative: trimming a leading conjunction and fixing capitalisation
 * is the most this may do. Anything more would be REWRITING, and a rewritten hook can
 * assert something the script never said — which on this channel is a correction video,
 * not a style note.
 */
export function shapeForForm(sentence: string, form: HookForm): string {
  let s = sentence.trim()
  // A sentence lifted from mid-script often starts with a connector that makes no
  // sense as the first words of a video.
  s = s.replace(/^(?:and|but|so|because|however|therefore|also|then)\s+/i, '')
  // Question form: keep the question mark it already has, never bolt one on — that
  // would turn a statement into a claim the writer did not make.
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (form === 'question' && !s.includes('?')) return s
  return s
}

export function summarise(candidates: HookCandidate[]): string {
  if (!candidates.length) {
    return 'No usable openings found. The script may be too short, or every sentence too long to open with.'
  }
  return `${candidates.length} opening${candidates.length === 1 ? '' : 's'} built from your own sentences — ${candidates
    .map((c) => c.form)
    .join(', ')}. Nothing here says anything your script does not.`
}
