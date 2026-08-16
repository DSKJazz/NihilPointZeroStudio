import type { YouTubeSignal } from '../../shared/types'
import { type ChannelReadProblem } from '../../shared/youtubeKeySetup'
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

export async function searchYouTubeSignals(query: string, maxResults = 8): Promise<YouTubeSignal[]> {
  const apiKey = getYouTubeApiKey()
  if (!apiKey || !query.trim()) return []
  try {
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

export interface MyVideo {
  id: string
  title: string
  publishedAt: string
  views: number
  likes?: number
  comments?: number
}

export async function readMyChannel(maxVideos = 200): Promise<{ videos: MyVideo[]; problem: ChannelReadProblem | null }> {
  const apiKey = getYouTubeApiKey()
  const channelId = getYouTubeChannelId()
  if (!apiKey) return { videos: [], problem: { kind: 'no-key' } }
  if (!channelId) return { videos: [], problem: { kind: 'no-channel' } }

  const keyHeader = { 'X-Goog-Api-Key': apiKey }

  // 1) Read the uploads playlist for the channel
  let uploads: string | undefined
  try {
    const chRes = await fetch(`${BASE_URL}/channels?part=contentDetails&id=${channelId}`, {
      headers: keyHeader,
      signal: AbortSignal.timeout(20_000)
    })

    if (!chRes.ok) {
      // 403 with a reason means Google refused the key (quota/invalid)
      if (chRes.status === 403) {
        try {
          const body = await chRes.json()
          const reason = (body?.error?.errors?.[0]?.reason as string) || 'refused'
          return { videos: [], problem: { kind: 'refused', detail: `Google refused access: ${reason}. Check API key allowance.` } }
        } catch (e) {
          return { videos: [], problem: { kind: 'refused', detail: 'Google refused access to channel resource.' } }
        }
      }
      return { videos: [], problem: { kind: 'google-error', detail: 'channel read failed' } }
    }

    const chData = await chRes.json()
    uploads = chData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return { videos: [], problem: { kind: 'no-channel' } }
  } catch (e) {
    return { videos: [], problem: { kind: 'unreachable' } }
  }

  // 2) Page through the uploads playlist, collecting video ids and basic metadata
  const found: MyVideo[] = []
  let pageToken = ''
  let partialProblem: ChannelReadProblem | null = null

  for (let page = 0; page < 10 && found.length < maxVideos; page++) {
    const url = `${BASE_URL}/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}` + (pageToken ? `&pageToken=${pageToken}` : '')
    try {
      const res = await fetch(url, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) {
        // If nothing was found yet, treat this as an error; otherwise mark partial and stop
        if (found.length === 0) {
          if (res.status === 403) return { videos: [], problem: { kind: 'refused', detail: 'Google refused access to playlist.' } }
          return { videos: [], problem: { kind: 'google-error', detail: 'Could not read playlist' } }
        }
        partialProblem = { kind: 'partial', detail: 'Stopped partway through reading uploads.' }
        break
      }
      const data = await res.json()
      for (const it of (data.items ?? []) as any[]) {
        const id = it.snippet?.resourceId?.videoId
        if (id && it.snippet?.title) {
          found.push({ id, title: it.snippet.title, publishedAt: it.snippet.publishedAt ?? '', views: 0 })
        }
      }
      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    } catch (e) {
      if (found.length === 0) return { videos: [], problem: { kind: 'unreachable' } }
      partialProblem = { kind: 'partial', detail: 'Stopped partway through reading uploads (network error).' }
      break
    }
  }

  if (found.length === 0) return { videos: [], problem: { kind: 'empty-channel' } }

  // 3) Fetch statistics for the collected videos (batched)
  const ids = found.map((v) => v.id)
  try {
    const statsUrl = `${BASE_URL}/videos?part=statistics&id=${ids.join(',')}`
    const statsRes = await fetch(statsUrl, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
    if (!statsRes.ok) {
      // For failures here prefer 'partial' so callers know some data exists
      return { videos: found.slice(0, maxVideos), problem: { kind: 'partial', detail: 'Failed to read view counts' } }
    }
    const statsData = await statsRes.json()
    const byId = new Map<string, any>()
    for (const it of (statsData.items ?? []) as any[]) byId.set(it.id, it.statistics ?? {})

    // Attach statistics — if any item is missing stats, mark partial
    let missing = false
    for (const v of found) {
      const s = byId.get(v.id) ?? {}
      if (s.viewCount === undefined) missing = true
      v.views = Number(s.viewCount ?? 0)
      if (s.likeCount !== undefined) v.likes = Number(s.likeCount)
      if (s.commentCount !== undefined) v.comments = Number(s.commentCount)
    }
    if (missing) return { videos: found.slice(0, maxVideos), problem: { kind: 'partial', detail: 'Some view counts missing or unreadable' } }

    return { videos: found.slice(0, maxVideos), problem: partialProblem }
  } catch (e) {
    return { videos: found.slice(0, maxVideos), problem: { kind: 'partial', detail: 'Failed to read view counts' } }
  }
}

export async function fetchMyChannelVideos(maxVideos = 200): Promise<MyVideo[]> {
  const apiKey = getYouTubeApiKey()
  const channelId = getYouTubeChannelId()
  if (!apiKey || !channelId) return []
  try {
    const result = await readMyChannel(maxVideos)
    return result.videos
  } catch {
    return []
  }
}

export async function fetchComments(videoIds: string[], perVideo = 100): Promise<{ text: string; likes: number; videoId: string }[]> {
  const apiKey = getYouTubeApiKey()
  if (!apiKey || !videoIds.length) return []
  const out: { text: string; likes: number; videoId: string }[] = []
  try {
    for (const videoId of videoIds) {
      const url = `${BASE_URL}/commentThreads?part=snippet&maxResults=${Math.min(100, perVideo)}&order=relevance&videoId=${videoId}`
      const res = await fetch(url, { headers: { 'X-Goog-Api-Key': apiKey }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) continue
      const data = await res.json()
      for (const it of (data.items ?? []) as any[]) {
        const s = it.snippet?.topLevelComment?.snippet
        const text = s?.textOriginal ?? s?.textDisplay
        if (text) out.push({ text, likes: Number(s?.likeCount ?? 0), videoId })
      }
    }
  } catch {
    /* best-effort */
  }
  return out
}
