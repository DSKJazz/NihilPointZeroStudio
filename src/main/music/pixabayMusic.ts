/**
 * Free, copyright-safe background music from Pixabay. Pixabay Content License:
 * free for commercial use, no attribution required, safe for monetised YouTube.
 *
 * A caveat worth knowing: Pixabay publicly documents its image and video APIs, but
 * NOT an audio one. The /api/audio/ route does exist (nonsense paths under /api/
 * answer 404 while this one answers like the documented routes), but because it is
 * undocumented it may be absent for some keys and could change without notice. So
 * every function here degrades to "no music" rather than throwing, and the caller
 * leaves the video silent instead of failing the whole render.
 */
import { writeFileSync } from 'fs'
import { sanitizeKeyword } from '../data/stockFootage'
import { searchMusic } from '../data/freeMusic'

import type { MusicTrack } from '../../shared/types'

export type { MusicTrack }

/** Licences that impose no crediting duty at all. */
function requiresCredit(license: string): boolean {
  const l = license.toLowerCase()
  return !(l === 'cc0' || l === 'pdm' || l === 'pixabay' || l.includes('publicdomain'))
}

interface PixabayAudioHit {
  id: number
  duration?: number
  tags?: string
  pageURL?: string
  audio?: string
  audio_url?: string
  previewURL?: string
  user?: string
}

const ENDPOINT = 'https://pixabay.com/api/audio/'

/** Pixabay returns the playable file under one of several key names depending on route. */
function hitUrl(h: PixabayAudioHit): string | null {
  return h.audio || h.audio_url || h.previewURL || null
}

/**
 * Searches Pixabay music for a mood/genre phrase. Returns [] on ANY failure — offline,
 * bad key, endpoint withdrawn, no results — so a missing soundtrack never breaks a build.
 */
export async function searchPixabayMusic(query: string, key: string, count = 6): Promise<MusicTrack[]> {
  const q = sanitizeKeyword(query)
  if (!key || !q) return []
  const url = `${ENDPOINT}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=${Math.max(3, count)}&safesearch=true`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: PixabayAudioHit[] }
    const out: MusicTrack[] = []
    for (const h of data.hits ?? []) {
      const u = hitUrl(h)
      if (!u) continue
      out.push({
        id: String(h.id),
        title: (h.tags || 'Untitled').split(',')[0].trim() || 'Untitled',
        tags: h.tags || '',
        durationSec: h.duration ?? 0,
        url: u,
        pageUrl: h.pageURL,
        source: 'pixabay',
        license: 'Pixabay',
        needsAttribution: false
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Runs several mood keywords and merges the results, best-matching first.
 * Deduplicated by track id so the swap list never shows the same track twice.
 */
export async function searchMoods(keywords: string[], key: string, perMood = 4): Promise<MusicTrack[]> {
  const lists = await Promise.all(keywords.slice(0, 3).map((k) => searchPixabayMusic(k, key, perMood)))
  const seen = new Set<string>()
  const merged: MusicTrack[] = []
  // Round-robin across moods so the top pick isn't dominated by whichever keyword
  // happened to return the most hits.
  for (let i = 0; i < perMood; i++) {
    for (const list of lists) {
      const t = list[i]
      if (t && !seen.has(t.id)) {
        seen.add(t.id)
        merged.push(t)
      }
    }
  }
  return merged
}

/**
 * Prefers a track long enough to cover the video without an obvious loop seam, but
 * never returns nothing when something is available — a slightly short bed that loops
 * beats silence.
 */
export function pickBestTrack(tracks: MusicTrack[], videoSeconds: number): MusicTrack | null {
  if (!tracks.length) return null
  const longEnough = tracks.filter((t) => t.durationSec >= videoSeconds)
  if (longEnough.length) return longEnough.sort((a, b) => a.durationSec - b.durationSec)[0]
  return tracks.slice().sort((a, b) => b.durationSec - a.durationSec)[0]
}

/** Downloads a track to `outPath`. Throws on failure (the caller decides what that means). */
export async function downloadMusicFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NIHILPOINTZERO-OS/1.0' },
    signal: AbortSignal.timeout(120_000)
  })
  if (!res.ok) throw new Error(`Music download failed (HTTP ${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('Downloaded music file was empty.')
  writeFileSync(outPath, buf)
}

/**
 * Finds free music for a set of moods, using whichever sources are available.
 *
 * Pixabay first when the user has a key (its library is the better fit for video beds
 * and needs no attribution), then keyless Openverse so this feature still works for
 * someone who has never opened Settings. Returns [] rather than throwing.
 */
export async function findMusic(moods: string[], pixabayKey?: string): Promise<MusicTrack[]> {
  const out: MusicTrack[] = []
  const seen = new Set<string>()
  const add = (t: MusicTrack): void => {
    if (t.url && !seen.has(t.url)) {
      seen.add(t.url)
      out.push(t)
    }
  }
  if (pixabayKey) (await searchMoods(moods, pixabayKey)).forEach(add)
  if (out.length < 4) {
    for (const mood of moods.slice(0, 3)) {
      if (out.length >= 8) break
      const res = await searchMusic(`${mood} instrumental background`)
      for (const t of res.tracks.slice(0, 4)) {
        if (!t.audioUrl) continue
        const license = (t.license || 'CC').toUpperCase()
        add({
          id: t.id,
          title: t.title,
          tags: t.artist,
          durationSec: t.durationSec ?? 0,
          url: t.audioUrl,
          pageUrl: t.landingUrl,
          source: 'openverse',
          license,
          needsAttribution: requiresCredit(license)
        })
      }
    }
  }
  // Credit-free tracks first: the user wants music they can drop in without owing
  // anyone a line in the description.
  return out.sort((a, b) => Number(a.needsAttribution) - Number(b.needsAttribution))
}
