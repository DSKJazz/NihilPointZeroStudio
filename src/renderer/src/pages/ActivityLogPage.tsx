import { useEffect, useState } from 'react'
import { confirmDialog } from '../components/Confirm'
import type { ActivityLogEntry } from '../../../shared/types'

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.activity.list().then((list) => {
      setEntries(list)
      setLoading(false)
    })
  }, [])

  async function handleClear(): Promise<void> {
    // A real modal, not the old two-click arm/fire button: a plain double-click
    // used to wipe the entire log permanently with no dialog and no undo.
    const ok = await confirmDialog({
      title: 'Clear the whole Activity Log?',
      message: `Permanently deletes all ${entries.length} entries. There is no undo.`,
      confirmLabel: 'Clear permanently',
      danger: true
    })
    if (!ok) return
    const updated = await window.api.activity.clear()
    setEntries(updated)
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Activity Log</h1>
      <p className="text-ink-400 text-sm mt-1">
        Every action, yours and the AI's, recorded automatically. Nothing is ever deleted automatically — only you
        can clear this, and the app has no other way to remove entries.
      </p>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleClear}
          disabled={entries.length === 0}
          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {'Clear Log'}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-ink-400 text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-ink-600 text-sm">No activity recorded yet.</p>
      ) : (
        <div className="mt-4 space-y-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-sm"
            >
              <span
                className={`shrink-0 mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  entry.actor === 'ai' ? 'bg-gold-500/15 text-gold-400' : 'bg-emerald-500/15 text-emerald-400'
                }`}
              >
                {entry.actor === 'ai' ? 'AI' : 'You'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-ink-200">{entry.action}</div>
                {entry.details && <div className="text-ink-500 text-xs truncate">{entry.details}</div>}
              </div>
              <span className="shrink-0 text-ink-600 text-xs whitespace-nowrap">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
