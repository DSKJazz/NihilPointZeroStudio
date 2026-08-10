/**
 * Settings → Caretaker: the scheduled self-diagnostic, made visible and his to command.
 *
 * Everything he asked for lives on this one card: is it working, what has it done up to
 * today, what its schedule is, the recommended schedule AND the reason for it (stated,
 * not implied), the power to change the schedule or pause it, and the power to delete
 * the record. What it fixes by itself is settings, state and stuck services — the card
 * never claims more than that.
 */
import { useEffect, useState } from 'react'
import type { CaretakerStatus } from '../../../shared/caretaker'
import { confirmDialog } from './Confirm'
import { toast } from './Toast'

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function CaretakerCard(): React.JSX.Element {
  const [status, setStatus] = useState<CaretakerStatus | null>(null)
  const [hours, setHours] = useState(6)
  const [running, setRunning] = useState(false)
  const [showAll, setShowAll] = useState(false)

  async function refresh(): Promise<void> {
    try {
      const s = await window.api.caretaker.status()
      setStatus(s)
      setHours(s.intervalHours)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function runNow(): Promise<void> {
    setRunning(true)
    try {
      const run = await window.api.caretaker.runNow()
      toast(
        run.outcome === 'busy'
          ? 'A render is in progress — the Caretaker stood down rather than risk it.'
          : run.problems.length || run.fixed.length
            ? `Caretaker: ${run.problems.length} problem(s), ${run.fixed.length} fixed.`
            : 'Caretaker: everything healthy.',
        run.problems.length ? 'error' : 'success'
      )
      await refresh()
    } finally {
      setRunning(false)
    }
  }

  async function saveSchedule(paused: boolean): Promise<void> {
    setStatus(await window.api.caretaker.setSchedule(hours, paused))
    toast(paused ? 'Caretaker paused — nothing will run until you resume it.' : `Caretaker will check every ${hours} hour(s).`, 'info')
  }

  async function clearLog(): Promise<void> {
    const yes = await confirmDialog({
      title: "Delete the Caretaker's record?",
      message: 'The list of past check-ups is removed. The Caretaker itself keeps running on its schedule.',
      confirmLabel: 'Delete the record',
      danger: true
    })
    if (!yes) return
    setStatus(await window.api.caretaker.clearLog())
  }

  if (!status) return <></>

  const latest = status.runs[0]
  const shown = showAll ? status.runs.slice(0, 20) : status.runs.slice(0, 3)

  return (
    <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink-100 font-medium">🩺 Caretaker — the studio checks itself</div>
          <p className="text-xs text-ink-500 mt-0.5">
            Runs the live health checks, moves the AI brain off a dead service, and looks for finished videos the
            app lost track of. It fixes settings and services; it never touches your work, and it never runs during a
            render.
          </p>
        </div>
        <span className={`shrink-0 text-xs ${status.paused ? 'text-amber-400' : 'text-emerald-400'}`}>
          {status.paused ? 'Paused' : 'Running'}
        </span>
      </div>

      <div className="rounded-md border border-ink-800 bg-ink-950 p-3 text-[11px] text-ink-400 space-y-1">
        <div>
          <span className="text-ink-500">Last check-up: </span>
          {latest ? `${when(latest.at)} — ${latest.outcome === 'busy' ? 'stood down (render in progress)' : latest.problems.length ? `${latest.problems.length} problem(s) found` : 'everything healthy'}${latest.fixed.length ? `, ${latest.fixed.length} fixed` : ''}` : 'not yet — the first one runs shortly after the app starts'}
        </div>
        <div>
          <span className="text-ink-500">Next scheduled: </span>
          {status.paused ? 'paused' : when(status.nextRunAt)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-ink-400">
          Check every
          <input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 6)))}
            className="w-14 rounded bg-ink-800 border border-ink-700 px-2 py-1 text-ink-100"
          />
          hour(s)
        </label>
        <button onClick={() => void saveSchedule(false)} className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium px-3 py-1.5 transition-colors">
          Save schedule
        </button>
        <button
          onClick={() => void saveSchedule(!status.paused)}
          className="rounded-md border border-ink-700 hover:border-ink-600 text-ink-300 px-3 py-1.5 transition-colors"
        >
          {status.paused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={() => void runNow()} disabled={running} className="rounded-md border border-ink-700 hover:border-ink-600 disabled:opacity-50 text-ink-300 px-3 py-1.5 transition-colors">
          {running ? 'Checking…' : 'Run a check-up now'}
        </button>
      </div>

      <p className="text-[11px] text-ink-600">
        Recommended: every {status.recommendedHours} hours. Why — {status.recommendedWhy}
      </p>

      {status.runs.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-300 font-medium">What it has done</span>
            <div className="flex gap-2">
              {status.runs.length > 3 && (
                <button onClick={() => setShowAll((v) => !v)} className="text-[11px] text-ink-500 hover:text-ink-300">
                  {showAll ? 'Show less' : `Show more (${status.runs.length})`}
                </button>
              )}
              <button onClick={() => void clearLog()} className="text-[11px] text-ink-500 hover:text-red-300">
                Delete the record
              </button>
            </div>
          </div>
          {shown.map((r) => (
            <div key={r.at} className="rounded-md border border-ink-800 bg-ink-950 p-2 text-[11px]">
              <div className="text-ink-400">
                {when(r.at)} · {r.trigger === 'manual' ? 'you ran it' : r.trigger === 'start' ? 'app start' : 'scheduled'} ·{' '}
                {r.outcome === 'busy' ? (
                  <span className="text-amber-300">stood down — render in progress</span>
                ) : r.problems.length ? (
                  <span className="text-red-300">{r.problems.join(', ')} failing</span>
                ) : (
                  <span className="text-emerald-400">all healthy</span>
                )}
              </div>
              {r.fixed.map((f) => (
                <div key={f} className="text-emerald-300 mt-0.5">✓ {f}</div>
              ))}
              {r.notes.map((n) => (
                <div key={n} className="text-ink-500 mt-0.5">ℹ {n}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
