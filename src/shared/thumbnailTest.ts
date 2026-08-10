/**
 * Thumbnail variants, and telling a real difference from noise.
 *
 * WHAT CANNOT BE BUILT, SAID UP FRONT
 * A properly automated A/B test is not possible from this app. YouTube's Data API does not
 * expose click-through rate per thumbnail at all; impressions and CTR live in the
 * Analytics API behind an OAuth login, and even there the figure is per VIDEO, not per
 * thumbnail — swap the image and the old number is simply overwritten. So there is no
 * endpoint to poll and no automated winner. Any tool claiming to A/B test YouTube
 * thumbnails for you is either using a browser extension or making it up.
 *
 * WHAT IS WORTH BUILDING INSTEAD
 * Three things, and the third is the one that actually earns its place:
 *
 *   1. Variants that are genuinely DIFFERENT. The usual failure is five variants that are
 *      the same idea in five fonts, which tests nothing.
 *   2. The checks that need no analytics at all — text too long to read at the size a
 *      thumbnail is actually seen, and a headline that just repeats the title sitting
 *      right beside it.
 *   3. TELLING A REAL DIFFERENCE FROM NOISE. This is where people fool themselves. "B got
 *      4.1% and A got 3.8%, B wins" is usually nothing — on a few hundred impressions that
 *      gap is well inside what chance produces. The arithmetic for that is not something
 *      you can do by eye, and it is the whole reason a test is worth running at all.
 */

export type VariantAngle = 'number' | 'question' | 'face' | 'contrast' | 'plain'

export interface ThumbnailVariant {
  id: string
  angle: VariantAngle
  /** The words on the thumbnail. */
  headline: string
  /** Why this one is different from the others, in plain English. */
  why: string
  /** Problems that would hurt it, whatever the test says. */
  problems: string[]
}

/** Above this many characters, a headline is unreadable at the size people see it. */
export const MAX_THUMB_CHARS = 30

/** Above this many words, the eye has to read rather than glance. */
export const MAX_THUMB_WORDS = 5

/**
 * The checks that need no analytics.
 *
 * A thumbnail is seen at about 200 pixels wide on a phone, next to its own title. Those
 * two facts decide most of what makes one fail, and neither needs a single view.
 */
export function variantProblems(headline: string, videoTitle: string): string[] {
  const h = (headline ?? '').trim()
  const problems: string[] = []
  if (!h) {
    problems.push('No words on it. That can work with a strong image, but nothing here can judge the image.')
    return problems
  }
  if (h.length > MAX_THUMB_CHARS) {
    problems.push(
      `${h.length} characters — at the size a thumbnail is actually seen, past about ${MAX_THUMB_CHARS} nobody reads it. Cut ${h.length - MAX_THUMB_CHARS}.`
    )
  }
  const words = h.split(/\s+/).filter(Boolean)
  if (words.length > MAX_THUMB_WORDS) {
    problems.push(`${words.length} words — a thumbnail is glanced at, not read. ${MAX_THUMB_WORDS} is the most that lands.`)
  }
  // The wasted-space failure: the title is directly beside the thumbnail, so repeating it
  // buys nothing and spends the one line you had.
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
  const nh = norm(h)
  const nt = norm(videoTitle ?? '')
  if (nh && nt && (nt.includes(nh) || nh === nt)) {
    problems.push('This just repeats the title, which sits right next to it. The thumbnail says nothing the viewer is not already reading.')
  }
  // "has letters AND they are all uppercase". The obvious `/[a-z]/.test(h)` guard was
  // meant to skip digit-only headlines like "11.2" and instead skipped every genuinely
  // all-caps one, because all-caps text contains no lowercase letter by definition.
  if (/\p{L}/u.test(h) && h === h.toUpperCase() && h.length > 12) {
    problems.push('All capitals over about twelve characters reads as shouting and is slower to take in than mixed case.')
  }
  return problems
}

/**
 * Distinct variants from what the video already has.
 *
 * Built from the title and script rather than invented, and one per ANGLE so the set tests
 * genuinely different ideas. Five variations on one idea tests nothing but fonts.
 */
export function variantsFor(input: { title: string; headline?: string; script?: string }): ThumbnailVariant[] {
  const title = (input.title ?? '').trim()
  if (!title) return []
  const script = input.script ?? ''
  const out: ThumbnailVariant[] = []

  const push = (id: string, angle: VariantAngle, headline: string, why: string): void => {
    const h = headline.trim()
    if (!h || out.some((v) => v.headline.toLowerCase() === h.toLowerCase())) return
    out.push({ id, angle, headline: h, why, problems: variantProblems(h, title) })
  }

  // A number pulled from the title or script — never invented, because a wrong figure on a
  // thumbnail is a wrong figure in the most-seen part of the video.
  const number = /(\d[\d,]*\.?\d*\s?(?:%|percent|fisad|billion|bn|million|crore|lakh|arab|months?|days?|years?)?)/i.exec(
    `${title} ${script}`
  )?.[1]
  if (number) push('number', 'number', number.trim(), 'A single figure reads in one glance and makes the claim concrete.')

  // A question, if the material contains one.
  const question = /([^.!?۔\n]{8,60}\?)/.exec(`${title}\n${script}`)?.[1]
  if (question) push('question', 'question', question.trim(), 'A question the viewer already has — they click for the answer.')

  // The strongest two or three words of the title, which is usually the actual subject.
  const words = title.split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|that|this|with|from|what|why|how)$/i.test(w))
  if (words.length) push('contrast', 'contrast', words.slice(0, 3).join(' '), 'The subject alone, big — no sentence to read.')

  push('plain', 'plain', title.split(/[:,—-]/)[0].trim().slice(0, MAX_THUMB_CHARS), 'The plainest version, as a control to test the others against.')

  if (input.headline?.trim()) {
    push('yours', 'face', input.headline.trim(), 'What you had already written, kept in so the others are tested against it.')
  }

  return out
}

