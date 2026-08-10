import type { YouTubeSignal } from '../../shared/types'
import { classifyKeyResponse, type ChannelReadProblem } from '../../shared/youtubeKeySetup'
import { getYouTubeApiKey, getYouTubeChannelId } from '../store'

const BASE_URL = 'https://www.googleapis.com/youtube/v3'

interface YouTubeSearchItem {
  id?: { videoId?: string }
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string }
}

interface YouTubeVideoStatsItem {
  id: string
  statistics?: { viewCount?: string }
}

/**
 * Real competitive-landscape grounding for a topic, via the free YouTube Data API v3
 * (10,000 quota units/day, no billing required). Returns [] silently if no key is
 * configured or the request fails — callers should treat this as a best-effort
 * enrichment, not a required dependency.
 */
export async function searchYouTubeSignals(query: string, maxResults = 8): Promise<YouTubeSignal[]> {
  const apiKey = getYouTubeApiKey()
  if (!apiKey || !query.trim()) return []

  try {
    // Key travels in the X-Goog-Api-Key HEADER, not the URL — URLs get logged by
    // proxies/intermediaries; headers don't.
    const keyHeader = { 'X-Goog-Api-Key': apiKey }
    const searchUrl = `${BASE_URL}/search?part=snippet&type=video&order=relevance&maxResults=${maxResults}&q=${encodeURIComponent(query)}`
    const searchRes = await fetch(searchUrl, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
    if (!searchRes.ok) return []
    const searchData = await searchRes.json()
    const items: YouTubeSearchItem[] = Array.isArray(searchData.items) ? searchData.items : []
    const ids = items.map((it) => it.id?.videoId).filter((id): id is string => !!id)
    if (!ids.length) return []

    const statsUrl = `${BASE_URL}/videos?part=statistics&id=${ids.join(',')}`
    const statsRes = await fetch(statsUrl, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
    const statsData = statsRes.ok ? await statsRes.json() : { items: [] }
    const viewsById = new Map<string, number>()
    for (const it of (statsData.items ?? []) as YouTubeVideoStatsItem[]) {
      viewsById.set(it.id, Number(it.statistics?.viewCount ?? 0))
    }

    return items
      .filter((it) => it.snippet?.title && it.id?.videoId)
      .map((it) => ({
        title: it.snippet!.title!,
        channelTitle: it.snippet?.channelTitle ?? 'Unknown channel',
        viewCount: viewsById.get(it.id!.videoId!) ?? 0,
        publishedAt: it.snippet?.publishedAt ?? ''
      }))
  } catch {
    return []
  }
}

interface PlaylistItem {
  snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } }
}

/** One of the user's own uploads, with the numbers the analyses need. */
export interface MyVideo {
  id: string
  title: string
  publishedAt: string
  views: number
  likes?: number
  comments?: number
}

/**
 * The user's OWN uploads — the input for every "learn from your channel" feature.
 *
 * Goes through the channel's uploads PLAYLIST rather than the search endpoint on purpose.
 * `search` costs 100 quota units per call against a 10,000/day allowance, so eight calls
 * would burn a tenth of the day; `playlistItems` and `videos` cost 1 unit each. Reading a
 * hundred of your own videos therefore costs about 4 units instead of 400.
 *
 * Returns [] silently when there is no key, no channel id, or the request fails. Every
 * caller treats an empty history as "not enough data to say anything", which is the
 * honest answer when the data could not be read.
 */
/**
 * Reads the user's own uploads AND says why, when it cannot.
 *
 * This replaced `fetchMyChannelVideos`, which returned a bare `[]` for a missing key, a
 * missing channel id, a key Google refuses, a dead connection and a channel with no
 * videos alike — so its callers printed one sentence covering all five, and four of them
 * were described wrongly by it. Four are fixable by the user in about a minute; the fifth
 * is not a fault at all. The reason now travels with the result — see `ChannelReadProblem`.
 *
 * The old wrapper is gone rather than kept for compatibility: once the last caller moved
 * across, the only thing still importing it was its own test, and a function alive only
 * through its tests is the thing CLAUDE.md warns about.
 */
