/**
 * Finds the video ideas already sitting in your comments.
 *
 * WHY THIS IS THE CHEAPEST GROWTH LEVER THERE IS
 * Every other idea source is a guess about what people want. Comments are people
 * telling you, in their own words, unprompted — and the same question asked forty times
 * is a video with a guaranteed audience before you record a frame. It is also the one
 * source no competitor can copy, because they are your commenters, not theirs.
 *
 * Nobody reads two thousand comments. That is the only reason this is not already
 * everyone's process.
 *
 * WHAT THIS FILE IS, AND IS NOT
 * The analysis: pull out the questions, group ones asking the same thing, rank by how
 * often each recurs. Pure and testable. Fetching the comments is a separate job, kept
 * separate so this can be tested without a network or a YouTube key.
 *
 * NO AI, ON PURPOSE
 * A language model asked to "summarise what people are asking" produces a plausible
 * summary that may not correspond to any comment anyone wrote — and there is no way to
 * tell from the output. Every question this returns is a real sentence a real person
 * typed, quoted verbatim, with a count. You can act on it because you can check it.
 *
 * Bilingual: about half these comments will be Roman Urdu.
 */

export interface RawComment {
  text: string
  /** Likes, used as a weak signal that others cared about the same thing. */
  likes?: number
  /** Which of your videos it was left on, so you can see what prompted it. */
  videoId?: string
  author?: string
}

export interface QuestionCluster {
  /** The clearest phrasing found, quoted verbatim — never paraphrased. */
  representative: string
  /** Every distinct comment in this cluster, verbatim. */
  examples: string[]
  /** How many people asked it. */
  count: number
  /** Total likes across the cluster — how much others cared. */
  likes: number
  /** The words that put these together, so the grouping is inspectable. */
  keywords: string[]
  /** count + likes, weighted. Higher = make this video sooner. */
  score: number
}

/**
 * Question markers in both languages. Roman Urdu questions frequently carry NO question
 * mark at all, which is why marker words matter more than punctuation here — relying on
 * "?" alone would silently discard half the input.
 */
const QUESTION_MARKERS =
  /(?:^|\b)(?:why|how|what|when|where|which|who|should|could|can|is it|are they|does|do you|will|would|kya|kyun|kyu|kaise|kab|kahan|kaunsa|kitna|kitni|batao|bataye|samjhaye|explain|chahiye|chahye|chahiya|ya nahi|ya nahin|ya na)\b/i

/**
 * `chahiye` and `ya nahi` were missing, and they are two of the commonest question forms
 * in these comments. "sona lena chahiye is waqt" is "should I buy gold right now" — a
 * question, with no question mark and none of the English or Urdu question WORDS in it.
 * A stress pass caught two people asking exactly that and the module returning nothing.
 *
 * They can misfire on advice ("aap ko dekhna chahiye" = "you should watch"), and that is
 * the right trade: a stray non-question in an idea list costs a glance, while missing the
 * most common way this audience asks things costs half the input. The two-people minimum
 * filters most of the noise anyway.
 */

/** Not questions, however they are punctuated. */
const NOT_A_QUESTION =
  /^(?:nice|great|good|thanks|thank you|shukriya|bohat|zabardast|mashallah|first|love|awesome|sir ji|salam|assalam)\b[\s!.,]*$/i

/** Words carrying no topical meaning — stripped before comparing two questions. */
const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','do','does','did','doing','have','has','had',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their',
  'this','that','these','those','and','or','but','if','then','than','so','because','as','of','at','by','for',
  'with','about','into','to','from','in','on','up','out','off','over','under','again','can','could','should',
  'would','will','shall','may','might','must','not','no','nor','very','too','also','just','only','sir','plz',
  // The English question words. These were missing while the Urdu equivalents (kya,
  // kyun, kaise) were already here — an inconsistency that cost real grouping: "Why is
  // import cover falling?" kept "why" as a topic word, inflating its word count and
  // dropping its similarity to the same question in Urdu to 0.333, just under the 0.34
  // threshold. Two identical questions in two languages failed to group over one word
  // carrying no meaning.
  'why','how','what','when','where','which','who','whom','whose',
  'please','bhai','ji','hai','hain','ho','hu','hun','ka','ki','ke','ko','se','me','mein','par','aur','ya',
  'kya','kyun','kyu','kaise','kab','kahan','ye','yeh','wo','woh','na','nahi','bhi','kuch','koi','tha','thi'
])

