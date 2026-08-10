/**
 * What the other channels covered that this one did not.
 *
 * WHY THIS IS A DIFFERENT QUESTION FROM "WHAT IS TRENDING"
 * Trending tells you what is popular. It does not tell you whether YOU have already
 * covered it, and it does not tell you whether the version already out there is any good.
 * The useful question is narrower and much harder to answer by hand: which topics are
 * getting real views on other channels while this channel has published nothing on them.
 * That is a gap, and a gap is a video with demonstrated demand and no competition from
 * your own back catalogue.
 *
 * WHAT IT WILL NOT DO
 * It will not tell you to copy a video. It compares TOPICS — the subject matter — not
 * titles, angles or scripts. And it never claims a gap from one competitor video: a
 * single upload is an experiment, not a demand signal, so a topic needs to appear more
 * than once before it counts.
 *
 * It also reports the OPPOSITE, which is just as useful and never gets said: topics this
 * channel has covered repeatedly that nobody else is touching. Those are either a moat or
 * a waste, and knowing which is worth more than another idea.
 *
 * NO AI. "What is this video about" is a keyword problem with a checkable answer, and a
 * model asked to name gaps produces a confident list that cannot be traced to any video.
 * Every topic here comes with the actual video titles behind it.
 */

export interface CompetitorVideo {
  title: string
  channelTitle: string
  viewCount: number
  publishedAt?: string
}

export interface MyVideoTitle {
  title: string
  views?: number
  publishedAt?: string
}

/**
 * The subjects this channel is about. A fixed vocabulary rather than free keyword
 * extraction, because free extraction on finance titles returns "the", "new", "2026" and
 * "explained" — words that describe nothing and group everything together.
 */
export interface Topic {
  id: string
  label: string
  /** Whole-word, case-insensitive. Both languages, because both are searched. */
  keywords: string[]
}

export const FINANCE_TOPICS: Topic[] = [
  { id: 'reserves', label: 'Foreign reserves', keywords: ['reserves', 'reserve', 'zakhair', 'zakhaire', 'import cover'] },
  { id: 'inflation', label: 'Inflation', keywords: ['inflation', 'cpi', 'mehngai', 'mehangai', 'price rise'] },
  { id: 'rupee', label: 'The rupee', keywords: ['rupee', 'rupya', 'rupaya', 'pkr', 'devaluation', 'exchange rate'] },
  { id: 'interest', label: 'Interest rates', keywords: ['interest rate', 'policy rate', 'sood', 'discount rate', 'monetary policy'] },
  { id: 'psx', label: 'The stock market', keywords: ['psx', 'kse', 'kse-100', 'stock market', 'bazaar', 'index', 'shares'] },
  { id: 'gold', label: 'Gold', keywords: ['gold', 'sona', 'tola', 'bullion'] },
  { id: 'imf', label: 'The IMF', keywords: ['imf', 'tranche', 'bailout', 'programme', 'program'] },
  { id: 'budget', label: 'The budget', keywords: ['budget', 'finance bill', 'taxation', 'fbr', 'tax'] },
  { id: 'debt', label: 'Debt', keywords: ['debt', 'qarz', 'borrowing', 'default', 'eurobond', 'sukuk'] },
  { id: 'oil', label: 'Oil and fuel', keywords: ['oil', 'petrol', 'diesel', 'fuel', 'tel', 'opec'] },
  { id: 'energy', label: 'Electricity and gas', keywords: ['electricity', 'power', 'bijli', 'gas', 'tariff', 'circular debt'] },
  { id: 'remittances', label: 'Remittances', keywords: ['remittance', 'remittances', 'overseas', 'workers'] },
  { id: 'property', label: 'Property', keywords: ['property', 'real estate', 'plot', 'housing', 'zameen'] },
  { id: 'crypto', label: 'Crypto', keywords: ['crypto', 'bitcoin', 'btc', 'ethereum', 'blockchain'] },
  { id: 'banking', label: 'Banks', keywords: ['bank', 'banks', 'banking', 'sbp', 'state bank', 'deposits'] },
  { id: 'exports', label: 'Exports and trade', keywords: ['export', 'exports', 'trade deficit', 'textile', 'bara-mad'] },
  { id: 'agriculture', label: 'Agriculture', keywords: ['wheat', 'cotton', 'sugar', 'agriculture', 'gandum', 'fasal'] },
  { id: 'savings', label: 'Savings and investing', keywords: ['savings', 'invest', 'investment', 'mutual fund', 'bachat', 'pension'] }
]

