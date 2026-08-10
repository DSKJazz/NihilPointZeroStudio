/**
 * "What changed" — the only screen that tells you what the build you are running does
 * differently from the last one.
 *
 * The gold badge in the sidebar proves WHICH build is running. This proves what is IN it.
 * Everything shown here is read from the main process, which reads the build tag of the
 * code actually executing — so this card cannot advertise a feature that is not present.
 */
import { useEffect, useState } from 'react'
import { groupByDay, type WhatsNewReport } from '../../../shared/whatsNew'

export default function WhatsNewCard(): React.JSX.Element | null {
  const [report, setReport] = useState<WhatsNewReport | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.whatsNew
      .get()
      .then((r) => {
        if (alive) setReport(r)
      })
      .catch(() => {
        // An older build without the handler must not break the Settings page.
      })
    return () => {
      alive = false
    }
  }, [])

  async function markRead(): Promise<void> {
    if (!report) return
    setBusy(true)
    try {
      setReport(await window.api.whatsNew.markSeen(report.rememberIds))
      setExpanded(false)
    } catch {
      /* leave the list on screen rather than losing it */
    } finally {
      setBusy(false)
    }
  }

  if (!report) return null

  const shown = expanded ? report.entries : report.entries.slice(0, report.showAtMost)
  const hidden = report.entries.length - shown.length

  return (
    <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-ink-100 font-medium">
          What changed
          {report.entries.length > 0 && (
            <span className="ml-2 rounded-full bg-gold-500 text-ink-950 text-[10px] font-semibold px-1.5 py-0.5">
              {report.entries.length} new
            </span>
          )}
        </div>
        {report.entries.length > 0 && (
          <button
            onClick={() => void markRead()}
            disabled={busy}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="Stops these being listed as new. Nothing is deleted."
          >
            {busy ? 'Saving…' : 'Mark all as read'}
          </button>
        )}
      </div>

      <p className="text-xs text-ink-400">{report.headline}</p>

      {shown.length > 0 && (
        <div className="mt-3 space-y-3">
          {groupByDay(shown).map((group) => (
            <div key={group.date}>
              <div className="text-[11px] text-ink-500 mb-1.5">{group.date}</div>
              <div className="space-y-2">
                {group.entries.map((e) => (
                  <div key={e.id} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                    <div className="text-xs text-ink-100 font-medium">{e.title}</div>
                    <div className="text-xs text-ink-400 mt-1 leading-relaxed">{e.detail}</div>
                    <div className="text-[11px] text-gold-500 mt-1.5">{e.where}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button onClick={() => setExpanded(true)} className="mt-3 text-xs text-gold-500 hover:text-gold-400 transition-colors">
          Show the other {hidden} →
        </button>
      )}

      {/* The running build, spelled out, so this card and the sidebar badge can be
          checked against each other. */}
      <div className="mt-3 text-[11px] text-ink-600">Running: {report.buildTag}</div>
    </div>
  )
}
