import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityLogEntry, VideoJob } from '../../../shared/types'

/** Where a new session usually starts — one click each. */
const QUICK: { to: string; label: string; hint: string }[] = [
  { to: '/agent', label: '✦ Just tell the AI', hint: 'Say what you want made; approve the plan' },
  { to: '/writer', label: '✍ Write a script', hint: 'Full script, optionally on real PSX data' },
  { to: '/scenes', label: '🎬 Scene Studio', hint: 'Script → per-scene images → video' },
  { to: '/video', label: '🎥 Video Studio', hint: 'Build, voice, music, captions, Shorts' },
  { to: '/recorder', label: '⏺ Record yourself', hint: 'Webcam or screen, straight into the studio' },
  { to: '/ideas', label: '💡 Ideas & Trends', hint: 'Find the next topic worth covering' }
]

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/**
 * "Today" — the landing screen. Answers the three questions you actually have when
 * you open the studio: what did I just make, what was happening last, and what do I
 * do next. Read-only: every action here is a link, so this page can never change or
 * delete anything.
 */
export default function TodayPage(): React.JSX.Element {
  const [videos, setVideos] = useState<VideoJob[]>([])
  const [log, setLog] = useState<ActivityLogEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([window.api.video.list(), window.api.activity.list()])
      .then(([v, a]) => {
        if (!alive) return
        // Sort explicitly newest-first rather than assuming the source order — a
        // slice() that guesses wrong silently shows the OLDEST items instead.
        setVideos(
          [...v].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt)).slice(0, 6)
        )
        setLog([...a].sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp)).slice(0, 8))
      })
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Today</h1>
      <p className="text-ink-400 text-sm mt-1">
        Your studio at a glance. Pick up where you left off, or start something new.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {QUICK.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="rounded-lg border border-ink-700 bg-ink-900 hover:border-gold-500/60 hover:bg-ink-800 p-3 transition-colors"
          >
            <div className="text-sm text-ink-100">{q.label}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">{q.hint}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-100 font-medium">Your latest videos</div>
            <Link to="/video" className="text-[11px] text-gold-300 hover:text-gold-200">
              Open Video Studio →
            </Link>
          </div>
          {!loaded ? (
            <p className="text-xs text-ink-600 mt-2">Loading…</p>
          ) : videos.length === 0 ? (
            <p className="text-xs text-ink-500 mt-2">
              Nothing built yet. Start with <Link to="/agent" className="text-gold-300 underline">✦ AI Command</Link> —
              tell it what you want and approve the plan.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {videos.map((v) => (
                <li key={v.id} className="flex items-baseline gap-2 text-xs">
                  <span className="text-ink-200 truncate">{v.title}</span>
                  <span className="ml-auto shrink-0 text-ink-600">{ago(v.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-100 font-medium">What happened recently</div>
            <Link to="/activity" className="text-[11px] text-gold-300 hover:text-gold-200">
              Full Activity Log →
            </Link>
          </div>
          {!loaded ? (
            <p className="text-xs text-ink-600 mt-2">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-xs text-ink-500 mt-2">No activity yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {log.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 text-xs">
                  <span className={e.actor === 'ai' ? 'text-sky-400' : 'text-gold-400'}>
                    {e.actor === 'ai' ? 'AI' : 'You'}
                  </span>
                  <span className="text-ink-300 truncate">{e.action}</span>
                  <span className="ml-auto shrink-0 text-ink-600">{ago(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-6 text-[11px] text-ink-600">
        Tip: the 🧭 Expert (bottom-left) knows every tab and can run steps for you; the 🎬 Producer (bottom-right)
        sharpens hooks, titles and retention.
      </p>
    </div>
  )
}
