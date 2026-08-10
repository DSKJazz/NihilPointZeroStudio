/**
 * A tiny promise-based key/value store on IndexedDB.
 *
 * The Saved list and settings live happily in localStorage, but a video plan can
 * carry attached photos, clips and voice recordings — megabytes of base64 that would
 * blow straight past localStorage's ~5 MB ceiling and throw. Losing a scene photo or
 * a narration take because the user closed the app would be unforgivable, so the plan
 * goes here instead, where the quota is hundreds of megabytes.
 *
 * Everything degrades rather than throws: if IndexedDB is unavailable (private mode,
 * an old browser), the app keeps working for the session and simply cannot persist.
 */

const DB_NAME = 'npz-phone'
const STORE = 'kv'
const VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      // Some browsers hang the open forever behind a blocked upgrade rather than
      // erroring; don't let that wedge app start-up.
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          req.onsuccess = () => resolve(req.result as T)
          req.onerror = () => resolve(null)
          tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
  )
}

export function dbGet<T>(key: string): Promise<T | null> {
  return run<T>('readonly', (s) => s.get(key))
}

export function dbSet(key: string, value: unknown): Promise<unknown> {
  return run('readwrite', (s) => s.put(value, key))
}

export function dbDelete(key: string): Promise<unknown> {
  return run('readwrite', (s) => s.delete(key))
}

/** Best-effort read of how much room the browser will still give us. */
export async function storageEstimate(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est) return null
    return { usedBytes: est.usage ?? 0, quotaBytes: est.quota ?? 0 }
  } catch {
    return null
  }
}
