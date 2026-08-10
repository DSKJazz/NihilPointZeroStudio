/**
 * STRANDED WORK DETECTOR.
 *
 * The app can legitimately keep its data in one of three places (see main/index.ts):
 * the portable folder next to the exe, the adopted Desktop studio folder, or the
 * default per-user folder. That flexibility has a sharp edge: work created while one
 * location was active becomes INVISIBLE once the app starts using another. It happened
 * for real (2026-08-01) — 1.15 GB of finished videos sat unseen in the default folder
 * while the app ran from the Desktop studio, and nothing in the app ever said so.
 *
 * So the app now looks, says what it found in plain English, and can bring it in.
 * Read-only by default; the import COPIES (never moves, never overwrites) and is
 * idempotent, so pressing it twice imports nothing the second time.
 */
import { app } from 'electron'
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ffprobeIsPlayable } from './video/ffmpeg'
import { appendVideo, listVideos, logActivity, videosDir } from './store'
import type { StrandedReport, VideoJob } from '../shared/types'

export type { StrandedReport } from '../shared/types'

export function humanSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes <= 0) return '0 KB'
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Electron's DEFAULT per-user data folder — the one used before any redirect. It must
 * be computed from appData + the app name, because app.getPath('userData') returns
 * whatever main/index.ts redirected it to.
 */
export function defaultDataDir(): string {
  return join(app.getPath('appData'), app.getName())
}

