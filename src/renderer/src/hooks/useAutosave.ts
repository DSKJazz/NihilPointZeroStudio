import { useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Universal autosave: restores a tab's saved state once on mount, then debounce-saves
 * it whenever it changes — so work is never lost on close/restart. Returns a status
 * for a "Saving…/Saved ✓" indicator. History (previous versions) is kept in the main
 * process; use loadHistory() to fetch it for a restore UI.
 */
export function useAutosave<T>(
  key: string,
  state: T,
  onRestore: (value: T) => void,
  options?: { skipRestore?: boolean }
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const loaded = useRef(false)
  const restoreRef = useRef(onRestore)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(state)
  const dirty = useRef(false)
  restoreRef.current = onRestore
  latest.current = state
  const skipRestore = options?.skipRestore ?? false

  // Restore once — unless the caller is seeding fresh state (e.g. an imported document)
  // and must NOT be overwritten by the previously-saved draft.
  useEffect(() => {
    if (skipRestore) {
      loaded.current = true
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const d = await window.api.drafts.get(key)
        if (!cancelled && d && d.current != null) restoreRef.current(d.current as T)
      } finally {
        if (!cancelled) loaded.current = true
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Save (debounced) after the initial restore.
  useEffect(() => {
    if (!loaded.current) return
    setStatus('saving')
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      window.api.drafts
        .set(key, latest.current)
        .then(() => {
          dirty.current = false
          setStatus('saved')
        })
        // A failed write used to pin the indicator on "Saving…" forever — the
        // user believed their work was safe when nothing had reached disk.
        .catch(() => setStatus('error'))
    }, 600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state])

  // Flush any pending save on unmount (tab switch) and on app close, so the last <600ms
  // of edits are never lost — the docstring's promise the debounce alone can't keep.
  useEffect(() => {
    const flush = (): void => {
      if (loaded.current && dirty.current) void window.api.drafts.set(key, latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return status
}

/** Fetches the saved version history (newest first) for a key, for a restore dropdown. */
export async function loadHistory(key: string): Promise<{ at: string; value: unknown }[]> {
  const d = await window.api.drafts.get(key)
  return d?.history ?? []
}
