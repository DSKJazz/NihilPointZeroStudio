/**
 * The app updates ITSELF. No browser, no Downloads folder, no File Explorer.
 *
 * WHY THIS EXISTS
 * There was already an update notice with a button, but the button's best case was
 * "opened the download page in your browser" — after which the user still had to find
 * the file, get past the browser's warning about .exe downloads, find it again in
 * Downloads, and double-click it. For somebody who does not code that is not one step,
 * it is five, and each one is a place to get stuck. The person using this app should
 * never be asked to do a job a machine can do. So: this module fetches the installer,
 * checks it really is the file GitHub says it is, runs it, and gets out of the way.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not replace the older paths. `update:restart` (instant, when the ship
 * pipeline already swapped the code on disk) is still tried first because it is faster,
 * and `update:reveal-setup` is still the fallback when a download cannot be made to
 * work. Nothing was removed — a slow route that works beats a fast route that failed.
 *
 * WHY THE SETUP EXE EVEN FOR PORTABLE USERS
 * A running .exe is locked by Windows, so a portable build cannot overwrite itself.
 * The installer can, and it is the Smart App Control-safe path the rest of the
 * pipeline is already built around. A portable user who takes this ends up with a
 * properly installed app, which is a gain, not a loss — and the UI says so first.
 *
 * The parsing and verification below are pure and tested; only `downloadInstaller`
 * and `runInstallerAndQuit` touch the disk or spawn anything.
 */
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

const RELEASE_API = 'https://api.github.com/repos/DSKJazz/NihilPointZeroStudio/releases/latest'

/** The installer's name on the release. Kept in one place — ship.ps1 uploads this name. */
export const INSTALLER_ASSET = 'NIHILPOINTZERO-OS-setup.exe'

/** Below this, don't even start: the installer is ~210 MB and a half-written one is worse
 * than none. Room for the download plus the space the installer itself needs to unpack. */
export const NEEDED_FREE_MB = 1200

export type ReleaseAsset = {
  name?: string
  size?: number
  state?: string
  digest?: string | null
  browser_download_url?: string
}

/**
 * The installer asset from a release, or null with the reason.
 *
 * Rejects an asset still uploading (`state !== 'uploaded'`) — GitHub lists those, and
 * downloading one yields a truncated file that installs nothing and looks like a bug in
 * this app rather than a race with the build.
 */
export function pickInstaller(assets: unknown): { asset: ReleaseAsset } | { error: string } {
  if (!Array.isArray(assets)) return { error: 'The download page did not list any files.' }
  const found = assets.find(
    (a): a is ReleaseAsset =>
      !!a && typeof a === 'object' && (a as ReleaseAsset).name?.toLowerCase() === INSTALLER_ASSET.toLowerCase()
  )
  if (!found) return { error: 'The newest version has no installer file yet — try again in a few minutes.' }
  if (found.state && found.state !== 'uploaded') {
    return { error: 'The newest version is still being uploaded — try again in a few minutes.' }
  }
  if (typeof found.browser_download_url !== 'string' || !found.browser_download_url.startsWith('https://')) {
    return { error: 'The download link for the newest version looks wrong, so it was not used.' }
  }
  if (!found.size || found.size < 1_000_000) {
    return { error: 'The installer on the download page looks incomplete, so it was not used.' }
  }
  return { asset: found }
}

/** The sha256 hex out of GitHub's `"sha256:<hex>"` digest field; null when absent or
 * not a sha256 (a future algorithm must not be silently treated as a pass). */
export function expectedSha256(digest: unknown): string | null {
  if (typeof digest !== 'string') return null
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return m ? m[1].toLowerCase() : null
}

/**
 * Is the file on disk the file GitHub described?
 *
 * Size is always checked. The hash is checked only when GitHub supplied one — and when
 * it did, a mismatch is fatal. An installer is the one download where "close enough"
 * is not acceptable: a corrupted one can leave the app unrunnable.
 */
export function verifyDownload(
  actual: { size: number; sha256: string | null },
  expected: { size: number; sha256: string | null }
): { ok: true } | { ok: false; error: string } {
  if (actual.size !== expected.size) {
    return { ok: false, error: 'The download did not finish properly (wrong size), so it was not run.' }
  }
  if (expected.sha256 && actual.sha256 !== expected.sha256) {
    return { ok: false, error: 'The downloaded file did not match its checksum, so it was not run.' }
  }
  return { ok: true }
}

/** 0..1 -> the whole-percent the UI shows. Clamped, because a content-length that
 * under-reports would otherwise show "137%". */
