/**
 * FREE-CLOUD real-video route #2: Pollinations' unified gen API.
 *
 * Why this exists: the Puter route needs a Puter account sign-in, and Puter's
 * verification does not accept phone numbers from every country (it rejected a
 * Pakistani number in practice, 2026-07-31). Pollinations registration is a
 * developer key from enter.pollinations.ai (GitHub/email — NO phone). Free Pollen
 * comes from the dashboard's QUESTS tab (verified live 2026-07-31: "Tiers have
 * stopped" — the old daily tier grants became claimable Quest Pollen; quests are
 * retroactive, e.g. "Create your first API key" pays 0.25 the moment it's claimed).
 *
 * Contract, verified live against gen.pollinations.ai/openapi.json (2026-07-31):
 *   GET https://gen.pollinations.ai/video/{prompt}?model=...&width=...&height=...
 *       &seed=...&duration=<1..120>          (Authorization: Bearer pk_/sk_ key)
 *   200 -> raw video/mp4 bytes
 *   401 -> no/invalid key · 402 -> Pollen used up · 429 -> too fast · 5xx -> their end
 *   GET https://gen.pollinations.ai/account/balance -> { balance: number }
 *
 * Cheapest real-motion model: wan-fast (Wan 2.2) at 0.01 Pollen/second — a 5s scene
 * costs ~0.05 Pollen, so even a small daily grant is several scenes every day.
 * Electron-free and config-passed-in, so the whole module is unit-testable.
 */
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const BASE = 'https://gen.pollinations.ai'
export const DEFAULT_POLLINATIONS_VIDEO_MODEL = 'wan-fast'
/** Pollinations' own ceiling for video jobs is 15 minutes (their 2026-07-28 news);
 * measured live: a queued wan-fast clip can exceed 10. Match their ceiling. */
const CLIP_TIMEOUT_MS = 15 * 60_000

/** Builds the generation URL. Pure + tested. */
export function buildPollinationsVideoUrl(opts: {
  prompt: string
  model?: string
  width: number
  height: number
  seed: number
  seconds: number
}): string {
  const model = (opts.model || DEFAULT_POLLINATIONS_VIDEO_MODEL).trim()
  const duration = Math.min(120, Math.max(1, Math.round(opts.seconds)))
  const q =
    `model=${encodeURIComponent(model)}&width=${Math.round(opts.width)}&height=${Math.round(opts.height)}` +
    `&seed=${Math.round(opts.seed)}&duration=${duration}`
  return `${BASE}/video/${encodeURIComponent(opts.prompt)}?${q}`
}

/** Turns an HTTP failure into the plain-English reason for the build log. Pure + tested. */
export function classifyPollinationsError(status: number, body?: string): string {
  if (status === 401) return 'the Pollinations key is missing or invalid — check Settings → AI Video'
  if (status === 402) return 'your Pollen is used up — claim more from the Quests tab on enter.pollinations.ai'
  if (status === 403) return 'this Pollinations key is not allowed to use that video model'
  if (status === 429) return 'Pollinations is rate-limiting — too many requests at once'
  if (status >= 500) return `Pollinations had a problem on their end (HTTP ${status})`
  const detail = (body || '').slice(0, 160)
  return `Pollinations returned HTTP ${status}${detail ? ` — ${detail}` : ''}`
}

/**
 * Validates a key WITHOUT spending any Pollen. Verified live 2026-07-31: the two key
 * kinds behave differently — /account/balance answers pk_ keys but 403s perfectly
 * valid sk_ keys, while /account/key answers BOTH and also reveals the key's model
 * allowlist (pk_ keys are often created with an EMPTY allowlist, which 403s all
 * generation). So: validity + permissions via /account/key, balance best-effort.
 * Never throws.
 */
export async function checkPollinationsKey(key: string): Promise<{ ok: boolean; balance?: number; detail: string }> {
  if (!key.trim()) return { ok: false, detail: 'No key saved yet — get a free one at enter.pollinations.ai (no phone needed).' }
  const auth = { Authorization: `Bearer ${key.trim()}` }
  try {
    const res = await fetch(`${BASE}/account/key`, { headers: auth, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, detail: classifyPollinationsError(res.status, await res.text().catch(() => '')) }
    const info = (await res.json()) as { valid?: boolean; type?: string; permissions?: { models?: string[] | null } }
    if (!info.valid) return { ok: false, detail: 'Pollinations says this key is not valid — create a fresh one at enter.pollinations.ai.' }
    // An empty models allowlist blocks ALL generation with 403 — warn before any build.
    if (Array.isArray(info.permissions?.models) && info.permissions.models.length === 0) {
      return {
        ok: false,
        detail:
          `This ${info.type ?? ''} key has NO models enabled, so every generation is refused. ` +
          'Use your SECRET key (sk_…) instead, or edit this key on enter.pollinations.ai and allow video models.'
      }
    }
    // Balance is a bonus: it only answers some key types — a 403 here means nothing bad.
    let balance: number | undefined
    try {
      const bal = await fetch(`${BASE}/account/balance`, { headers: auth, signal: AbortSignal.timeout(8_000) })
      if (bal.ok) {
        const data = (await bal.json()) as { balance?: number }
        if (typeof data.balance === 'number') balance = data.balance
      }
    } catch {
      /* balance is optional */
    }
    if (balance !== undefined && balance <= 0) {
      return {
        ok: true,
        balance,
        detail:
          'Key works ✓ but your Pollen balance is 0 — real-motion scenes will fall back to stills until you have some. ' +
          'Free Pollen: open the Quests tab on enter.pollinations.ai and CLAIM completed quests (they are retroactive).'
      }
    }
    return {
      ok: true,
      balance,
      detail:
        balance !== undefined
          ? `Key works ✓ — ${balance.toFixed(2)} Pollen available (a 5s scene on wan-fast costs ~0.05).`
          : 'Key works ✓ (balance not readable for this key type — that is normal for sk_ keys).'
    }
  } catch {
    return { ok: false, detail: 'Could not reach Pollinations (offline?) — try again later.' }
  }
}

/**
 * Generates ONE real motion clip and returns a local MP4 path. Throws with a
 * classified plain-English reason on any failure — the caller decides the fallback
 * (per-scene slideshow still).
 */
export async function generatePollinationsClip(opts: {
  key: string
  model?: string
  prompt: string
  seconds: number
  width: number
  height: number
  seed: number
  signal?: AbortSignal
  onStatus?: (s: string) => void
}): Promise<string> {
  if (!opts.key.trim()) throw new Error('the Pollinations key is missing — add it in Settings → AI Video')
  if (opts.signal?.aborted) throw new Error('stopped')
  opts.onStatus?.('Asking Pollinations for real video (free daily Pollen)…')
  const url = buildPollinationsVideoUrl(opts)
  const timeout = AbortSignal.timeout(CLIP_TIMEOUT_MS)
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  const signal = opts.signal && anyFn ? anyFn.call(AbortSignal, [opts.signal, timeout]) : (opts.signal ?? timeout)
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${opts.key.trim()}` }, signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new Error('stopped', { cause: err })
    throw new Error(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'the generation took too long'
        : 'Pollinations could not be reached (offline?)',
      { cause: err }
    )
  }
  if (!res.ok) throw new Error(classifyPollinationsError(res.status, await res.text().catch(() => '')))
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 10_000) throw new Error('Pollinations returned an empty/placeholder response instead of a video')
  const out = join(mkdtempSync(join(tmpdir(), 'ai-pollin-')), 'clip.mp4')
  writeFileSync(out, buf)
  return out
}
