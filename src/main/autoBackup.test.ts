import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BACKUP_ALLOWLIST,
  BACKUP_DENYLIST,
  backupIsDue,
  isBackupCandidate,
  listOrphans,
  purgeFromBackups,
  restoreMissing,
  runBackup
} from './autoBackup'

const NOW = Date.parse('2026-07-30T12:00:00Z')
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

describe('backupIsDue', () => {
  it('is due when no backup has ever run', () => {
    expect(backupIsDue(NOW, undefined)).toBe(true)
  })
  it('is due after 7 days', () => {
    expect(backupIsDue(NOW, daysAgo(7))).toBe(true)
    expect(backupIsDue(NOW, daysAgo(30))).toBe(true)
  })
  it('is NOT due before 7 days (no backup storms on every launch)', () => {
    expect(backupIsDue(NOW, daysAgo(0))).toBe(false)
    expect(backupIsDue(NOW, daysAgo(6))).toBe(false)
  })
  it('is due when the stamp is corrupt (fail safe: back up rather than skip)', () => {
    expect(backupIsDue(NOW, 'not-a-date')).toBe(true)
    expect(backupIsDue(NOW, '')).toBe(true)
  })
})

describe('isBackupCandidate — secrets must never be copied', () => {
  it('copies the user work folders/files', () => {
    expect(isBackupCandidate('videos', true)).toBe(true)
    expect(isBackupCandidate('library.json', true)).toBe(true)
    expect(isBackupCandidate('drafts.json', true)).toBe(true)
  })
  it('NEVER copies files holding API keys', () => {
    expect(isBackupCandidate('settings.json', true)).toBe(false)
    expect(isBackupCandidate('stock.json', true)).toBe(false)
    // also blocked deeper in the tree, not just at the top
    expect(isBackupCandidate('settings.json', false)).toBe(false)
    expect(isBackupCandidate('stock.json', false)).toBe(false)
  })
  it('NEVER copies Chromium profile / credential state', () => {
    for (const n of ['Local State', 'Cookies', 'Network', 'Local Storage', 'Session Storage', 'Preferences']) {
      expect(isBackupCandidate(n, true)).toBe(false)
      expect(isBackupCandidate(n, false)).toBe(false)
    }
  })
  it('skips caches, temp files and the backup folder itself (no nesting)', () => {
    expect(isBackupCandidate('Cache', true)).toBe(false)
    expect(isBackupCandidate('GPUCache', false)).toBe(false)
    expect(isBackupCandidate('half-written.tmp', false)).toBe(false)
    expect(isBackupCandidate('NihilPointZero-Backups', false)).toBe(false)
  })
  it('ignores unknown items at the top level, but keeps children inside allowed folders', () => {
    expect(isBackupCandidate('something-new.json', true)).toBe(false)
    expect(isBackupCandidate('my-video.mp4', false)).toBe(true)
  })
  it('has no overlap between the allow and deny lists', () => {
    expect(BACKUP_ALLOWLIST.filter((a) => BACKUP_DENYLIST.includes(a))).toEqual([])
  })
})

/**
 * THE RESTORE DRILL — real files on real disk, the full life of a backup:
 * back up → lose work → restore → verify byte-identical. A backup nobody has
 * ever restored from is a hope, not a safety net; this is the proof it holds.
 */
