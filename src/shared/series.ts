/**
 * Series: the one structure on YouTube that makes the next click obvious.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * A standalone video ends and the viewer leaves. An episode ends and there is somewhere
 * to go — and the algorithm reads that next click as the video having done its job. A
 * finance channel is naturally serial: reserves every month, the budget every year, one
 * company at a time. The episodes already exist here; nothing links them.
 *
 * WHY IT READS THE TITLES INSTEAD OF ASKING
 * Making the user tag every video works for videos not yet made and does nothing for the
 * hundred already published. The series structure is already written down — in the titles.
 * Reading it out means the feature works on the back catalogue on the first run, which is
 * where the retention actually is.
 *
 * THE FAILURE THIS MUST NEVER COMMIT
 * Reading a number that is part of the TOPIC as an episode number. "Budget 2026" is not
 * episode 2026. "PSX crosses 78000" is not episode 78000. "Reserves at 11" is not episode
 * 11. Get that wrong and the tool invents series that do not exist and writes links
 * between unrelated videos — which is worse than doing nothing, because it goes in the
 * description of a published video. So an episode number is only ever read from an
 * EXPLICIT marker: #4, Part 2, Episode 3, Ep 3, 2 of 5, Hissa 2, Qist 3, or a deliberate
 * "| 5". A bare trailing number is never an episode.
 *
 * No AI: this is string work with a right answer, and it goes into a published
 * description where a plausible-but-wrong guess is permanent.
 */

export interface SeriesInput {
  /** Whatever identifies the video to the rest of the app. */
  id: string
  title: string
  /** ISO date, when known. Only used to break ties and to spot out-of-order uploads. */
  publishedAt?: string
  /** Watch URL, when known. Links are written without it rather than with a fake one. */
  url?: string
}

export interface Episode extends SeriesInput {
  /** The number read out of the title. */
  episode: number
  /** "of 5", when the title said so. */
  total?: number
  /** The title with the episode marker removed — the series name as written. */
  seriesName: string
}

