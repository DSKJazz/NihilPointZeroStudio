/**
 * The render queue, on screen.
 *
 * Line up an evening's work and walk away. It is written to disk after every change, so
 * closing the app — or a power cut — does not lose what has not been built yet, and one
 * failure costs exactly one item instead of the rest of the night.
 */
import { useEffect, useState } from 'react'
import type { QueueItem } from '../../../shared/types'
import { summarise } from '../../../shared/renderQueue'

const STATE_LABEL: Record<QueueItem['state'], string> = {
  waiting: 'waiting',
  rendering: 'rendering now',
  done: 'built',
  failed: 'failed',
  cancelled: 'cancelled'
}

const STATE_COLOUR: Record<QueueItem['state'], string> = {
  waiting: 'text-ink-400',
  rendering: 'text-gold-400',
  done: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-ink-600'
}

export default function RenderQueuePanel(): React.JSX.Element | null {
  const [items, setItems] = useState<QueueItem[] | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.queue
      .list()
      .then((q) => {
        if (alive) setItems(q)
      })
      .catch(() => {
        /* an older build without the handler must not break the page */
      })
    // No polling: the main process pushes every change, including each render finishing.
    const off = window.api.queue.onChanged((q) => setItems(q))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Nothing queued and nothing ever queued — no need for an empty box on the page.
  if (!items || !items.length) return null

  const summary = summarise(items)

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-ink-100 font-medium">Render queue</div>
        {(summary.done || summary.failed || summary.cancelled) > 0 && (
          <button
            onClick={() => void window.api.queue.clearFinished().then(setItems)}
            className="rounded-md border border-ink-700 text-ink-300 hover:bg-ink-800 text-[11px] px-2 py-1 transition-colors"
            title="Removes only the finished, failed and cancelled ones. Never touches anything still waiting."
          >
            Clear the finished ones
          </button>
        )}
      </div>

      <p className="text-xs text-ink-400">{summary.headline}</p>

      <div className="mt-3 space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-200 flex-1 truncate">{item.title}</span>
              <span className={`text-[11px] shrink-0 ${STATE_COLOUR[item.state]}`}>{STATE_LABEL[item.state]}</span>
            </div>

            {item.error && <div className="text-[11px] text-red-300 mt-1">{item.error}</div>}

            <div className="flex items-center gap-1.5 mt-1.5">
              {item.state === 'waiting' && (
                <>
                  <button
                    onClick={() => void window.api.queue.reorder(item.id, -1).then(setItems)}
                    className="rounded border border-ink-700 text-ink-400 hover:text-ink-200 text-[11px] px-1.5 transition-colors"
                    title="Move it up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => void window.api.queue.reorder(item.id, 1).then(setItems)}
                    className="rounded border border-ink-700 text-ink-400 hover:text-ink-200 text-[11px] px-1.5 transition-colors"
                    title="Move it down"
                  >
                    ↓
                  </button>
                </>
              )}
              {(item.state === 'waiting' || item.state === 'rendering') && (
                <button
                  onClick={() => void window.api.queue.cancel(item.id).then(setItems)}
                  className="rounded border border-ink-700 text-ink-400 hover:text-red-300 text-[11px] px-2 transition-colors"
                >
                  {item.state === 'rendering' ? 'Stop this one' : 'Cancel'}
                </button>
              )}
              {(item.state === 'failed' || item.state === 'cancelled') && (
                <button
                  onClick={() => void window.api.queue.retry(item.id).then(setItems)}
                  className="rounded border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 text-[11px] px-2 transition-colors"
                >
                  Try it again
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[10px] text-ink-600">
        One at a time — two renders at once is slower than one after the other, not faster. The list is written down, so
        closing the app does not lose it, and anything interrupted goes back in the queue next time you open the studio.
      </div>
    </div>
  )
}