export async function readMyChannel(maxVideos = 200): Promise<{ videos: MyVideo[]; problem: ChannelReadProblem | null }> {
  const apiKey = getYouTubeApiKey()
  const channelId = getYouTubeChannelId()
  if (!apiKey) return { videos: [], problem: { kind: 'no-key' } }
  if (!channelId) return { videos: [], problem: { kind: 'no-channel' } }
  const keyHeader = { 'X-Goog-Api-Key': apiKey }

  /** Google said no: turn its reply into the same plain sentence the walkthrough uses. */
  const refused = async (res: Response): Promise<{ videos: MyVideo[]; problem: ChannelReadProblem }> => {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* an unreadable error body still leaves the status, which carries most of it */
    }
    const verdict = classifyKeyResponse(res.status, body)
    // A 5xx from Google is NOT a refusal, and must not be painted red as one. Only a
    // 'broken' verdict — an actual no, with a reason — counts as refused.
    if (verdict.state === 'unknown') {
      return { videos: [], problem: { kind: 'google-error', detail: `${verdict.title}.` } }
    }
    const detail = verdict.state === 'broken' ? `${verdict.title}.` : ''
    return { videos: [], problem: { kind: 'refused', detail } }
  }

  try {
    // The uploads playlist id is the channel id with its second character switched.
    const chRes = await fetch(`${BASE_URL}/channels?part=contentDetails&id=${channelId}`, {
      headers: keyHeader,
      signal: AbortSignal.timeout(20_000)
    })
    if (!chRes.ok) return refused(chRes)
    const chData = await chRes.json()
    const uploads: string | undefined = chData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) {
      // The request itself succeeded, so the key is fine — the id points at nothing.
      return { videos: [], problem: { kind: 'no-channel' } }
    }

    const found: { id: string; title: string; publishedAt: string }[] = []
    let pageToken = ''
    /** Set when the read stopped early — see the partial-read note below. */
    let truncated = ''
    // Bounded: a runaway pagination loop against a paid-quota API is its own bug.
    for (let page = 0; page < 10 && found.length < maxVideos; page++) {
      const url =
        `${BASE_URL}/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}` +
        (pageToken ? `&pageToken=${pageToken}` : '')
      const res = await fetch(url, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
      // A refusal on the FIRST page means nothing was read at all, and that is a reason
      // worth reporting. Refused later, we keep whatever pages did come back.
      if (!res.ok) {
        if (!found.length) return refused(res)
        // Some pages came back and then it stopped. Keeping them beats losing them, but
        // reporting it as a clean read would let a partial history quietly become the
        // basis of "what works on your channel".
        truncated = `Read ${found.length} of your videos and then the request was refused partway through.`
        break
      }
      const data = await res.json()
      for (const it of (data.items ?? []) as PlaylistItem[]) {
        const id = it.snippet?.resourceId?.videoId
        if (id && it.snippet?.title) {
          found.push({ id, title: it.snippet.title, publishedAt: it.snippet.publishedAt ?? '' })
        }
      }
      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    }
    if (!found.length) return { videos: [], problem: { kind: 'empty-channel' } }

    // Statistics come 50 ids at a time.
    const stats = new Map<string, { views: number; likes?: number; comments?: number }>()
    for (let i = 0; i < found.length; i += 50) {
      const ids = found.slice(i, i + 50).map((v) => v.id)
      const res = await fetch(`${BASE_URL}/videos?part=statistics&id=${ids.join(',')}`, {
        headers: keyHeader,
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) {
        // Not a shrug. Every video in this batch would otherwise be recorded as having
        // ZERO views — a number, not a blank — and the title analysis would then conclude
        // that whatever those titles have in common does not work. A false figure is worse
        // than a missing one, so the read reports itself as incomplete.
        truncated = truncated || `The view counts for ${Math.min(50, found.length - i)} of your videos could not be read.`
        continue
      }
      const data = await res.json()
      for (const it of (data.items ?? []) as {
        id: string
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
      }[]) {
        stats.set(it.id, {
          views: Number(it.statistics?.viewCount ?? 0),
          likes: it.statistics?.likeCount === undefined ? undefined : Number(it.statistics.likeCount),
          comments: it.statistics?.commentCount === undefined ? undefined : Number(it.statistics.commentCount)
        })
      }
    }

    return {
      videos: found.slice(0, maxVideos).map((v) => ({ ...v, views: stats.get(v.id)?.views ?? 0, ...stats.get(v.id) })),
      problem: truncated ? { kind: 'partial', detail: truncated } : null
    }
  } catch {
    // Timed out, DNS failed, offline. NOT the same as "this channel has no videos", and
    // it must never be shown as though it were.
    return { videos: [], problem: { kind: 'unreachable' } }
  }
}

/**
 * Top-level comments across the given videos.
 *
 * Replies are deliberately not fetched: a reply is usually a conversation about an
 * existing comment rather than a new question, and including them would count one
 * person's thread as several people asking.
 */
export async function fetchComments(videoIds: string[], perVideo = 100): Promise<{ text: string; likes: number; videoId: string }[]> {
  const apiKey = getYouTubeApiKey()
  if (!apiKey || !videoIds.length) return []
  const keyHeader = { 'X-Goog-Api-Key': apiKey }
  const out: { text: string; likes: number; videoId: string }[] = []

  for (const videoId of videoIds) {
    try {
      const url = `${BASE_URL}/commentThreads?part=snippet&maxResults=${Math.min(100, perVideo)}&order=relevance&videoId=${videoId}`
      const res = await fetch(url, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
      // A single video with comments disabled must not abort the whole read.
      if (!res.ok) continue
      const data = await res.json()
      for (const it of (data.items ?? []) as {
        snippet?: { topLevelComment?: { snippet?: { textOriginal?: string; textDisplay?: string; likeCount?: number } } }
      }[]) {
        const s = it.snippet?.topLevelComment?.snippet
        const text = s?.textOriginal ?? s?.textDisplay
        if (text) out.push({ text, likes: Number(s?.likeCount ?? 0), videoId })
      }
    } catch {
      /* one unreadable video is not a reason to return nothing */
    }
  }
  return out
}
