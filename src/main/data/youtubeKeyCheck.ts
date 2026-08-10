/**
 * Asking Google, once, whether a key actually works — and finding the channel id
 * so the user never has to go looking for it.
 *
 * WHY A LIVE CHECK AND NOT JUST A SAVE BUTTON
 * Before this, pasting a key did nothing observable. The box went green because a
 * string had been stored, not because anything had been verified, and then Your
 * Channel returned an empty page days later with no explanation. A key that has been
 * saved but never used is not a configured key, it is an assumption.
 *
 * COST
 * `i18nLanguages.list` is the cheapest endpoint in the whole API — 1 unit of the free
 * 10,000 per day — and it needs no ids, no channel and no OAuth, so it answers "is this
 * key alive" and nothing else. Checking a key a hundred times a day would still leave
 * 99% of the allowance.
 *
 * The classification of whatever comes back lives in `src/shared/youtubeKeySetup.ts`
 * with its tests; this file only performs the requests.
 */
import {
  classifyKeyResponse,
  cleanPastedKey,
  inspectKeyShape,
  normalizeChannelInput,
  offlineVerdict,
  type ChannelResolution,
  type KeyVerdict
} from '../../shared/youtubeKeySetup'
import { getYouTubeApiKey } from '../store'

const BASE_URL = 'https://www.googleapis.com/youtube/v3'
const TIMEOUT_MS = 15_000

/** Key in the header, never the URL — URLs get logged by proxies, headers do not. */
function keyHeader(key: string): Record<string, string> {
  return { 'X-Goog-Api-Key': key }
}

async function callApi(path: string, key: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: keyHeader(key),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    // A body is expected on both success and failure; an unparseable one is not a
    // reason to lose the status code, which carries most of the meaning.
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return { status: res.status, body }
  } catch {
    // Timed out, DNS failed, offline. Deliberately NOT the same as "Google said no".
    return null
  }
}

/**
 * One real request with the pasted key, turned into a plain-English verdict.
 *
 * Shape problems are caught first so the obvious mistakes (an OAuth client id, a
 * half-copied key) are named precisely instead of coming back as Google's generic
 * "API key not valid".
 */
export async function verifyYouTubeKey(rawKey: string): Promise<KeyVerdict> {
  const key = cleanPastedKey(rawKey)
  const shape = inspectKeyShape(key)
  if (!shape.ok) {
    return {
      state: 'broken',
      title: shape.problem ?? 'That does not look like a Google API key',
      message: 'Checked before contacting Google, because this one can be spotted from the key itself.',
      fix: shape.fix ?? 'Copy the key again from the API keys section of the credentials page.'
    }
  }

  const res = await callApi('/i18nLanguages?part=snippet&hl=en', key)
  if (!res) return offlineVerdict()
  return classifyKeyResponse(res.status, res.body)
}

/** Verifies the key already saved in settings, for the "check it again" button. */
export async function verifySavedYouTubeKey(): Promise<KeyVerdict> {
  const saved = getYouTubeApiKey()
  if (!saved) {
    return {
      state: 'broken',
      title: 'No YouTube key is saved yet',
      message: 'Your Channel, the comment questions and the competitor gaps all read nothing until there is one.',
      fix: 'Follow the numbered steps above — it is free and takes about three minutes.'
    }
  }
  return verifyYouTubeKey(saved)
}

export type { ChannelResolution }

interface ChannelApiItem {
  id?: string
  snippet?: { title?: string }
  statistics?: { videoCount?: string; subscriberCount?: string }
}

function toResolution(items: ChannelApiItem[] | undefined, fallbackId?: string): ChannelResolution | null {
  const item = items?.[0]
  const channelId = item?.id ?? fallbackId
  if (!item || !channelId) return null
  return {
    ok: true,
    channelId,
    title: item.snippet?.title ?? channelId,
    videoCount: item.statistics?.videoCount === undefined ? undefined : Number(item.statistics.videoCount),
    subscribers: item.statistics?.subscriberCount === undefined ? undefined : Number(item.statistics.subscriberCount)
  }
}

/**
 * Turn whatever the user knows about their channel into the id the API needs.
 *
 * The channel ID box used to demand `UCxxxxxxxxxxxxxxxxxxxxxx`, a string YouTube shows
 * nowhere in its normal interface — it is three levels deep in Advanced settings, and
 * everything the user sees day to day says `@theirname`. So the handle, the browser
 * URL and the id all work here, and the found channel's NAME is handed back so they
 * can see it is the right one before saving. Confirming by name is the only check a
 * person can actually perform on a 24-character random string.
 *
 * Order matters for cost: handle and id lookups are 1 unit each; `search` is 100, so it
 * is the last resort and only for vanity URLs and free text, which nothing else resolves.
 */
