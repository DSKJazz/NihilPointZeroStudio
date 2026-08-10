/**
 * Weekly, silent backup of the user's WORK — plus restore, and (by the user's
 * explicit 2026-07-31 instruction) DELETE-SYNC: when something is permanently
 * deleted inside the app, its backup copy goes too, so "delete forever" finally
 * means forever. Every purge is logged and the confirm dialogs say it plainly.
 *
 * Rules:
 *  - The backup lives in ONE place the user chose: <home>\NihilPointZero-Backups
 *    (auto-migrated from the old Documents location). An OPTIONAL second location
 *    (USB / second disk) can be set in Settings — that one exists so a dead laptop
 *    disk cannot take both copies down.
 *  - SECRETS ARE NEVER COPIED. Allowlist of user-work items only; keys and the
 *    Chromium profile state are excluded (backups may end up cloud-synced).
 *  - The backup itself never deletes anything EXCEPT what the user permanently
 *    deleted in the app (delete-sync, toggleable) or explicitly confirmed in the
 *    orphan-cleanup maintenance flow.
 *  - NEVER report success it didn't achieve: a failed copy blocks the 7-day stamp
 *    so the next launch retries, and the Activity Log says so.
 *  - Restore is NON-DESTRUCTIVE: it only copies files that are MISSING from the
 *    live folder — it can never overwrite newer work.
 *  - Core functions take explicit src/dst paths so the whole backup→delete→restore
 *    round-trip is unit-tested with real files (autoBackup.test.ts — the "restore
 *    drill" that proves the safety net actually holds weight).
 */
import { app } from 'electron'
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { existsSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { getSecondBackupDir, isPurgeBackupsOnDelete, logActivity } from './store'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The user's actual work — files and folders worth protecting. Anything not named
 * here is skipped, which is what keeps credentials and browser state out of the copy.
 */
export const BACKUP_ALLOWLIST = [
  'videos', // finished renders (the irreplaceable, multi-GB ones)
  'thumbnails',
  'videos.json',
  'drafts.json',
  'library.json',
  'scriptpad.json',
  'advisor-chat.json',
  'activity-log.json',
  'dj-plans.json',
  'templates.json'
]

/** Never copied, even if a name above ever expands to include them. */
export const BACKUP_DENYLIST = [
  'settings.json', // contains API keys (reversible in portable mode)
  'stock.json', // contains the Pixabay/Pexels keys
  'ai-video.json', // contains the AI-video engine keys
  'Local State',
  'Preferences',
  'Local Storage',
  'Session Storage',
  'Network',
  'Cookies',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Shared Dictionary',
  'SharedStorage',
  'DIPS',
  'piper' // re-downloadable voice models, hundreds of MB
]

interface Stamp {
  lastRunAt?: string
}

function stampPath(): string {
  return join(app.getPath('userData'), 'last-auto-backup.json')
}

function readStamp(): Stamp {
  try {
    return JSON.parse(readFileSync(stampPath(), 'utf-8')) as Stamp
  } catch {
    return {}
  }
}

/**
 * ONE canonical home for backups: <home>\NihilPointZero-Backups (the user's own
 * spot, per their instruction). The old Documents location is migrated by a plain
 * folder move the first time this runs; if both somehow exist, nothing is touched
 * and the new location simply wins for future runs.
 */
export function backupsRoot(): string {
  // E2E harness: backups must land inside the isolated throwaway data home — a test
  // clicking "Back up now" must never write test data into the user's real backups.
  const e2e = process.env.NPZ_E2E_USERDATA
  if (e2e) return join(e2e, 'NihilPointZero-Backups')
  const root = join(app.getPath('home'), 'NihilPointZero-Backups')
  try {
    const legacy = join(app.getPath('documents'), 'NihilPointZero-Backups')
    if (!existsSync(root) && existsSync(legacy)) {
      renameSync(legacy, root)
      logActivity('ai', 'Moved the backup folder to its new home', root)
    }
  } catch {
    /* same-drive rename failed (locked file?) — fall through, use the new root fresh */
  }
  return root
}

export function backupIsDue(now: number, lastRunAt?: string): boolean {
  if (!lastRunAt) return true
  const last = Date.parse(lastRunAt)
  if (Number.isNaN(last)) return true
  return now - last >= WEEK_MS
}

/** True when an entry may be copied (allowlisted at the top level, never denylisted). */
export function isBackupCandidate(name: string, topLevel: boolean): boolean {
  if (BACKUP_DENYLIST.includes(name)) return false
  if (name.endsWith('.tmp') || name === 'NihilPointZero-Backups') return false
  return topLevel ? BACKUP_ALLOWLIST.includes(name) : true
}

export interface Counters {
  copied: number
  unchanged: number
  failed: number
}

/**
 * Async recursive copy that adds/updates only. `missingOnly` is the RESTORE mode:
 * a file that already exists at the destination is never touched, so a restore can
 * never overwrite newer live work. Failures are counted, never swallowed into a
 * success. Symlinks/junctions are skipped so a loop can't be followed out of the tree.
 */
export async function copyTree(
  src: string,
  dst: string,
  counters: Counters,
  opts: { topLevel?: boolean; missingOnly?: boolean } = {}
): Promise<void> {
  const topLevel = opts.topLevel ?? true
  await mkdir(dst, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (!isBackupCandidate(entry.name, topLevel)) continue
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    try {
      if (entry.isDirectory()) {
        await copyTree(from, to, counters, { topLevel: false, missingOnly: opts.missingOnly })
      } else if (entry.isFile()) {
        if (existsSync(to)) {
          if (opts.missingOnly) {
            counters.unchanged++
            continue
          }
          const s = await stat(from)
          const d = await stat(to)
          if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000) {
            counters.unchanged++
            continue
          }
        }
        await copyFile(from, to)
        counters.copied++
      }
      // Anything else (symlink, junction, socket) is intentionally ignored.
    } catch {
      counters.failed++
    }
  }
}