export function percent(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

/** The folder the installer is downloaded into. Its own subfolder so cleaning it can
 * never reach anything else. */
export function updateDir(tempRoot: string): string {
  return join(tempRoot, 'nihilpointzero-update')
}

/** Reads the latest release. Separated so the handler stays readable and so a network
 * failure has one obvious place to be turned into plain English. */
export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<
  { ok: true; assets: unknown; body: string; tag_name?: string; published_at?: string | null } | { ok: false; error: string }
> {
  try {
    const res = await fetchImpl(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nihilpointzero-os' },
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) return { ok: false, error: `Could not reach the download page (${res.status}).` }
    const rel = (await res.json()) as { assets?: unknown; body?: string; tag_name?: string; published_at?: string | null }
    return { ok: true, assets: rel.assets, body: rel.body ?? '', tag_name: rel.tag_name, published_at: rel.published_at }
  } catch {
    return { ok: false, error: 'Could not reach the internet to fetch the update.' }
  }
}

/**
 * Streams the installer to `dest`, hashing as it goes so the whole file is never held in
 * memory and no second read pass is needed.
 *
 * The 60-minute cap is deliberately generous — this is a ~210 MB download on whatever
 * connection the user has — but a stalled socket still cannot hang the button forever.
 */
export async function downloadInstaller(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
  fetchImpl: typeof fetch = fetch
): Promise<{ size: number; sha256: string }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length') || 0)
  const hash = createHash('sha256')
  const ws = createWriteStream(dest)
  const reader = res.body.getReader()
  let done = 0
  let lastPct = -1
  try {
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      if (!value) continue
      const buf = Buffer.from(value)
      hash.update(buf)
      // Backpressure: without awaiting a full write buffer, a fast connection outruns a
      // slow disk and the whole 210 MB piles up in memory.
      if (!ws.write(buf)) await new Promise<void>((r) => ws.once('drain', () => r()))
      done += buf.length
      const pct = percent(done, total)
      // Only on change: 210 MB is ~3400 chunks, and an IPC message per chunk would make
      // the progress bar the most expensive part of the update.
      if (pct !== lastPct) {
        lastPct = pct
        onProgress(pct)
      }
    }
  } finally {
    await new Promise<void>((resolve) => ws.end(() => resolve()))
  }
  return { size: done, sha256: hash.digest('hex') }
}

/** Empties (and recreates) the download folder. Its own subfolder, so this cannot
 * reach the user's work — which the app must never delete. */
export function freshUpdateDir(tempRoot: string): string {
  const dir = updateDir(tempRoot)
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    // A leftover file held open by an antivirus scanner must not stop the update; the
    // download below overwrites by name anyway.
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

/** True when a previously downloaded installer is already the right file, so a retry
 * after a failed launch does not re-download 210 MB. */
export function alreadyDownloaded(path: string, expectedSize: number): boolean {
  try {
    return existsSync(path) && statSync(path).size === expectedSize
  } catch {
    return false
  }
}

export interface SelfUpdateDeps {
  /** Where to put the download (app.getPath('temp')). */
  tempRoot: string
  /** Free MB on that disk, or null when it cannot be read — then the guard stays out
   * of the way rather than blocking on bad data. */
  freeMB: (dir: string) => number | null
  /** Starts the installer, detached, so it outlives this process. */
  launch: (path: string) => void
  /** Closes the app so the installer can replace its files. */
  quit: () => void
  /** Progress for the UI. */
  onProgress?: (pct: number, stage: string) => void
  /** Written to the activity log. */
  log?: (message: string) => void
  /**
   * Re-checked immediately BEFORE the installer is launched, for the silent path.
   *
   * The gap this closes is real: a ~210 MB download takes minutes, so an update that was
   * safe to install when it started can become unsafe by the time it finishes — the user
   * has sat down and begun a render in between. Deciding once, at the start, would quit
   * the app out from under work that did not exist yet.
   *
   * Returning false leaves the verified installer on disk and reports `deferred`, so the
   * button in the banner then costs nothing: there is nothing left to download.
   */
  stillSafeToQuit?: () => boolean
}

/**
 * The whole update: look it up, fetch it, prove it, run it, quit.
 *
 * Shared by the button in the banner and by the silent sign-in path, so the two can
 * never drift apart — a "quiet" update that skipped the checksum because it was written
 * twice is exactly the sort of difference nobody notices until it breaks something.
 *
 * Returns rather than throws: every caller wants a sentence to show the user, and an
 * update that failed is not an exceptional condition, it is Tuesday.
 */
export async function runSelfUpdate(
  deps: SelfUpdateDeps
): Promise<{ ok: true } | { ok: false; error: string; deferred?: true }> {
  const say = (pct: number, stage: string): void => deps.onProgress?.(pct, stage)
  try {
    say(0, 'Looking up the newest version…')
    const rel = await fetchLatestRelease()
    if (!rel.ok) return { ok: false, error: rel.error }

    const picked = pickInstaller(rel.assets)
    if ('error' in picked) return { ok: false, error: picked.error }
    const asset = picked.asset
    const size = asset.size!
    const dest = join(updateDir(deps.tempRoot), INSTALLER_ASSET)

    // Re-use a complete previous download: a retry after a failed launch should not
    // cost another 210 MB on a connection that may be metered.
    if (!alreadyDownloaded(dest, size)) {
      const free = deps.freeMB(deps.tempRoot)
      if (free !== null && free < NEEDED_FREE_MB) {
        return {
          ok: false,
          error: `There is not enough free space to download the update (${free} MB free, about ${NEEDED_FREE_MB} MB needed).`
        }
      }
      freshUpdateDir(deps.tempRoot)
      say(0, 'Downloading the update…')
      const got = await downloadInstaller(asset.browser_download_url!, dest, (pct) => say(pct, 'Downloading the update…'))
      const verdict = verifyDownload(got, { size, sha256: expectedSha256(asset.digest) })
      if (!verdict.ok) {
        try {
          rmSync(dest, { force: true })
        } catch {
          // A file we refuse to run is harmless where it is.
        }
        return { ok: false, error: verdict.error }
      }
    }

    // Last check, AFTER the download, not before it. See stillSafeToQuit.
    if (deps.stillSafeToQuit && !deps.stillSafeToQuit()) {
      deps.log?.('The update is downloaded and will be installed once the current work finishes')
      return {
        ok: false,
        deferred: true,
        error: 'The update is downloaded and ready — it was held back because work is in progress.'
      }
    }

    say(100, 'Starting the installer…')
    deps.log?.('Downloaded the update and started the installer')
    deps.launch(dest)
    deps.quit()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The update could not be downloaded.' }
  }
}