export async function resolveYouTubeChannel(input: string, rawKey?: string): Promise<ChannelResolution> {
  const key = cleanPastedKey(rawKey ?? '') || getYouTubeApiKey() || ''
  if (!key) {
    return {
      ok: false,
      certain: true,
      problem: 'There is no working YouTube key yet, and finding a channel needs one.',
      fix: 'Do the key steps above first, then come back to this box.'
    }
  }

  const parsed = normalizeChannelInput(input)
  if (parsed.kind === 'empty') {
    return {
      ok: false,
      certain: true,
      problem: 'Nothing was typed in.',
      fix: 'Paste your channel address — for example youtube.com/@yourname — or just your @name.'
    }
  }
  if (inspectKeyShape(cleanPastedKey(input)).ok) {
    // A key pasted into the channel box would be URL-encoded into the /search query
    // string and logged by every proxy between here and Google — the one place the rest
    // of this file works hard to keep keys out of. Refused before any request.
    return {
      ok: false,
      certain: true,
      problem: 'That looks like your API key, not your channel.',
      fix: 'The key goes in the box in step 5. This box wants your channel — your @name, or the address of your channel page.'
    }
  }
  if (parsed.kind === 'video') {
    // Whatever is in the address bar is usually a video, so this is the likeliest wrong
    // paste there is. Saying so costs nothing; searching for it would cost 100 quota
    // units and come back with somebody else's channel.
    return {
      ok: false,
      certain: true,
      problem: 'That is a link to a video, not to your channel.',
      fix: 'Open the video, click your own channel name underneath it, and copy the address from the bar then — it will look like youtube.com/@yourname.'
    }
  }

  const parts = 'part=snippet,statistics'
  const attempts: string[] = []
  if (parsed.kind === 'id') attempts.push(`/channels?${parts}&id=${encodeURIComponent(parsed.value)}`)
  if (parsed.kind === 'handle') {
    attempts.push(`/channels?${parts}&forHandle=${encodeURIComponent(parsed.value)}`)
    // Some very old channels answer to forUsername and not to a handle.
    attempts.push(`/channels?${parts}&forUsername=${encodeURIComponent(parsed.value.replace(/^@/, ''))}`)
  }
  if (parsed.kind === 'username') {
    attempts.push(`/channels?${parts}&forUsername=${encodeURIComponent(parsed.value)}`)
    attempts.push(`/channels?${parts}&forHandle=${encodeURIComponent('@' + parsed.value)}`)
  }

  /** An exact id either exists or it does not — search cannot second-guess that. */
  const exact = parsed.kind === 'id'

  for (const path of attempts) {
    const res = await callApi(path, key)
    if (!res) {
      return {
        ok: false,
        certain: false,
        problem: 'Could not reach Google, so nothing is known either way.',
        fix: 'Check the internet connection and press Find my channel again. Nothing has been saved.'
      }
    }
    if (res.status >= 400) {
      const verdict = classifyKeyResponse(res.status, res.body)
      if (verdict.state === 'broken') return { ok: false, certain: true, problem: verdict.title, fix: verdict.fix }
      return { ok: false, certain: false, problem: verdict.state === 'unknown' ? verdict.title : 'Unexpected reply', fix: 'Try again in a moment.' }
    }
    const found = toResolution((res.body as { items?: ChannelApiItem[] })?.items, exact ? parsed.value : undefined)
    if (found) return found
    if (exact) {
      // Google answered, and the answer was "no such channel". Spending 100 units
      // searching for a 24-character random string cannot turn that into a yes.
      return {
        ok: false,
        certain: true,
        problem: 'Google has no channel with that ID.',
        fix: 'Check for a missing character, or paste your channel address instead — youtube.com/@yourname works here too.'
      }
    }
  }

  // Last resort: a real search. 100 units of the daily 10,000 — a hundredth of a day's
  // allowance, spent once during setup, which is a fair price for not making someone
  // hunt through Advanced settings for a 24-character id.
  const searchRes = await callApi(
    `/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(parsed.value.replace(/^@/, ''))}`,
    key
  )
  if (!searchRes) {
    return {
      ok: false,
      certain: false,
      problem: 'Could not reach Google, so nothing is known either way.',
      fix: 'Check the internet connection and press Find my channel again. Nothing has been saved.'
    }
  }
  // The status has to be read BEFORE the body. Search is the 100-unit call, so it is the
  // one most likely to be the request that exhausts the daily allowance — and a refused
  // search returns no items, which looked exactly like "this channel does not exist". The
  // app would then tell someone their own channel could not be found.
  if (searchRes.status >= 400) {
    const verdict = classifyKeyResponse(searchRes.status, searchRes.body)
    return verdict.state === 'broken'
      ? { ok: false, certain: true, problem: verdict.title, fix: verdict.fix }
      : { ok: false, certain: false, problem: verdict.state === 'unknown' ? verdict.title : 'Unexpected reply', fix: 'Nothing has been saved. Try again in a moment.' }
  }

  const hit = (searchRes.body as { items?: { id?: { channelId?: string }; snippet?: { title?: string } }[] })?.items?.[0]
  if (hit?.id?.channelId) {
    // Flagged as a guess: the caller must not save this without the user agreeing.
    return { ok: true, channelId: hit.id.channelId, title: hit.snippet?.title ?? hit.id.channelId, viaSearch: true }
  }

  return {
    ok: false,
    certain: true,
    problem: 'No channel was found with that name or address.',
    fix: 'Open your channel in a browser and copy the address from the bar at the top — it looks like youtube.com/@yourname.'
  }
}
