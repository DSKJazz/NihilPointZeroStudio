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
    if (t) console.log('[PRODUCER] target=', t.label, t.kind)
    else console.log('[PRODUCER] target cleared')
  } catch (e) { /* ignore */ }

  target = t

  const notify = (): void => {
    listeners.forEach((listener, index) => {
      try {
        listener()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        try { console.log('[PRODUCER] listener', index, 'failed:', msg) } catch (e) { /* ignore */ }
      }
    })
  }

  try {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(notify)
      return
    }
  } catch (e) { /* ignore */ }
  queueMicrotask(notify)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, kind])
}
