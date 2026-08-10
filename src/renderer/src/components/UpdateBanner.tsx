import { useEffect, useState } from 'react'

/**
 * Mounted once in App. Shows a calm notice when a newer shipped build exists.
 *
 * ONE BUTTON, AND IT FINISHES THE JOB. The rule this follows: never hand the user a
 * step a machine can do. So the click tries three things, best first, and stops at the
 * first that works:
 *
 *  1. Restart onto code the ship pipeline already swapped in on disk. Instant.
 *  2. Download the installer and run it. No browser, no Downloads folder, no File
 *     Explorer — the app fetches ~210 MB, checks it against GitHub's own checksum,
 *     starts it and closes itself.
 *  3. Only if both of those fail: reveal the setup file / open the download page, and
 *     SAY what happened, because a click whose only effect is a window opening behind
 *     the app is indistinguishable from a broken button.
 *
 * Step 3 is kept precisely because 1 and 2 can fail — offline, out of disk, an
 * antivirus holding the file. A slow route that works beats a fast route that didn't.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<{ remoteTag: string; localTag: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)

  useEffect(() => {
    const off = window.api.updates.onAvailable(setInfo)
    const offProgress = window.api.updates.onInstallProgress(({ pct: p, stage }) => {
      setPct(p)
      setNote(stage)
    })
    // Also pull: covers a renderer that mounted after the one-shot broadcast
    // (slow first paint, page reload).
    void window.api.updates.get().then((found) => {
      if (found) setInfo((cur) => cur ?? found)
    })
    return () => {
      off()
      offProgress()
    }
  }, [])

  async function getUpdate(): Promise<void> {
    setBusy(true)
    setNote('Updating…')
    try {
      // 1. Instant path: restart onto the already-updated code (installed app).
      const restarted = await window.api.updates.restart()
      if (restarted.ok) return // the app is relaunching — nothing more to say

      // 2. Do the whole thing here: download, verify, run, quit.
      const installed = await window.api.updates.install()
      if (installed.ok) {
        setNote('The installer is opening. Say yes to it and the app will reopen updated.')
        return
      }

      // 3. Fallback, with the reason step 2 gave up, so this never looks like a shrug.
      const res = await window.api.updates.revealSetup(info?.remoteTag)
      const why = installed.error ? `${installed.error} ` : ''
      setNote(
        res.opened === 'local'
          ? `${why}Opened the studio folder with the setup file selected — the window may be behind this one (check your taskbar). Double-click the setup file to update.`
          : `${why}Opened the download page in your browser — get the setup file there, then run it once.`
      )
    } catch {
      setNote('Could not start the update — the download page is github.com/DSKJazz/NihilPointZeroStudio/releases/latest')
    } finally {
      setBusy(false)
      setPct(null)
    }
  }

  if (!info || dismissed) return null
  const downloading = busy && pct !== null && pct > 0 && pct < 100
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[65] max-w-xl rounded-md border border-sky-700 bg-sky-950/95 px-4 py-2 text-sm text-sky-100 shadow-lg">
      <div className="flex items-center gap-3">
        <span aria-hidden>⬆</span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">A newer version of the app exists</span>
          <span className="ml-1 text-xs text-sky-300/80">({info.remoteTag})</span>
          <div className="text-xs text-sky-300/80">
            {note ?? 'One click below does the whole update — nothing else to open or download.'}
          </div>
          {downloading && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-sky-900" role="progressbar" aria-valuenow={pct}>
              <div className="h-full bg-sky-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <button
          onClick={() => void getUpdate()}
          disabled={busy}
          className="shrink-0 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-[11px] font-medium px-2.5 py-1"
        >
          {downloading ? `${pct}%` : busy ? 'Working…' : 'Get the update'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-2 py-0.5 text-sky-300 hover:bg-sky-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
