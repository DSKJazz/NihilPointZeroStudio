import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { logActivity } from './store'

// Injected at build time by electron.vite.config.ts (same tag the sidebar badge shows).
declare const __BUILD_TAG__: string

const RELEASE_API = 'https://api.github.com/repos/DSKJazz/NihilPointZeroStudio/releases/latest'

// Remembered so a renderer that mounts AFTER the one-shot broadcast (slow first
// launch, Ctrl+R reload) can still pull the result via the update:get handler.
let available: { remoteTag: string; localTag: string } | null = null

/** The update found by the startup check, if any — for renderer pulls. */
export function getAvailableUpdate(): { remoteTag: string; localTag: string } | null {
  return available
}

/** Parses the "yyyy-MM-dd HH:mm" timestamp out of a build tag; null if absent. */
export function tagDate(tag: string): number | null {
  const m = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)/.exec(tag)
  if (!m) return null
  const t = Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}`)
  return Number.isNaN(t) ? null : t
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function buildTagFromRelease(release: {
  body?: string
  tag_name?: string
  published_at?: string | null
  created_at?: string | null
}): string | null {
  const buildLine = /Build (v[^\n*]+)/.exec(release.body ?? '')?.[1]?.trim()
  if (buildLine) return buildLine

  const dateString = release.published_at ?? release.created_at
  if (!release.tag_name || !dateString) return null
  const publishedAt = Date.parse(dateString)
  if (Number.isNaN(publishedAt)) return null

  const when = new Date(publishedAt)
  const localStamp = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`
  return `${release.tag_name.trim()} · ${localStamp} · published`
}

/** True when the remote tag is meaningfully newer than the local one (>2 min — the
 * self-stamp and the ship stamp of the SAME build can differ by a few seconds). */
export function isNewer(localTag: string, remoteTag: string): boolean {
  const localAt = tagDate(localTag)
  const remoteAt = tagDate(remoteTag)
  if (localAt === null || remoteAt === null) return false
  return remoteAt - localAt > 2 * 60_000
}

/**
 * True when the app's code archive ON DISK is meaningfully newer than the code
 * actually RUNNING — i.e. the ship pipeline already swapped app.asar in place and a
 * simple restart loads the update. (>2 min slack for same-build stamp jitter.)
 * Pure + tested; the caller supplies the asar's mtime.
 */
export function diskIsNewerThanRunning(asarMtimeMs: number, runningTag: string): boolean {
  const runningAt = tagDate(runningTag)
  if (runningAt === null || !Number.isFinite(asarMtimeMs)) return false
  return asarMtimeMs - runningAt > 2 * 60_000
}

/**
 * Quiet startup check: is there a newer shipped build than the one running?
 * Reads the "Build v0.1.1 · yyyy-MM-dd HH:mm · hash" line that ship.ps1 writes
 * into the GitHub release notes and compares dates. MUST fail silently — being
 * offline or rate-limited can never be allowed to bother the user.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nihilpointzero-os' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return
    const rel = (await res.json()) as { body?: string; tag_name?: string; published_at?: string | null }
    const remote = buildTagFromRelease(rel)
    if (!remote) {
      try {
        logActivity(
          'ai',
          'Could not read the version on the download page — the update check found no readable build stamp'
        )
      } catch {
        // The check must stay silent-failing overall; logging cannot be allowed to throw.
      }
      return
    }
    if (!isNewer(__BUILD_TAG__, remote)) return
    available = { remoteTag: remote, localTag: __BUILD_TAG__ }
    logActivity(
      'ai',
      `A newer app version exists (${remote}) — run NIHILPOINTZERO-OS-setup.exe from the Desktop studio folder to update`
    )
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC.updateAvailable, { remoteTag: remote, localTag: __BUILD_TAG__ })
      }
    }
  } catch {
    // silent by design
  }
}
