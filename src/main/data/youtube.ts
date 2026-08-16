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
  try {
    const keyHeader = { 'X-Goog-Api-Key': apiKey }
    const chRes = await fetch(`${BASE_URL}/channels?part=contentDetails&id=${channelId}`, {
      headers: keyHeader,
      signal: AbortSignal.timeout(20_000)
    })
    if (!chRes.ok) return { videos: [], problem: { kind: 'google-error', detail: 'channel read failed' } }
    const chData = await chRes.json()
    const uploads: string | undefined = chData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return { videos: [], problem: { kind: 'no-channel' } }
    const found: MyVideo[] = []
    let pageToken = ''
    for (let page = 0; page < 10 && found.length < maxVideos; page++) {
      const url = `${BASE_URL}/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}` + (pageToken ? `&pageToken=${pageToken}` : '')
      const res = await fetch(url, { headers: keyHeader, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) break
      const data = await res.json()
      for (const it of (data.items ?? []) as any[]) {
        const id = it.snippet?.resourceId?.videoId
        if (id && it.snippet?.title) {
          found.push({ id, title: it.snippet.title, publishedAt: it.snippet.publishedAt ?? '', views: 0 })
        }
      }
      pageToken = data.nextPageToken ?? ''
      if (!pageToken) break
    }
    return { videos: found.slice(0, maxVideos), problem: null }
  } catch {
    return { videos: [], problem: { kind: 'unreachable' } }
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