/** One backup pass: live data → a backup's data folder. Exported for the drill tests. */
export async function runBackup(srcDataDir: string, dstDataDir: string): Promise<Counters> {
  const counters: Counters = { copied: 0, unchanged: 0, failed: 0 }
  await copyTree(srcDataDir, dstDataDir, counters)
  return counters
}

/**
 * NON-DESTRUCTIVE restore: copies anything present in the backup but MISSING from
 * the live folder. Existing live files are never touched. Exported for the drill.
 */
export async function restoreMissing(backupDataDir: string, liveDataDir: string): Promise<Counters> {
  const counters: Counters = { copied: 0, unchanged: 0, failed: 0 }
  await copyTree(backupDataDir, liveDataDir, counters, { missingOnly: true })
  return counters
}

/**
 * DELETE-SYNC (explicit user instruction, 2026-07-31): when the user permanently
 * deletes something in the app, remove its copy from every backup location too —
 * "delete forever" must not leave ghosts. Only exact relative paths are touched,
 * every removal is logged, and the whole behavior can be turned off in Settings.
 */
export async function purgeFromBackups(relPaths: string[], roots?: string[]): Promise<number> {
  const targets = roots ?? backupRootsForPurge()
  let removed = 0
  for (const root of targets) {
    for (const rel of relPaths) {
      if (!rel || rel.includes('..')) continue // never step outside the backup tree
      const p = join(root, 'nihilpointzero-data', rel)
      try {
        if (existsSync(p)) {
          await rm(p, { force: true })
          removed++
        }
      } catch {
        /* a locked backup file stays; the orphan cleanup can catch it later */
      }
    }
  }
  if (removed > 0) {
    try {
      logActivity('user', `Removed ${removed} backup cop${removed === 1 ? 'y' : 'ies'} of permanently deleted item(s)`, 'You deleted these in the app; delete-sync (Settings → Backups) removed the backup copies too, so they are gone for good.')
    } catch {
      /* logging must never undo a successful purge */
    }
  }
  return removed
}