/** Whole-word match so "tax" does not fire on "taxonomy" and "oil" not on "boiling". */
function mentions(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Every topic a title is about. A title can be about more than one. */
export function topicsOf(title: string, topics: Topic[] = FINANCE_TOPICS): Topic[] {
  const t = title ?? ''
  return topics.filter((topic) => topic.keywords.some((k) => mentions(t, k)))
}

/** Below this many competitor videos, a topic is one channel's experiment, not demand. */
export const MIN_COMPETITOR_VIDEOS = 2

export interface Gap {
  topic: string
  topicId: string
  /** How many competitor videos covered it. */
  competitorVideos: number
  /** Median views across those — the typical result, not the outlier. */
  medianViews: number
  /** How many of YOUR videos covered it. */
  myVideos: number
  /** The actual competitor titles, so the claim can be checked. */
  examples: { title: string; channelTitle: string; viewCount: number }[]
  /** Which channels are covering it. */
  channels: string[]
  headline: string
}

/**
 * The TYPICAL view count — the lower of the two middle values when the count is even.
 *
 * Not the textbook median, and the difference matters at the sample sizes this works
 * with. A topic qualifies on two competitor videos, and the textbook median of two values
 * is their MEAN: `median([1000, 5000000])` is 2,500,500, so a single viral upload would
 * present a topic as guaranteed demand when the typical video on it got a thousand views.
 * Taking the lower middle refuses to be lifted by the outlier.
 *
 * Deliberately a separate function from channelLearning's median rather than a change to
 * it: that one is guarded by an eight-video minimum and three per group, so it never sees
 * a two-sample list, and its callers depend on the textbook behaviour.
 */
export function typicalViews(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!clean.length) return 0
  return clean.length % 2 ? clean[Math.floor(clean.length / 2)] : clean[clean.length / 2 - 1]
}

export interface GapReport {
  /** Topics others cover and this channel does not. Biggest demand first. */
  gaps: Gap[]
  /** Topics this channel covers that nobody else in the sample does. */
  onlyMine: { topic: string; myVideos: number }[]
  /** Topics both cover — no advantage either way, listed for completeness. */
  shared: string[]
  /** Competitor videos whose subject matched no known topic, so nothing is silently lost. */
  unmatched: number
  headline: string
}

/**
 * Compares topic coverage.
 *
 * `median` not mean, for the same reason it is used everywhere else here: one competitor
 * video that went viral would otherwise make its topic look like guaranteed demand when
 * it was luck.
 */