// ───────────────────────── telling a real result from noise ─────────────────────────

export interface VariantResult {
  variantId: string
  /** How many times the thumbnail was shown. */
  impressions: number
  /** How many clicks it got. */
  clicks: number
}

/** Below this, a comparison cannot say anything at all. */
export const MIN_IMPRESSIONS = 500

export interface Comparison {
  a: VariantResult
  b: VariantResult
  rateA: number
  rateB: number
  /** Difference in percentage POINTS, b minus a. */
  differencePoints: number
  /** True only when the difference is outside what chance would produce. */
  meaningful: boolean
  headline: string
}

/**
 * Is the difference between two thumbnails real?
 *
 * A two-proportion z-test, which is the standard way to answer exactly this and is a dozen
 * lines of arithmetic. It is here because the eye is terrible at it: "4.1% against 3.8%"
 * looks like a result and, on a few hundred impressions, is noise. Acting on noise means
 * changing every future thumbnail on the strength of a coin flip.
 *
 * The threshold is 1.96, the conventional 95% level — the difference has to be about twice
 * the size of the wobble you would expect by chance before this calls it real.
 */
export function compareVariants(a: VariantResult, b: VariantResult): Comparison {
  const impA = Math.max(0, a?.impressions ?? 0)
  const impB = Math.max(0, b?.impressions ?? 0)
  const clkA = Math.min(Math.max(0, a?.clicks ?? 0), impA)
  const clkB = Math.min(Math.max(0, b?.clicks ?? 0), impB)
  const rateA = impA > 0 ? clkA / impA : 0
  const rateB = impB > 0 ? clkB / impB : 0
  const differencePoints = Math.round((rateB - rateA) * 1000) / 10

  if (impA < MIN_IMPRESSIONS || impB < MIN_IMPRESSIONS) {
    return {
      a: { variantId: a?.variantId ?? 'A', impressions: impA, clicks: clkA },
      b: { variantId: b?.variantId ?? 'B', impressions: impB, clicks: clkB },
      rateA,
      rateB,
      differencePoints,
      meaningful: false,
      headline:
        `Not enough yet — ${impA.toLocaleString()} and ${impB.toLocaleString()} times shown, and under ` +
        `${MIN_IMPRESSIONS.toLocaleString()} each nothing can be told from chance. Leave it running.`
    }
  }

  // Pooled proportion, then the standard error of the difference.
  const pooled = (clkA + clkB) / (impA + impB)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / impA + 1 / impB))
  const z = se > 0 ? Math.abs(rateB - rateA) / se : 0
  const meaningful = z >= 1.96

  const pct = (r: number): string => `${(r * 100).toFixed(2)}%`
  const winner = rateB > rateA ? b.variantId : a.variantId
  const headline = meaningful
    ? `${winner} really is better — ${pct(rateA)} against ${pct(rateB)}, on ${impA.toLocaleString()} and ${impB.toLocaleString()} shows. That is outside chance.`
    : `No real difference — ${pct(rateA)} against ${pct(rateB)} is inside what chance produces at this many shows. ` +
      `Picking a winner here would be picking a coin flip.`

  return {
    a: { variantId: a.variantId, impressions: impA, clicks: clkA },
    b: { variantId: b.variantId, impressions: impB, clicks: clkB },
    rateA,
    rateB,
    differencePoints,
    meaningful,
    headline
  }
}

export interface TestPlan {
  variants: ThumbnailVariant[]
  /** How to run it so the answer means something. */
  steps: string[]
  /** The trap that invalidates most home-made thumbnail tests. */
  warning: string
}

/**
 * How to actually run the test, given that nothing can be automated.
 *
 * The steps exist because of one trap that ruins most attempts: a video's click-through
 * falls naturally as it ages out of the feed, so a thumbnail's first 48 hours compared
 * against a replacement's later 48 hours is not a comparison of thumbnails at all — the
 * newer one is fighting a colder audience. Swapping BACK and forth is what separates them.
 */
export function testPlan(input: { title: string; headline?: string; script?: string }): TestPlan {
  return {
    variants: variantsFor(input),
    steps: [
      'Publish with the first thumbnail. Leave it completely alone for 48 hours.',
      'Write down the impressions and the click-through from YouTube Studio → Reach.',
      'Swap to the second thumbnail. Leave it alone for the same 48 hours.',
      'Write those two numbers down as well.',
      'Swap BACK to the first for another 48 hours, and note it again.',
      'Paste both sets in here and it will tell you whether the difference is real or noise.'
    ],
    warning:
      'A video’s click-through drops on its own as it ages out of the feed, so the second thumbnail is always fighting a colder audience than the first. That is why you swap back: if the first one recovers when it returns, the difference was the thumbnail. If it does not, you were measuring the calendar.'
  }
}
