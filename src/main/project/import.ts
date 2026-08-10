/**
 * Bringing a plan made on the phone into the studio.
 *
 * The phone plans; this turns the plan back into something the renderer understands:
 * validate it, write any attached photos/clips/recordings to disk, swap the
 * `asset:<id>` references for real paths, and hand the result to the Storyboard tab
 * through the SAME draft key that tab already autosaves to.
 *
 * Two rules this must never break:
 *  1. It never deletes or overwrites the user's work. `setDraft` keeps a 10-deep
 *     history, so the storyboard that was open before an import is still recoverable.
 *  2. Nothing from outside is trusted. Everything goes through `sanitizeProject`
 *     first, and attachment bytes are written with an extension WE choose from the
 *     validated mime type — never from the incoming filename.
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  assetRefId,
  beatsNeedingMedia,
  isAssetRef,
  sanitizeProject,
  type ImportedProject,
  type ProjectAsset
} from '../../shared/project'

export type { ImportedProject }
import type { StoryboardDoc } from '../../shared/types'
import { logActivity, phoneAssetsDir, setDraft } from '../store'

/** The draft key the Storyboard tab already restores from on open. */
export const STORYBOARD_DRAFT_KEY = 'storyboard-project'

/**
 * Extension chosen from the VALIDATED mime type, never from the incoming filename —
 * an attacker-supplied "photo.exe" must not become an .exe on the user's disk.
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/aac': '.aac'
}

function extFor(asset: ProjectAsset): string {
  // Recorded audio arrives as e.g. "audio/webm;codecs=opus".
  const base = asset.mime.split(';')[0].trim().toLowerCase()
  return EXT_BY_MIME[base] ?? (asset.kind === 'photo' ? '.jpg' : asset.kind === 'clip' ? '.mp4' : '.webm')
}

/** Ids come from `sanitizeProject`, but this is what builds a path — keep it strict. */
function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'asset'
}

/**
 * Imports a parsed plan. Throws only when the input is not a readable plan at all;
 * everything else is reported through `warnings` so a partly-damaged plan still
 * delivers the user's work instead of refusing outright.
 */
export function importPhoneProject(raw: unknown): ImportedProject {
  const { project, warnings } = sanitizeProject(raw)
  const dir = phoneAssetsDir()

  // 1. Write attachments and remember where each one landed.
  const pathById = new Map<string, string>()
  let writtenAssets = 0
  for (const asset of project.assets) {
    const file = join(dir, `${safeId(asset.id)}${extFor(asset)}`)
    try {
      writeFileSync(file, Buffer.from(asset.data, 'base64'))
      pathById.set(asset.id, file)
      writtenAssets++
    } catch {
      warnings.push(`Could not save ${asset.name ?? asset.kind} to this PC — you can attach it here instead.`)
    }
  }

  // 2. Swap asset references for the real paths the renderer needs.
  const doc: StoryboardDoc = project.storyboard
  for (const beat of doc.beats) {
    if (isAssetRef(beat.subject.src)) {
      const path = pathById.get(assetRefId(beat.subject.src))
      // A reference with no file left means "ask me on the PC" — clear it, keep the kind.
      beat.subject = { ...beat.subject, src: path }
    }
    if (beat.sounds?.length) {
      beat.sounds = beat.sounds
        .map((s) => (isAssetRef(s.src) ? { ...s, src: pathById.get(assetRefId(s.src)) } : s))
        // A 'file' sound with no file is meaningless; drop it rather than render silence.
        .filter((s) => s.kind !== 'file' || !!s.src)
    }
  }

  // 3. Hand it to the Storyboard tab, in exactly the shape that tab autosaves and
  //    restores. setDraft keeps the previous version in history, so this can never
  //    lose a storyboard the user already had open.
  const seconds = doc.beats.reduce((n, b) => n + b.durationSec, 0)
  // The tab's resolution picker is keyed by these exact labels (see RES in
  // StoryboardPage), which mix shape and size — map the phone's aspect onto them.
  const resKey =
    project.build.aspect === '9:16' ? '9:16 (Shorts)' : project.build.aspect === '1:1' ? '1:1' : '1080p'
  // The tab uses ONE photo for every "my photo" beat, so seed it with the first
  // photo the phone sent; per-beat sources stay on the beats themselves.
  const firstPhoto = project.assets.find((a) => a.kind === 'photo')
  setDraft(STORYBOARD_DRAFT_KEY, {
    mode: 'auto',
    title: project.title,
    brief: project.script?.body ?? '',
    language: doc.language ?? '',
    resKey,
    fps: doc.fps,
    totalSeconds: Math.max(10, Math.min(3600, Math.round(seconds))),
    style: doc.style,
    beats: doc.beats,
    photoPath: (firstPhoto && pathById.get(firstPhoto.id)) ?? null,
    beautifyStrength: 0.6
  })

  const needMedia = beatsNeedingMedia(doc)

  logActivity(
    'user',
    'Imported a plan made on the phone',
    `${doc.beats.length} scenes · ${Math.round(seconds)}s${writtenAssets ? ` · ${writtenAssets} attachments` : ''}`
  )

  return {
    title: project.title,
    scenes: doc.beats.length,
    seconds,
    needMedia,
    writtenAssets,
    warnings,
    script: project.script,
    storyboardBeats: doc.beats,
    style: doc.style,
    resKey,
    fps: doc.fps,
    photoPath: (firstPhoto && pathById.get(firstPhoto.id)) ?? null
  }
}

/** Reads a `.npzproject.json` from disk and imports it. */
export function importPhoneProjectJson(text: string): ImportedProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not readable — it may have been damaged in transfer.')
  }
  return importPhoneProject(parsed)
}