describe('restore drill (backup → lose work → restore round-trip)', () => {
  let live: string
  let root: string // the backup root (contains nihilpointzero-data)
  let backup: string // the data folder inside the backup root

  beforeEach(() => {
    live = mkdtempSync(join(tmpdir(), 'npz-live-'))
    root = mkdtempSync(join(tmpdir(), 'npz-backup-'))
    backup = join(root, 'nihilpointzero-data')
    // A realistic live data folder: work worth saving + secrets that must stay behind.
    mkdirSync(join(live, 'videos'))
    writeFileSync(join(live, 'videos', 'market-crash.mp4'), 'FAKE-MP4-BYTES-1234567890')
    writeFileSync(join(live, 'videos.json'), '[{"id":"v1"}]')
    writeFileSync(join(live, 'drafts.json'), '{"draft":"psx analysis"}')
    writeFileSync(join(live, 'settings.json'), '{"apiKey":"SECRET"}')
    writeFileSync(join(live, 'ai-video.json'), '{"pollinationsKeyEnc":"SECRET"}')
    mkdirSync(join(live, 'Local Storage'))
    writeFileSync(join(live, 'Local Storage', 'leveldb.bin'), 'browser-state')
  })

  afterEach(() => {
    rmSync(live, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('backs up the work, never the secrets', async () => {
    const c = await runBackup(live, backup)
    expect(c.failed).toBe(0)
    expect(c.copied).toBe(3) // the mp4 + videos.json + drafts.json
    expect(existsSync(join(backup, 'videos', 'market-crash.mp4'))).toBe(true)
    expect(existsSync(join(backup, 'settings.json'))).toBe(false)
    expect(existsSync(join(backup, 'ai-video.json'))).toBe(false)
    expect(existsSync(join(backup, 'Local Storage'))).toBe(false)
  })

  it('a second pass copies nothing (unchanged files are recognized)', async () => {
    await runBackup(live, backup)
    const c2 = await runBackup(live, backup)
    expect(c2.copied).toBe(0)
    expect(c2.unchanged).toBe(3)
    expect(c2.failed).toBe(0)
  })

  it('LOSE the video, restore brings it back byte-identical', async () => {
    await runBackup(live, backup)
    rmSync(join(live, 'videos', 'market-crash.mp4')) // the disaster
    const r = await restoreMissing(backup, live)
    expect(r.copied).toBe(1)
    expect(r.failed).toBe(0)
    expect(readFileSync(join(live, 'videos', 'market-crash.mp4'), 'utf-8')).toBe('FAKE-MP4-BYTES-1234567890')
  })

  it('restore NEVER overwrites live work, even when the backup copy differs', async () => {
    await runBackup(live, backup)
    writeFileSync(join(live, 'drafts.json'), '{"draft":"NEWER work since the backup"}')
    const r = await restoreMissing(backup, live)
    expect(r.copied).toBe(0)
    expect(readFileSync(join(live, 'drafts.json'), 'utf-8')).toBe('{"draft":"NEWER work since the backup"}')
  })

  it('delete-sync purge removes exactly the named backup copy, and only inside the tree', async () => {
    await runBackup(live, backup)
    const removed = await purgeFromBackups(['videos/market-crash.mp4'], [root])
    expect(removed).toBe(1)
    expect(existsSync(join(backup, 'videos', 'market-crash.mp4'))).toBe(false)
    expect(existsSync(join(backup, 'videos.json'))).toBe(true) // neighbors untouched
    // Purging the same thing twice is a no-op, and traversal is refused outright.
    expect(await purgeFromBackups(['videos/market-crash.mp4'], [root])).toBe(0)
    writeFileSync(join(root, 'outside.txt'), 'must survive')
    expect(await purgeFromBackups(['../outside.txt'], [root])).toBe(0)
    expect(existsSync(join(root, 'outside.txt'))).toBe(true)
  })

  it('orphan scan finds only what the app no longer has, and purging it leaves zero ghosts', async () => {
    await runBackup(live, backup)
    rmSync(join(live, 'videos', 'market-crash.mp4')) // deleted in-app pre-delete-sync
    const orphans = await listOrphans(backup, live)
    expect(orphans.relPaths).toEqual(['videos/market-crash.mp4'])
    expect(orphans.count).toBe(1)
    expect(orphans.bytes).toBeGreaterThan(0)
    await purgeFromBackups(orphans.relPaths, [root])
    const after = await listOrphans(backup, live)
    expect(after.count).toBe(0)
  })
})