export function gapReport(
  mine: MyVideoTitle[],
  theirs: CompetitorVideo[],
  topics: Topic[] = FINANCE_TOPICS
): GapReport {
  const myCounts = new Map<string, number>()
  for (const v of mine ?? []) {
    if (!v || typeof v.title !== 'string') continue
    for (const t of topicsOf(v.title, topics)) myCounts.set(t.id, (myCounts.get(t.id) ?? 0) + 1)
  }

  const theirsByTopic = new Map<string, CompetitorVideo[]>()
  let unmatched = 0
  for (const v of theirs ?? []) {
    if (!v || typeof v.title !== 'string') continue
    const hits = topicsOf(v.title, topics)
    if (!hits.length) {
      unmatched++
      continue
    }
    for (const t of hits) {
      const arr = theirsByTopic.get(t.id)
      if (arr) arr.push(v)
      else theirsByTopic.set(t.id, [v])
    }
  }

  const gaps: Gap[] = []
  const shared: string[] = []
  // With no history of your own there is nothing to compare against, so EVERY topic would
  // look like a gap — which is a claim built on absence of data rather than on data. The
  // headline always said so; the returned list did not agree with it, and a caller reading
  // the list rather than the sentence would have been misled.
  const canCompare = (mine ?? []).some((v) => v && typeof v.title === 'string' && v.title.trim())
  for (const [topicId, videos] of canCompare ? theirsByTopic : []) {
    const topic = topics.find((t) => t.id === topicId)!
    const myVideos = myCounts.get(topicId) ?? 0
    if (myVideos > 0) {
      shared.push(topic.label)
      continue
    }
    // One channel trying something once is not demand.
    if (videos.length < MIN_COMPETITOR_VIDEOS) continue
    const medianViews = typicalViews(videos.map((v) => v.viewCount))
    const channels = [...new Set(videos.map((v) => v.channelTitle).filter(Boolean))]
    gaps.push({
      topic: topic.label,
      topicId,
      competitorVideos: videos.length,
      medianViews,
      myVideos,
      // The real titles, so the gap can be checked rather than believed.
      examples: [...videos]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 3)
        .map((v) => ({ title: v.title, channelTitle: v.channelTitle, viewCount: v.viewCount })),
      channels,
      headline:
        `${topic.label} — ${videos.length} video${videos.length === 1 ? '' : 's'} from ${channels.length} ` +
        `other channel${channels.length === 1 ? '' : 's'}, typically ${medianViews.toLocaleString()} views. ` +
        `You have never covered it.`
    })
  }

  const onlyMine = [...myCounts.entries()]
    .filter(([id]) => !theirsByTopic.has(id))
    .map(([id, myVideos]) => ({ topic: topics.find((t) => t.id === id)!.label, myVideos }))
    .sort((a, b) => b.myVideos - a.myVideos)

  // Ranked by demonstrated demand: the typical views, then how many channels bothered.
  gaps.sort((a, b) => b.medianViews - a.medianViews || b.competitorVideos - a.competitorVideos)

  let headline: string
  if (!theirs?.length) headline = 'No competitor videos read yet — search a topic first.'
  else if (!mine?.length) {
    headline = `Read ${theirs.length} videos from other channels, but none of yours — so nothing can be called a gap yet.`
  } else if (!gaps.length) {
    headline = `No gaps in this sample: you have covered every subject the other ${theirs.length} videos did.`
  } else {
    headline =
      `${gaps.length} subject${gaps.length === 1 ? '' : 's'} other channels are getting views on that you have ` +
      `never covered. Top one: ${gaps[0].topic}.`
  }

  return { gaps, onlyMine, shared: [...new Set(shared)], unmatched, headline }
}

/**
 * The searches worth running to find competitors, given what this channel is about.
 *
 * Deliberately searches this channel's OWN subject areas rather than "Pakistan finance"
 * in general: the useful comparison is against channels covering the same beat, not
 * against every finance video in existence.
 */
export function searchQueries(mine: MyVideoTitle[], topics: Topic[] = FINANCE_TOPICS, limit = 8): string[] {
  const counts = new Map<string, number>()
  for (const v of mine ?? []) {
    for (const t of topicsOf(v?.title ?? '', topics)) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
  }
  // The channel's own most-covered beats first; then any topic it has never touched, so
  // the search can actually FIND a gap rather than only confirming coverage.
  const covered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  const untouched = topics.filter((t) => !counts.has(t.id)).map((t) => t.id)
  const order = [...covered, ...untouched].slice(0, limit)
  return order.map((id) => `${topics.find((t) => t.id === id)!.label} Pakistan`)
}
