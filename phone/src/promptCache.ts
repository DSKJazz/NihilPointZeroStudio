/**
 * The prompt pack, cached on this handset.
 *
 * The wording is never bundled into this app — the app is served from a public
 * address, so anything in it is readable by anyone. Instead the phone downloads the
 * pack once from the user's own PC over the private link, and keeps it here. After
 * that the phone can write in the channel's voice with the PC switched off, and the
 * wording has still only ever existed on the user's own two devices.
 *
 * Stored in IndexedDB rather than localStorage: it is tens of kilobytes of text, and
 * IndexedDB is where the rest of the phone's real data already lives.
 */
import type { PromptPack } from '../../src/shared/promptAssembly'
import { dbDelete, dbGet, dbSet } from './db'
import { getPcLink } from './store'

const KEY = 'prompt-pack'

interface CachedPack {
  pack: PromptPack
  fetchedAt: string
}

let cached: PromptPack | null = null
let loaded = false

/** Reads the cache once at start-up. Never throws. */
export async function loadPromptPack(): Promise<void> {
  if (loaded) return
  loaded = true
  const saved = await dbGet<CachedPack>(KEY)
  // A pack from a newer studio may have a shape this app doesn't understand; ignoring
  // it just means falling back to asking the PC, which is always correct.
  if (saved?.pack && typeof saved.pack === 'object' && saved.pack.version === 1) cached = saved.pack
}

export function getPromptPack(): PromptPack | null {
  return cached
}

export function hasPromptPack(): boolean {
  return !!cached
}

/**
 * Downloads the pack from the PC and stores it. Called explicitly from Settings, so
 * the user knows their prompts were copied to the phone rather than it happening
 * silently behind their back.
 */
export async function syncPromptPack(): Promise<{ ok: boolean; message: string }> {
  const raw = getPcLink().trim()
  if (!raw) {
    return { ok: false, message: 'Connect your PC first — paste or scan its link above.' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: 'That PC link does not look like a web address.' }
  }
  const token = url.searchParams.get('t')
  if (!token) return { ok: false, message: 'That PC link is missing its key.' }

  try {
    const res = await fetch(`${url.origin}/api/prompt-pack`, {
      headers: { 'X-Token': token },
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 401) return { ok: false, message: 'Your PC refused the key. Copy the link again.' }
    if (!res.ok) return { ok: false, message: `Your PC answered ${res.status}.` }
    const pack = (await res.json()) as PromptPack
    if (!pack || typeof pack !== 'object' || !pack.niche || !pack.templates) {
      return { ok: false, message: 'Your PC sent something unreadable. Update the studio on the PC and try again.' }
    }
    if (pack.version !== 1) {
      return {
        ok: false,
        message: `Your PC sent a pack this app is too old to read (version ${pack.version}). Reinstall the phone app.`
      }
    }
    cached = pack
    await dbSet(KEY, { pack, fetchedAt: new Date().toISOString() } satisfies CachedPack)
    return { ok: true, message: 'Copied to this phone. You can now write with your PC switched off.' }
  } catch {
    return { ok: false, message: 'Could not reach your PC. Check the studio is open and phone access is on.' }
  }
}

/** Wipes the copy from this handset — offered so the user can undo the decision. */
export async function forgetPromptPack(): Promise<void> {
  cached = null
  await dbDelete(KEY)
}
