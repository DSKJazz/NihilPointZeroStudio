/* eslint-disable no-empty */
import { useEffect, useRef } from 'react'

/**
 * The Producer context bus. Any page that has an editable document (a script, a title,
 * a storyboard brief, notes) registers it here so the global "YouTube Producer" panel
 * can (a) ground its suggestions in what you're actually writing and (b) APPLY an edit
 * back into that field — but only when you click Apply. Mirrors the toast/confirm pattern.
 */
export type ProducerKind = 'script' | 'title' | 'brief' | 'notes'

export interface ProducerTarget {
  /** Human label shown in the panel, e.g. "Script Writer". */
  label: string
  kind: ProducerKind
  /** The current text of the field. */
  text: string
  /** Applies a revised version back into the field (only called on the user's Apply). */
  apply: (next: string) => void
}

let target: ProducerTarget | null = null
let listeners: (() => void)[] = []

export function registerProducerTarget(t: ProducerTarget | null): void {
  try {
    if (t && typeof t.label === 'string') console.log('[PRODUCER] registerProducerTarget:', t.label, t.kind)
    else if (t === null) console.log('[PRODUCER] registerProducerTarget: null (cleared)')
  } catch (_) { void 0 }

  // Update the current target immediately
  target = t

  // Notify helper that calls all listeners safely
  const notify = (): void => {
    try {
      console.log('[PRODUCER] invoking listeners, count=', listeners.length)
      for (let i = 0; i < listeners.length; i++) {
        try {
          try { console.log('[PRODUCER] invoking listener', i, 'at', Date.now()) } catch (_) { void 0 }
          listeners[i]()
        } catch (err) {
          try { console.log('[PRODUCER] listener', i, 'threw', err && err.message ? err.message : String(err)) } catch (_) { void 0 }
        }
      }
    } catch (err) {
      try { console.log('[PRODUCER] failed invoking listeners', err && err.message ? err.message : String(err)) } catch (_) { void 0 }
    }
  }

  // Schedule the notify asynchronously (try RAF, fallback to microtask)
  try {
    console.log('[PRODUCER] scheduling listeners, count=', listeners.length)
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      try {
        window.requestAnimationFrame(() => notify())
        return
      } catch (e) {
        // fall through to microtask
      }
    }
  } catch (e) {
    // ignore
  }

  queueMicrotask(() => notify())
}

export function getProducerTarget(): ProducerTarget | null {
  return target
}

export function subscribeProducerTarget(cb: () => void): () => void {
  listeners.push(cb)
  return () => {
    listeners = listeners.filter((x) => x !== cb)
  }
}

/**
 * Register the current page's editable target with the Producer. Registers a STABLE proxy
 * that always reads the latest text/apply from a ref, and only re-registers when the
 * identity (label/kind) actually changes — so typing doesn't thrash the global bus or
 * re-render the Producer panel on every keystroke. Clears on unmount. Pass null to opt out.
 */
export function useProducerTarget(t: ProducerTarget | null): void {
  const ref = useRef<ProducerTarget | null>(null)

  useEffect(() => {
    ref.current = t
  }, [t])

  const label = t?.label
  const kind = t?.kind

  useEffect(() => {
    if (!ref.current) {
      registerProducerTarget(null)
      return
    }

    registerProducerTarget({
      get label() {
        return ref.current?.label ?? ''
      },
      get kind() {
        return ref.current?.kind ?? 'notes'
      },
      get text() {
        return ref.current?.text ?? ''
      },
      apply: (next: string) => ref.current?.apply(next)
    } as ProducerTarget)

    return () => registerProducerTarget(null)
     
  }, [label, kind])
}
