import { useEffect, useState } from 'react'

/**
 * A single, app-wide confirmation modal for DESTRUCTIVE actions. Nothing the user
 * created is ever deleted without an explicit confirmation here — "only the user
 * can delete it" is enforced by routing every delete/clear/wipe click through
 * confirmDialog(), which resolves true only when the user presses the confirm
 * button. Mirrors the global toast() pattern: a module-level bus + one host
 * mounted once in App.
 */
export interface ConfirmOptions {
  title: string
  /** Body text explaining exactly what will be lost (and whether it is permanent). */
  message: string
  /** Label of the confirming button (default "Delete"). */
  confirmLabel?: string
  /** When true the confirm button is styled as a dangerous/irreversible action. */
  danger?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

let listener: ((c: PendingConfirm) => void) | null = null
let seq = 0

/**
 * Ask the user to confirm a destructive action. Resolves true only if they click
 * the confirm button; false on cancel, backdrop click, Escape, or if no host is
 * mounted (fail-safe: never delete without an explicit yes).
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false)
      return
    }
    listener({ ...opts, id: ++seq, resolve })
  })
}

/** Mount once (in App). Queues confirmations and renders them one at a time. */
export default function ConfirmHost(): React.JSX.Element | null {
  const [queue, setQueue] = useState<PendingConfirm[]>([])
  const pending = queue[0] ?? null

  useEffect(() => {
    // Enqueue rather than replace — a second confirm while one is open must not orphan the
    // first promise (which would hang whatever awaited it).
    listener = (c) => setQueue((q) => [...q, c])
    return () => {
      listener = null
    }
  }, [])

  function finish(ok: boolean): void {
    setQueue((q) => {
      const [head, ...rest] = q
      head?.resolve(ok)
      return rest
    })
  }

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(false)
      // Enter confirms ONLY non-destructive dialogs — a stray Enter must never delete.
      else if (e.key === 'Enter' && !pending.danger) finish(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
     
  }, [pending])

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => finish(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-msg"
        className="mx-4 w-full max-w-md rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-serif text-ink-100">{pending.title}</h2>
        <p id="confirm-msg" className="mt-2 text-sm text-ink-300 whitespace-pre-line">{pending.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            // For a destructive dialog, focus Cancel (the safe default), not the delete button.
            autoFocus={pending.danger}
            onClick={() => finish(false)}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800"
          >
            Cancel
          </button>
          <button
            autoFocus={!pending.danger}
            onClick={() => finish(true)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              pending.danger ? 'bg-red-700 text-white hover:bg-red-600' : 'bg-ink-100 text-ink-950 hover:bg-white'
            }`}
          >
            {pending.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
