import { useEffect, useState } from 'react'

type Status = {
  state: 'current' | 'behind' | 'ahead' | 'unknown'
  runningTag: string
  publishedTag: string | null
  message: string
  checkedAt: string
}

/**
 * "Am I up to date?" — visible, on demand, with the evidence.
 *
 * WHY THIS EXISTS. The update banner only ever appeared when the app was BEHIND. When it
 * was current the app said nothing — and nothing is precisely what a broken check looks
 * like. Somebody who had just updated had no way to tell success from failure, and the
 * reasonable conclusion was "this is broken". That was not a documentation problem; the
 * app was missing a sentence. This is the sentence.
 *
 * It shows BOTH build stamps, not just a verdict, because a verdict on its own is another
 * thing to be taken on trust — and trust is exactly what runs out when an update is
 * invisible.
 */
export default function VersionCard(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  // Starts true because the mount effect checks immediately — which is also the honest
  // label for that moment, and it keeps the effect from setting state synchronously.
  const [busy, setBusy] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  async function check(markBusy = true): Promise<void> {
    if (markBusy) setBusy(true)
    try {
      setStatus(await window.api.updates.status())
    } catch {
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void check(false)
  }, [])

  async function getUpdate(): Promise<void> {
    setUpdating('Working…')
    const off = window.api.updates.onInstallProgress(({ pct, stage }) =>
      setUpdating(pct > 0 && pct < 100 ? `${stage} ${pct}%` : stage)
    )
    try {
      const restarted = await window.api.updates.restart()
      if (restarted.ok) return
      const installed = await window.api.updates.install()
      setUpdating(
        installed.ok
          ? 'The installer is opening. Say yes to it and the app will reopen updated.'
          : (installed.error ?? 'Could not update.')
      )
      if (!installed.ok) await check()
    } finally {
      off()
    }
  }

  const tone =
    status?.state === 'current'
      ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
      : status?.state === 'behind'
        ? 'border-sky-800 bg-sky-950/50 text-sky-100'
        : 'border-ink-700 bg-ink-900 text-ink-200'
  const icon = status?.state === 'current' ? '✓' : status?.state === 'behind' ? '⬆' : 'ⓘ'

  return (
    <div className={`mt-4 rounded-lg border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            <span aria-hidden className="mr-1.5">
              {icon}
            </span>
            Version
          </div>
          <div className="text-xs mt-1">{busy ? 'Checking the download page…' : (status?.message ?? 'Not checked yet.')}</div>
          {updating && <div className="text-xs mt-1 opacity-90">{updating}</div>}
          {status && (
            // Both stamps, always. A bare verdict is one more thing to take on trust,
            // and trust is what runs out when an update is invisible.
            <div className="mt-2 space-y-0.5 text-[11px] opacity-70">
              <div>This app: {status.runningTag}</div>
              <div>Newest published: {status.publishedTag ?? 'could not be read'}</div>
              <div>Checked: {new Date(status.checkedAt).toLocaleTimeString()}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            onClick={() => void check()}
            disabled={busy}
            className="rounded bg-ink-700 hover:bg-ink-600 disabled:opacity-60 text-ink-100 text-[11px] font-medium px-2.5 py-1"
          >
            {busy ? 'Checking…' : 'Check now'}
          </button>
          {status?.state === 'behind' && (
            <button
              onClick={() => void getUpdate()}
              disabled={!!updating}
              className="rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[11px] font-medium px-2.5 py-1"
            >
              Get the update
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
