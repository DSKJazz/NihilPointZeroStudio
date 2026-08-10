/**
 * Everything the phone app remembers, kept in this phone's own browser storage.
 *
 * IMPORTANT: this store has no connection whatsoever to the desktop app's
 * `nihilpointzero-data` folder. The phone cannot read, write, or delete the
 * user's real work — it only keeps its own copies on the handset. Deletion here
 * is always user-initiated and confirmed, matching the desktop app's rule.
 */

export type PhoneProvider = 'free' | 'anthropic' | 'openai'

export interface SavedItem {
  id: string
  kind: 'idea' | 'script' | 'advice' | 'thumbnail'
  title: string
  body: string
  createdAt: string
}

const KEY_PROVIDER = 'npz.provider'
const KEY_APIKEY = 'npz.apikey'
const KEY_SAVED = 'npz.saved'
const KEY_PCLINK = 'npz.pclink'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key' | 'length'>

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key) ?? null : null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function isStorageLike(value: unknown): value is StorageLike {
  return !!value && typeof value === 'object' && typeof (value as StorageLike).getItem === 'function' && typeof (value as StorageLike).setItem === 'function'
}

function getStorage(): StorageLike {
  const existing = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage
  if (isStorageLike(existing)) {
    return existing
  }

  const fallback = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: fallback,
    writable: true
  })
  return fallback
}

const storage = getStorage()

/** Storage can throw in private-browsing modes; never let that crash the app. */
function read(key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch {
    // Out of quota or storage blocked — the app still works for this session.
  }
}

export function getProvider(): PhoneProvider {
  const v = read(KEY_PROVIDER)
  return v === 'anthropic' || v === 'openai' ? v : 'free'
}

export function setProvider(p: PhoneProvider): void {
  write(KEY_PROVIDER, p)
}

export function getKey(): string {
  return read(KEY_APIKEY) ?? ''
}

export function setKey(k: string): void {
  write(KEY_APIKEY, k.trim())
}

/**
 * The tokenized link the studio shows in Settings → "Phone access (same Wi-Fi)".
 * Kept on the phone only, exactly like an API key, and only ever sent to that PC.
 */
export function getPcLink(): string {
  return read(KEY_PCLINK) ?? ''
}

export function setPcLink(v: string): void {
  write(KEY_PCLINK, v.trim())
}

export function listSaved(): SavedItem[] {
  try {
    const parsed = JSON.parse(read(KEY_SAVED) ?? '[]')
    return Array.isArray(parsed) ? (parsed as SavedItem[]) : []
  } catch {
    return []
  }
}

/** Newest first, so the thing you just made is the thing you see. */
export function save(kind: SavedItem['kind'], title: string, body: string): SavedItem {
  const item: SavedItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title,
    body,
    createdAt: new Date().toISOString()
  }
  const all = [item, ...listSaved()]
  // Keep the phone's storage from filling up silently. 200 items is far more
  // than a phone session produces, and the PC remains the real archive.
  write(KEY_SAVED, JSON.stringify(all.slice(0, 200)))
  return item
}

export function remove(id: string): void {
  write(KEY_SAVED, JSON.stringify(listSaved().filter((i) => i.id !== id)))
}
