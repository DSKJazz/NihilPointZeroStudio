/**
 * WHERE THE USER'S WORK LIVES — decided once, written down, never guessed again.
 *
 * The app used to work out its data folder from scratch on every launch: portable
 * folder? adopted Desktop studio? default per-user folder? Each launch re-ran the
 * guess, so a change in the surroundings (Desktop folder renamed, a file missing)
 * silently moved the app to a DIFFERENT home and every video made before that
 * vanished from view. That cost ~15 GB of invisible work on a real machine
 * (2026-08-01) and is exactly the bug this module exists to make impossible.
 *
 * The cure: pick the home ONCE, record it in a tiny file at a fixed address, and on
 * every later launch just read it. The guess can never come back and change its mind.
 *
 * Two deliberate exceptions to the pin, in priority order:
 *   1. the E2E harness, which must always use its own throwaway home; and
 *   2. PORTABLE mode — an exe carried on a USB stick must use the data beside it,
 *      because travelling with its work is the entire point of a portable build.
 *
 * If the pinned folder ever goes missing (external drive unplugged, folder renamed)
 * the app does NOT silently start empty: it falls back, says so, and re-pins.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export type HomeSource = 'e2e' | 'portable' | 'pinned' | 'desktop' | 'default'

export interface HomeChoice {
  dir: string
  source: HomeSource
  /** True when this decision should be written down so it is never re-derived. */
  pin: boolean
  /** Plain-English note worth showing the user (only set when something surprising happened). */
  notice?: string
}

export interface HomeInputs {
  /** Isolated data home forced by the E2E harness. */
  e2eDir?: string
  /** Set by the portable build to the folder holding the exe. */
  portableDir?: string
  /** The data folder beside a portable exe. */
  portableCandidate?: string
  /** Whether that portable folder is writable OR already holds this user's work. */
  portableUsable?: boolean
  /** The folder recorded by a previous run, if any. */
  pinnedDir?: string | null
  /** Whether that recorded folder is still there and writable. */
  pinnedUsable?: boolean
  /** The classic Desktop studio data folder. */
  desktopDir?: string
  /** Whether it already holds this user's work. */
  desktopHasData?: boolean
  /** Electron's default per-user folder — the last resort, always writable. */
  defaultDir: string
}

/**
 * The whole decision, as a pure function so every branch is unit-tested rather than
 * discovered in the wild. Order: E2E → portable → pinned → adopt Desktop → default.
 */
export function decideDataHome(i: HomeInputs): HomeChoice {
  if (i.e2eDir) return { dir: i.e2eDir, source: 'e2e', pin: false }

  // A portable exe always uses the data beside it — never a pin from some other PC.
  if (i.portableDir && i.portableCandidate && i.portableUsable) {
    return { dir: i.portableCandidate, source: 'portable', pin: false }
  }

  if (i.pinnedDir) {
    if (i.pinnedUsable) return { dir: i.pinnedDir, source: 'pinned', pin: false }
    // The recorded folder is gone. Say so loudly rather than quietly starting fresh.
    const fallback = i.desktopHasData && i.desktopDir ? i.desktopDir : i.defaultDir
    return {
      dir: fallback,
      source: i.desktopHasData && i.desktopDir ? 'desktop' : 'default',
      pin: true,
      notice:
        `The folder your work was kept in could not be reached (${i.pinnedDir}). ` +
        `If that is an external drive, close the app, plug it back in and reopen — ` +
        `nothing has been deleted. The app is using ${fallback} for now.`
    }
  }

  // First run (or first run since this pin existed): decide once, then write it down.
  if (i.desktopHasData && i.desktopDir) return { dir: i.desktopDir, source: 'desktop', pin: true }
  return { dir: i.defaultDir, source: 'default', pin: true }
}

interface PinFile {
  dataDir?: string
  pinnedAt?: string
}

/**
 * The pin lives at a FIXED address that never depends on the answer it holds —
 * Electron's default per-user folder. Anything else would be circular.
 */
export function pinFilePath(defaultDir: string): string {
  return join(defaultDir, 'data-home.json')
}

export function readPin(defaultDir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(pinFilePath(defaultDir), 'utf-8')) as PinFile
    const dir = typeof raw.dataDir === 'string' ? raw.dataDir.trim() : ''
    return dir.length ? dir : null
  } catch {
    return null // no pin yet, or unreadable — treat as "not decided"
  }
}

export function writePin(defaultDir: string, dataDir: string): void {
  try {
    mkdirSync(defaultDir, { recursive: true })
    writeFileSync(
      pinFilePath(defaultDir),
      JSON.stringify({ dataDir, pinnedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    )
  } catch {
    /* an unwritable pin must never stop the app starting — it just re-decides next time */
  }
}

/** True when a folder exists (or can be made) and actually accepts a write. */
export function isUsableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    // PID-unique so two copies launching together cannot collide on one probe file.
    const probe = join(dir, `.write-test-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** True when a data folder already holds this user's work. */
export function holdsUserWork(dir: string): boolean {
  return existsSync(join(dir, 'settings.json')) || existsSync(join(dir, 'videos.json'))
}