/** The markers that genuinely mean "this is episode N". Order matters: longest first. */
const EPISODE_PATTERNS: { re: RegExp; label: string }[] = [
  // "Part 2 of 5" — the explicit word makes it unambiguous wherever it sits.
  { re: /\b(?:part|episode|ep\.?|hissa|qist)\s*(\d{1,3})\s+of\s+(\d{1,3})\b/i, label: 'of' },
  // A bare "2 of 5" ONLY at the very end of the title. "N of M" is ordinary finance
  // prose — "reserves fell 3 of 5 weeks", "2 of 4 banks missed" — and reading that as an
  // episode number is exactly the invented-series failure. A series marker sits at the
  // end of a title; a sentence about banks does not.
  { re: /\b(\d{1,3})\s+of\s+(\d{1,3})\s*$/, label: 'of' },
  { re: /\bpart\s*[-–—:.]?\s*(\d{1,3})\b/i, label: 'part' },
  { re: /\bepisode\s*[-–—:.]?\s*(\d{1,3})\b/i, label: 'episode' },
  { re: /\bep\.?\s*[-–—:.]?\s*(\d{1,3})\b/i, label: 'ep' },
  // Roman Urdu: hissa = part, qist = instalment. This channel's own words.
  { re: /\b(?:hissa|hisa|qist|kist)\s*[-–—:.]?\s*(\d{1,3})\b/i, label: 'hissa' },
  { re: /#\s*(\d{1,3})\b/, label: 'hash' },
  // "E03" — two digits minimum, so it cannot swallow a stray capital E.
  { re: /\bE(\d{2,3})\b/, label: 'e-number' },
  // "Title | 5" — a deliberate separator, so the number after it is meant.
  { re: /\|\s*(\d{1,3})\s*$/, label: 'pipe' }
]

/** Strips the leftovers a removed marker leaves behind: "Reserves Watch  —  " → "Reserves Watch". */
function tidy(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/[\s|]*[-–—:,.]+[\s|]*$/, '')
    .replace(/^[\s|]*[-–—:,.]+[\s|]*/, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reads the episode number out of a title, or returns null.
 *
 * Returns null far more often than it returns a number, on purpose.
 */
export function parseEpisode(title: string): { seriesName: string; episode: number; total?: number } | null {
  const t = (title ?? '').trim()
  if (!t) return null
  for (const { re, label } of EPISODE_PATTERNS) {
    const m = re.exec(t)
    if (!m) continue
    const episode = Number(m[1])
    if (!Number.isFinite(episode) || episode < 1) continue
    const total = label === 'of' ? Number(m[2]) : undefined
    // "2 of 5" where the total is smaller than the episode is not a series marker, it is
    // a sentence — "3 of 2" means something else entirely.
    if (total !== undefined && (!Number.isFinite(total) || total < episode)) continue
    const seriesName = tidy(t.replace(re, ' '))
    // A marker that eats the whole title leaves nothing to group on.
    if (!seriesName) continue
    return total !== undefined ? { seriesName, episode, total } : { seriesName, episode }
  }
  return null
}

/** Case, punctuation and spacing folded away, so "Reserves Watch" and "reserves-watch" group. */
export function normaliseSeriesName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export interface Series {
  /** The name as written in the titles — the longest form seen, which reads best. */
  name: string
  episodes: Episode[]
  /** Episode numbers missing from the middle of the run. */
  gaps: number[]
  /** Numbers used by more than one video — a real and common mess. */
  duplicates: number[]
  /** The number a new episode should take. */
  nextEpisode: number
  /** What the titles claimed the series length was, when any of them said. */
  declaredTotal?: number
}

/** Below this it is not a series, it is a video with a number in the title. */
export const MIN_EPISODES = 2

/**
 * Groups videos into series by what their titles say.
 *
 * Videos with no episode marker are simply absent from the result — they are not a
 * one-episode series, and inventing one would put a "Part 1 of 1" link in a description.
 */
export function groupIntoSeries(videos: SeriesInput[]): Series[] {
  const byKey = new Map<string, Episode[]>()
  for (const v of videos ?? []) {
    if (!v || typeof v.title !== 'string' || typeof v.id !== 'string') continue
    const parsed = parseEpisode(v.title)
    if (!parsed) continue
    const key = normaliseSeriesName(parsed.seriesName)
    if (!key) continue
    const ep: Episode = { ...v, ...parsed }
    const arr = byKey.get(key)
    if (arr) arr.push(ep)
    else byKey.set(key, [ep])
  }

  const out: Series[] = []
  for (const episodes of byKey.values()) {
    if (episodes.length < MIN_EPISODES) continue
    // Ordered by EPISODE NUMBER, not upload date. Publishing out of order is common and
    // sorting by date is exactly what puts episode 4 before episode 3 in a playlist.
    episodes.sort((a, b) => a.episode - b.episode || (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
    const numbers = episodes.map((e) => e.episode)
    const seen = new Map<number, number>()
    for (const n of numbers) seen.set(n, (seen.get(n) ?? 0) + 1)
    const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b)
    const highest = Math.max(...numbers)
    const gaps: number[] = []
    for (let n = Math.min(...numbers); n < highest; n++) if (!seen.has(n)) gaps.push(n)
    // The longest written form of the name, which reads best in a description.
    const name = episodes.map((e) => e.seriesName).sort((a, b) => b.length - a.length)[0]
    const declaredTotal = episodes.find((e) => e.total !== undefined)?.total
    out.push({ name, episodes, gaps, duplicates, nextEpisode: highest + 1, declaredTotal })
  }
  // Biggest series first — that is where the linking pays most.
  return out.sort((a, b) => b.episodes.length - a.episodes.length || a.name.localeCompare(b.name))
}

/** The series a title would join, if any of the existing ones. */
export function seriesForTitle(title: string, all: Series[]): Series | null {
  const parsed = parseEpisode(title)
  const key = normaliseSeriesName(parsed ? parsed.seriesName : title)
  if (!key) return null
  return (all ?? []).find((s) => normaliseSeriesName(s.name) === key) ?? null
}

export interface SeriesLinks {
  /** The block to paste into the video description. */
  description: string
  /** The pinned comment — where the next-episode click actually happens. */
  pinnedComment: string
  /** One line for the end screen / last card. */
  endScreen: string
}

/**
 * The cross-links for one episode.
 *
 * Only ever names episodes that EXIST. "Next: episode 5" written under episode 4 before
 * episode 5 is published is a link to nothing, and it stays wrong in a published
 * description until someone notices. When there is no next episode yet, it says so.
 *
 * An episode with no known URL is listed by title without a link rather than with a
 * made-up one.
 */
export function seriesLinks(series: Series, episodeInput: number): SeriesLinks {
  const eps = series.episodes
  // A non-number episode would print "episode NaN" into a PUBLISHED description, where
  // it stays until somebody notices. Fall back to the latest real episode instead — that
  // is the one being published when these links are asked for.
  const episode =
    Number.isFinite(episodeInput) && episodeInput > 0
      ? Math.floor(episodeInput)
      : (eps[eps.length - 1]?.episode ?? 1)
  const first = eps[0]
  const prev = [...eps].reverse().find((e) => e.episode < episode)
  const next = eps.find((e) => e.episode > episode)
  const line = (label: string, e: Episode | undefined): string | null =>
    e ? `${label}: ${e.title}${e.url ? `\n${e.url}` : ''}` : null

  const total = series.declaredTotal ?? eps[eps.length - 1].episode
  const parts = [
    `${series.name} — episode ${episode}${total >= episode ? ` of ${total}` : ''}`,
    line('Start here', first && first.episode !== episode ? first : undefined),
    line('Previous', prev),
    line('Next', next)
  ].filter((x): x is string => Boolean(x))

  const nextClick = next
    ? `Next up — ${next.title}${next.url ? `\n${next.url}` : ''}`
    : `Episode ${episode + 1} is being made. Subscribe and it will find you.`

  return {
    description: parts.join('\n\n'),
    pinnedComment: `${nextClick}\n\nThe whole ${series.name} series in order:\n${eps
      .map((e) => `${e.episode}. ${e.title}`)
      .join('\n')}`,
    endScreen: next ? `Episode ${next.episode}: ${next.title}` : `Episode ${episode + 1} coming soon`
  }
}

/** Playlist order — by episode number, which is the order publishing dates get wrong. */
export function playlistOrder(series: Series): Episode[] {
  return [...series.episodes].sort((a, b) => a.episode - b.episode)
}

/** Episodes published out of order — worth knowing, because playlists default to date. */
export function outOfOrderUploads(series: Series): Episode[] {
  const dated = series.episodes.filter((e) => e.publishedAt && Number.isFinite(Date.parse(e.publishedAt)))
  const out: Episode[] = []
  for (let i = 1; i < dated.length; i++) {
    if (Date.parse(dated[i].publishedAt!) < Date.parse(dated[i - 1].publishedAt!)) out.push(dated[i])
  }
  return out
}

/** One line about a series, in the app's plain voice. */
export function seriesHeadline(series: Series): string {
  const bits = [`${series.name} — ${series.episodes.length} episodes`]
  if (series.gaps.length) {
    bits.push(`missing ${series.gaps.length === 1 ? 'episode' : 'episodes'} ${series.gaps.join(', ')}`)
  }
  if (series.duplicates.length) {
    bits.push(`${series.duplicates.map((n) => `two videos both numbered ${n}`).join(', ')}`)
  }
  bits.push(`next one is ${series.nextEpisode}`)
  return `${bits.join(' · ')}.`
}

/** The whole picture, for the screen. */
export function seriesReport(videos: SeriesInput[]): { series: Series[]; headline: string } {
  const series = groupIntoSeries(videos)
  const numbered = series.reduce((n, s) => n + s.episodes.length, 0)
  const total = (videos ?? []).length
  let headline: string
  if (!total) headline = 'No videos yet.'
  else if (!series.length) {
    headline = `None of your ${total} videos are numbered as a series yet. Numbering them gives every video an obvious next click — put "#2" or "Part 2" in the title and this will do the rest.`
  } else {
    const problems = series.filter((s) => s.gaps.length || s.duplicates.length).length
    headline =
      `${series.length} series across ${numbered} of your ${total} videos` +
      (problems ? `, and ${problems} ${problems === 1 ? 'has' : 'have'} a numbering problem worth fixing.` : '.')
  }
  return { series, headline }
}