function backupRootsForPurge(): string[] {
  if (!isPurgeBackupsOnDelete()) return []
  const roots = [backupsRoot()]
  const second = getSecondBackupDir()
  if (second) roots.push(second)
  return roots
}

export interface OrphanReport {
  count: number
  bytes: number
  relPaths: string[]
}

/**
 * Files that exist in the backup but NOT in the live data — i.e. things deleted in
 * the app before delete-sync existed. Listed first, deleted only after the user
 * confirms in the maintenance flow. Exported for tests.
 */
export async function listOrphans(backupDataDir: string, liveDataDir: string, relBase = ''): Promise<OrphanReport> {
  const report: OrphanReport = { count: 0, bytes: 0, relPaths: [] }
  if (!existsSync(backupDataDir)) return report
  const entries = await readdir(backupDataDir, { withFileTypes: true })
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name
    const backupPath = join(backupDataDir, entry.name)
    const livePath = join(liveDataDir, entry.name)
    if (entry.isDirectory()) {
      const sub = await listOrphans(backupPath, livePath, rel)
      report.count += sub.count
      report.bytes += sub.bytes
      report.relPaths.push(...sub.relPaths)
    } else if (entry.isFile() && !existsSync(livePath)) {
      const s = await stat(backupPath).catch(() => null)
      report.count++
      report.bytes += s?.size ?? 0
      report.relPaths.push(rel)
    }
  }
  return report
}

/**
 * Runs a backup if one is due (primary root always; the optional second location
 * too, when set). Never throws. The stamp is written ONLY on a clean primary run,
 * so a failed backup retries on the next launch instead of going quiet for a week.
 */
export async function runAutoBackupIfDue(): Promise<{
  ran: boolean
  copied?: number
  unchanged?: number
  failed?: number
  reason?: string
}> {
  try {
    const stamp = readStamp()
    if (!backupIsDue(Date.now(), stamp.lastRunAt)) return { ran: false, reason: 'not due yet' }
    // userData IS the live data folder (index.ts repoints it for the portable copy),
    // so this always matches what the running app actually reads and writes.
    const src = app.getPath('userData')
    if (!existsSync(src)) return { ran: false, reason: 'data folder not found' }
    const root = backupsRoot()
    const counters = await runBackup(src, join(root, 'nihilpointzero-data'))

    // Optional second home (USB / second disk): best-effort, reported separately —
    // an unplugged drive must never block or fail the primary backup.
    const second = getSecondBackupDir()
    if (second) {
      if (existsSync(second)) {
        const c2 = await runBackup(src, join(second, 'nihilpointzero-data'))
        logActivity(
          'ai',
          `Second-location backup ${c2.failed ? 'INCOMPLETE' : 'done'} — ${c2.copied} copied, ${c2.unchanged} up to date${c2.failed ? `, ${c2.failed} failed` : ''}`,
          second
        )
      } else {
        logActivity('ai', 'Second backup location not reachable (drive unplugged?) — skipped this week', second)
      }
    }

    if (counters.failed > 0) {
      // Do NOT stamp: an incomplete backup must try again next launch.
      logActivity(
        'ai',
        `Automatic weekly backup INCOMPLETE — ${counters.failed} file(s) could not be copied (will retry next time you open the app)`,
        `Copied ${counters.copied}, already up to date ${counters.unchanged}. Destination: ${root}. Common causes: disk full, or a file in use.`
      )
      return { ran: true, ...counters }
    }

    await writeFile(stampPath(), JSON.stringify({ lastRunAt: new Date().toISOString() }, null, 2), 'utf-8')
    logActivity(
      'ai',
      `Automatic weekly backup done — ${counters.copied} new/changed file(s) copied, ${counters.unchanged} already up to date`,
      `Your videos, scripts, library and logs were copied to ${root}. For safety, API keys and browser data are deliberately NOT included.`
    )
    return { ran: true, ...counters }
  } catch (err) {
    try {
      logActivity('ai', 'Automatic weekly backup could not run', err instanceof Error ? err.message : String(err))
    } catch {
      /* logging must never throw either */
    }
    return { ran: false, reason: 'error' }
  }
}