/**
 * Light stemming — enough to match "reserves" with "reserve", no more.
 *
 * The trailing-`e` strip is not cosmetic. Without it "reserves" became "reserv" (the
 * "es" suffix came off) while "reserve" stayed "reserve", so the singular and plural of
 * the single most common word in these comments never matched each other. Stripping a
 * final `e` afterwards lands both on "reserv".
 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  for (const suffix of ['ings', 'ing', 'ies', 'ed', 'es', 's']) {
    if (w.length > 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length)
      break
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** The meaningful words in a question, for comparing two of them. */
export function topicWords(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase()
    if (!w || STOPWORDS.has(w)) continue
    const s = stem(w)
    if (s.length >= 3) seen.add(s)
  }
  return [...seen]
}

/** Is this comment actually asking something? */
export function isQuestion(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t || t.length < 8) return false
  if (NOT_A_QUESTION.test(t)) return false
  if (t.includes('?')) return true
  // No question mark is normal in Roman Urdu comments.
  return QUESTION_MARKERS.test(t)
}

/** How alike two questions are, 0 to 1, by shared topic words. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  const shared = a.filter((w) => setB.has(w)).length
  // Jaccard over the union, so a long rambling comment cannot swallow a short one just
  // by containing more words.
  return shared / (a.length + b.length - shared)
}

/** Above this two questions are the same question. */
export const SAME_QUESTION = 0.34

export interface MineOptions {
  /** Ignore anything asked fewer times than this. */
  minCount?: number
  /** How many clusters to return. */
  limit?: number
  threshold?: number
}

/**
 * Groups the questions and ranks them.
 *
 * Greedy single-pass clustering: each question joins the first cluster it is close
 * enough to, or starts its own. A cleverer algorithm would group marginally better and
 * would be impossible to explain when it grouped two things oddly — and the keywords
 * are returned precisely so the user can see WHY things were grouped and disagree.
 */
export function mineQuestions(comments: RawComment[], options: MineOptions = {}): QuestionCluster[] {
  const minCount = options.minCount ?? 2
  const limit = options.limit ?? 20
  const threshold = options.threshold ?? SAME_QUESTION

  const questions = (comments ?? [])
    .filter((c) => c && typeof c.text === 'string' && isQuestion(c.text))
    .map((c) => ({ text: c.text.trim(), likes: Math.max(0, c.likes ?? 0), words: topicWords(c.text) }))
    .filter((q) => q.words.length > 0)

  const clusters: { members: typeof questions; words: string[] }[] = []
  for (const q of questions) {
    const hit = clusters.find((c) => similarity(c.words, q.words) >= threshold)
    if (hit) {
      hit.members.push(q)
      // Keep only the words the cluster genuinely shares, so it does not drift into a
      // catch-all as more members join.
      const set = new Set(q.words)
      const overlap = hit.words.filter((w) => set.has(w))
      if (overlap.length >= 2) hit.words = overlap
    } else {
      clusters.push({ members: [q], words: q.words })
    }
  }

  return clusters
    .map((c) => {
      // Deduplicate identical comments before counting: one person posting twice is not
      // two people asking.
      const unique = [...new Map(c.members.map((m) => [m.text.toLowerCase(), m])).values()]
      const likes = unique.reduce((n, m) => n + m.likes, 0)
      // The representative is the SHORTEST question in the cluster — the clearest
      // phrasing of the shared idea, and always a real sentence somebody wrote.
      const representative = [...unique].sort((a, b) => a.text.length - b.text.length)[0].text
      return {
        representative,
        examples: unique.map((m) => m.text),
        count: unique.length,
        likes,
        keywords: c.words.slice(0, 6),
        // Count dominates, and the cap is what makes that true. At count*20 a pair of
        // heavily-liked comments outscored five people independently asking — likes on
        // one comment are noisy (thread position, bots), distinct askers are not. At
        // count*5 likes still break ties without ever overturning the count.
        score: unique.length * 10 + Math.min(likes, unique.length * 5)
      }
    })
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function summarise(clusters: QuestionCluster[], commentsScanned: number): string {
  if (!commentsScanned) return 'No comments to read yet.'
  if (!clusters.length) {
    return `Read ${commentsScanned} comments — nothing was asked more than once yet. Worth checking again after your next video.`
  }
  const top = clusters[0]
  return (
    `${clusters.length} question${clusters.length === 1 ? '' : 's'} came up more than once across ${commentsScanned} comments. ` +
    `The most asked, ${top.count} times: "${top.representative}"`
  )
}