/** Candidate homes the app could have written to in an earlier run, minus the active one. */
function otherDataDirs(active: string): string[] {
  const out = [defaultDataDir()]
  try {
    out.push(join(app.getPath('desktop'), 'NihilPointZeroStudio', 'nihilpointzero-data'))
  } catch {
    /* no Desktop on this machine — fine */
  }
  const seen = new Set([active.toLowerCase()])
  return out.filter((d) => {
    const k = d.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Playable video files (not sidecars) inside a data folder's videos/ directory.
 * Zero-byte files are skipped — those are the wreckage of an interrupted build, not
 * work, and offering to "recover" them would be a lie.
 */
function videoFilesIn(dir: string): string[] {
  const vids = join(dir, 'videos')
  if (!existsSync(vids)) return []
  try {
    return readdirSync(vids).filter((n) => {
      if (!/\.(mp4|mov|webm|mkv)$/i.test(n)) return false
      try {
        return statSync(join(vids, n)).size > 0
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function totalBytes(dir: string, names: string[]): number {
  let bytes = 0
  for (const n of names) {
    try {
      bytes += statSync(join(dir, 'videos', n)).size
    } catch {
      /* unreadable — leave it out of the total rather than guess */
    }
  }
  return bytes
}

/**
 * Looks for finished videos sitting in a data folder the app is NOT using, which the
 * app therefore cannot show. Only counts files the app doesn't already have by name,
 * so an already-imported video never keeps being reported. Never throws.
 */
/** Filenames the app's video list currently knows about. */
function knownFileNames(): Set<string> {
  return new Set(listVideos().map((j) => String(j.path).split(/[\\/]/).pop()?.toLowerCase() ?? ''))
}

/**
 * Keeps only files that actually PLAY. A build killed part-way leaves a huge mp4 with
 * no index — 10.7 GB and 2.3 GB of exactly that were found on a real machine. Offering
 * those as "recovered videos" would be handing the user corpses and calling them work.
 * Capped so a pathological folder can't spawn hundreds of probes.
 */
async function playableOnly(dir: string, names: string[]): Promise<string[]> {
  const out: string[] = []
  for (const n of names.slice(0, 40)) {
    if (await ffprobeIsPlayable(join(dir, 'videos', n))) out.push(n)
  }
  return out
}

/**
 * Everything finished that the app cannot currently show you, from BOTH causes:
 *  - inPlace  — the file is right there in the active folder, but the app's list lost
 *    track of it (14 GB of real videos were in exactly this state on 2026-08-01).
 *  - elsewhere — the file lives in a data folder the app stopped using.
 * Read-only and never throws.
 */
export async function scanStranded(activeDir = app.getPath('userData')): Promise<StrandedReport> {
  const empty: StrandedReport = { dir: null, inPlace: 0, elsewhere: 0, videoCount: 0, bytes: 0, size: '0 KB' }
  // The E2E harness runs against a throwaway data home; it must never look at — let
  // alone offer to copy — the real user's folders.
  if (process.env.NPZ_E2E_USERDATA) return empty
  try {
    const known = knownFileNames()
    const localNames = await playableOnly(
      activeDir,
      videoFilesIn(activeDir).filter((n) => !known.has(n.toLowerCase()))
    )
    let bytes = totalBytes(activeDir, localNames)

    let dir: string | null = null
    let elsewhere = 0
    for (const other of otherDataDirs(activeDir)) {
      const candidates = videoFilesIn(other).filter((n) => !known.has(n.toLowerCase()) && !localNames.includes(n))
      if (!candidates.length) continue
      const names = await playableOnly(other, candidates)
      if (!names.length) continue
      dir = other
      elsewhere = names.length
      bytes += totalBytes(other, names)
      break
    }

    const videoCount = localNames.length + elsewhere
    if (!videoCount) return empty
    return { dir, inPlace: localNames.length, elsewhere, videoCount, bytes, size: humanSize(bytes) }
  } catch {
    return empty
  }
}

/**
 * The best title we can honestly give a recovered video: an older index that still
 * remembers its real name wins; otherwise the filename, tidied up.
 */
function titleFor(fileName: string, searchDirs: string[]): string {
  for (const dir of searchDirs) {
    try {
      const idx = JSON.parse(readFileSync(join(dir, 'videos.json'), 'utf-8')) as VideoJob[]
      const hit = idx.find((j) => String(j.path).toLowerCase().endsWith(fileName.toLowerCase()))
      if (hit?.title) return `${hit.title} (recovered)`
    } catch {
      /* no index / unreadable — try the next one */
    }
  }
  const pretty = fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/-[0-9a-f]{8}$/i, '')
    .replace(/-/g, ' ')
    .trim()
  return `${pretty || 'Recovered video'} (recovered)`
}

/**
 * COPIES the stranded videos (plus their narration/preview sidecars) into the active
 * data folder and lists them in the app. The source folder is left untouched — the
 * user decides whether to delete it, never this code.
 */
export async function importStranded(
  activeDir = app.getPath('userData')
): Promise<{ imported: number; skipped: number; bytes: number }> {
  const report = await scanStranded(activeDir)
  if (!report.videoCount) return { imported: 0, skipped: 0, bytes: 0 }
  const dstVideos = videosDir()
  const known = knownFileNames()
  const searchDirs = otherDataDirs(activeDir)
  let imported = 0
  let skipped = 0
  let bytes = 0

  /** Lists one file in the app. `copyFrom` is set only when the file must be brought over. */
  const adopt = (name: string, copyFrom?: string): void => {
    if (known.has(name.toLowerCase())) {
      skipped++
      return
    }
    const dst = join(dstVideos, name)
    try {
      if (copyFrom) {
        if (existsSync(dst)) {
          skipped++
          return
        }
        copyFileSync(join(copyFrom, 'videos', name), dst)
        for (const sidecar of [`${name}.narration.wav`, `${name}.preview.png`]) {
          const s = join(copyFrom, 'videos', sidecar)
          if (existsSync(s)) copyFileSync(s, join(dstVideos, sidecar))
        }
      }
      const narration = join(dstVideos, `${name}.narration.wav`)
      appendVideo({
        id: randomUUID(),
        title: titleFor(name, searchDirs),
        path: dst,
        hasCustomVoice: false,
        createdAt: new Date(statSync(dst).mtime).toISOString(),
        narrationPath: existsSync(narration) ? narration : undefined
      })
      known.add(name.toLowerCase())
      bytes += statSync(dst).size
      imported++
    } catch {
      skipped++ // locked/unreadable file — skip it rather than fail the whole rescue
    }
  }

  // Only ever touch files that genuinely play (scanStranded already proved it).
  // 1) Already here, just unlisted — instant, nothing is copied.
  for (const name of await playableOnly(activeDir, videoFilesIn(activeDir))) adopt(name)
  // 2) Sitting in a folder the app stopped using — copied in, originals untouched.
  if (report.dir) for (const name of await playableOnly(report.dir, videoFilesIn(report.dir))) adopt(name, report.dir)

  if (imported) {
    logActivity(
      'user',
      `Recovered ${imported} video(s) that the app could not show`,
      `They are listed in Video Studio now (${humanSize(bytes)}). Nothing was moved or deleted — any originals in other folders were left exactly where they were.`
    )
  }
  return { imported, skipped, bytes }
}
