/**
 * The PHONE PROJECT file — how a video planned on the phone travels to the PC.
 *
 * The phone can do all the *thinking* of a video (the storyboard: what each shot
 * shows, how long, what is said, the mood, the music) but none of the *making*
 * (ffmpeg, voices, subtitles). So the phone writes one of these, the user moves it
 * across by Drive/WhatsApp — or pushes it straight over Wi-Fi — and the PC turns it
 * back into a real storyboard and renders it.
 *
 * This module is deliberately PURE — no node, no electron, no DOM — so the phone
 * bundle, the main process and the tests all share exactly one definition of the
 * format. Same discipline as video/storyboard.ts: the file arriving from outside is
 * never trusted, it is SANITIZED, and a malformed field can never reach ffmpeg.
 */
import { sanitizeStoryboard } from './storyboard'
import { VIDEO_ASPECTS, VIDEO_STYLES, VIDEO_TEMPLATES } from './types'
import type {
  StoryboardBeat,
  StoryboardDoc,
  VideoAspect,
  VideoResolution,
  VideoStyle,
  VideoTemplate
} from './types'

/** Bumped only if the shape changes incompatibly; the importer refuses what it can't read. */
export const PROJECT_FORMAT_VERSION = 1

export const PROJECT_FILE_EXT = '.npzproject.json'

/**
 * Build settings the phone is allowed to choose. Deliberately a SUBSET of
 * VideoBuildRequest: everything here is a plain value, never a PC file path. Paths
 * (music files, image files) are chosen on the PC, where files actually exist.
 */
export interface PhoneBuildSettings {
  resolution: VideoResolution
  aspect: VideoAspect
  template: VideoTemplate
  style: VideoStyle
  narrationVoice: 'windows' | 'piper' | 'winnatural' | 'silent'
  captionsAndChapters: boolean
  textOverlays: boolean
  soundEffects: boolean
}

export type ProjectAssetKind = 'photo' | 'clip' | 'audio'

/**
 * A file the user attached ON THE PHONE (a gallery photo, a clip, a voice recording),
 * carried inside the project as base64. Beats point at it with `asset:<id>`; the
 * importer writes it to disk and swaps in the real path.
 */
export interface ProjectAsset {
  id: string
  kind: ProjectAssetKind
  /** Original filename, used only to pick a sensible extension on the PC. */
  name?: string
  mime: string
  /** base64, no data: prefix. */
  data: string
}

export interface PhoneProject {
  formatVersion: number
  createdAt: string
  title: string
  /** The script the storyboard came from, so the PC has it for narration/captions. */
  script?: { title: string; body: string }
  storyboard: StoryboardDoc
  build: PhoneBuildSettings
  assets: ProjectAsset[]
}

/**
 * Per-asset and whole-project ceilings. A phone plan is meant to move over mobile
 * data and land in WhatsApp/Drive; without a cap, one 4K clip turns a plan into
 * something that cannot be sent at all. The phone warns before it hits these.
 */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024
export const MAX_PROJECT_BYTES = 60 * 1024 * 1024

/** What each kind of attachment is allowed to be. Anything else is dropped. */
const ALLOWED_MIME: Record<ProjectAssetKind, RegExp> = {
  photo: /^image\/(jpeg|png|webp)$/i,
  clip: /^video\/(mp4|webm|quicktime)$/i,
  audio: /^audio\/(webm|mp4|mpeg|ogg|wav|aac)(;.*)?$/i
}

const RESOLUTIONS: VideoResolution[] = ['1080p', '1440p', '4k', '8k']
const VOICES: PhoneBuildSettings['narrationVoice'][] = ['windows', 'piper', 'winnatural', 'silent']

export const DEFAULT_BUILD: PhoneBuildSettings = {
  resolution: '1080p',
  aspect: '16:9',
  template: 'clean',
  style: 'cinematic',
  // Silent by default: the whole point of planning on the phone is that the user
  // records their own voice on the PC afterwards.
  narrationVoice: 'silent',
  captionsAndChapters: false,
  textOverlays: true,
  soundEffects: false
}

/** Pixel size for an aspect at a resolution — also what the phone previews at (scaled). */
export function frameSize(resolution: VideoResolution, aspect: VideoAspect): { width: number; height: number } {
  const longEdge = resolution === '8k' ? 7680 : resolution === '4k' ? 3840 : resolution === '1440p' ? 2560 : 1920
  if (aspect === '9:16') return { width: Math.round((longEdge * 9) / 16), height: longEdge }
  if (aspect === '1:1') {
    const side = Math.round((longEdge * 9) / 16)
    return { width: side, height: side }
  }
  return { width: longEdge, height: Math.round((longEdge * 9) / 16) }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Rough decoded size of a base64 string without actually decoding it. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export function sanitizeBuild(raw: unknown): PhoneBuildSettings {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    resolution: pick(o.resolution, RESOLUTIONS, DEFAULT_BUILD.resolution),
    aspect: pick(o.aspect, VIDEO_ASPECTS, DEFAULT_BUILD.aspect),
    template: pick(o.template, VIDEO_TEMPLATES, DEFAULT_BUILD.template),
    style: pick(o.style, VIDEO_STYLES, DEFAULT_BUILD.style),
    narrationVoice: pick(o.narrationVoice, VOICES, DEFAULT_BUILD.narrationVoice),
    captionsAndChapters: bool(o.captionsAndChapters, DEFAULT_BUILD.captionsAndChapters),
    textOverlays: bool(o.textOverlays, DEFAULT_BUILD.textOverlays),
    soundEffects: bool(o.soundEffects, DEFAULT_BUILD.soundEffects)
  }
}

/** The reference form a beat uses to point at an embedded asset. */
export function assetRef(id: string): string {
  return `asset:${id}`
}

/** Type guard, so callers can use the src straight afterwards without a cast. */
export function isAssetRef(src: string | undefined): src is string {
  return typeof src === 'string' && src.startsWith('asset:')
}

export function assetRefId(src: string): string {
  return src.slice('asset:'.length)
}

export interface SanitizeProjectResult {
  project: PhoneProject
  /** Plain-English notes about anything that was dropped or repaired. */
  warnings: string[]
}

/**
 * Turns an untrusted parsed JSON blob into a project that is safe to act on.
 *
 * Nothing here throws for bad content — a damaged plan should still open with as
 * much of the user's work intact as possible, and TELL them what was lost. It throws
 * only when the input isn't a project at all, or is from a future version this build
 * cannot understand (guessing would be worse than saying so).
 */
export function sanitizeProject(raw: unknown): SanitizeProjectResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('That file is not a NihilPointZero plan.')
  }
  const o = raw as Record<string, unknown>
  const version = typeof o.formatVersion === 'number' ? o.formatVersion : 0
  if (!version) throw new Error('That file is not a NihilPointZero plan (no version marker).')
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `That plan was made by a newer version of the phone app (format ${version}). Update the studio on this PC, then import it again.`
    )
  }

  const warnings: string[] = []

  // --- assets first: beats can only keep references to assets that survive ---
  const assets: ProjectAsset[] = []
  const seenIds = new Set<string>()
  let totalBytes = 0
  const rawAssets = Array.isArray(o.assets) ? o.assets : []
  rawAssets.forEach((a, i) => {
    const ao = (a ?? {}) as Record<string, unknown>
    const id = str(ao.id)
    const kind = ao.kind
    const mime = str(ao.mime)
    const data = typeof ao.data === 'string' ? ao.data : ''
    const label = str(ao.name) ?? `attachment ${i + 1}`
    if (!id || (kind !== 'photo' && kind !== 'clip' && kind !== 'audio')) {
      warnings.push(`Dropped ${label}: it was not a recognisable attachment.`)
      return
    }
    if (seenIds.has(id)) {
      warnings.push(`Dropped a duplicate copy of ${label}.`)
      return
    }
    if (!mime || !ALLOWED_MIME[kind].test(mime)) {
      warnings.push(`Dropped ${label}: "${mime ?? 'unknown'}" is not a file type this can accept.`)
      return
    }
    if (!data || !BASE64_RE.test(data)) {
      warnings.push(`Dropped ${label}: the attached file was damaged in transit.`)
      return
    }
    const bytes = base64Bytes(data)
    if (bytes > MAX_ASSET_BYTES) {
      warnings.push(`Dropped ${label}: it is larger than the ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB limit.`)
      return
    }
    if (totalBytes + bytes > MAX_PROJECT_BYTES) {
      warnings.push(`Dropped ${label}: the plan had already reached its total size limit.`)
      return
    }
    totalBytes += bytes
    seenIds.add(id)
    assets.push({ id, kind, name: str(ao.name), mime, data })
  })

  // --- storyboard: reuse the studio's own validated sanitizer ---
  const rawStoryboard = (o.storyboard ?? {}) as Record<string, unknown>
  const build = sanitizeBuild(o.build)
  const { width, height } = frameSize(build.resolution, build.aspect)
  const storyboard = sanitizeStoryboard(rawStoryboard, { width, height, fps: 30 })

  // The style lives in two places (build settings and the storyboard); the build
  // screen is what the user actually set, so it wins.
  storyboard.style = build.style

  // --- drop references to assets that did not survive above ---
  for (const beat of storyboard.beats) {
    if (isAssetRef(beat.subject.src) && !seenIds.has(assetRefId(beat.subject.src))) {
      warnings.push(`Scene "${beat.visual.slice(0, 40)}…" lost its attached picture; you can pick one on this PC.`)
      beat.subject.src = undefined
    }
    if (beat.sounds?.length) {
      beat.sounds = beat.sounds.filter((s) => {
        if (s.kind !== 'file' || !isAssetRef(s.src)) return true
        const ok = seenIds.has(assetRefId(s.src))
        if (!ok) warnings.push(`A recording attached to "${beat.visual.slice(0, 40)}…" did not arrive.`)
        return ok
      })
    }
  }

  const scriptRaw = (o.script ?? null) as Record<string, unknown> | null
  const scriptBody = scriptRaw ? str(scriptRaw.body) : undefined

  return {
    project: {
      formatVersion: PROJECT_FORMAT_VERSION,
      createdAt: str(o.createdAt) ?? new Date().toISOString(),
      title: str(o.title) ?? storyboard.title ?? 'Untitled',
      script: scriptBody ? { title: (scriptRaw && str(scriptRaw.title)) ?? 'Untitled', body: scriptBody } : undefined,
      storyboard,
      build,
      assets
    },
    warnings
  }
}

/**
 * What the studio reports back after taking in a phone plan. Lives here rather than
 * with the importer so the preload bridge and the UI can name it without dragging
 * main-process code into the renderer's build.
 */
export interface ImportedProject {
  title: string
  /** How many scenes arrived. */
  scenes: number
  /** Total run length in seconds. */
  seconds: number
  /** Scenes that asked for the user's own photo/clip but have no file yet. */
  needMedia: { index: number; kind: 'photo' | 'clip'; visual: string }[]
  /** Files written to disk from the plan. */
  writtenAssets: number
  /** Anything the validator dropped or repaired, in plain English. */
  warnings: string[]
  /** The script the phone wrote, if it sent one. */
  script?: { title: string; body: string }
  // ── what the Storyboard tab adopts directly, with asset refs already resolved
  //    to real paths on this PC ──
  storyboardBeats: StoryboardBeat[]
  style: VideoStyle
  /** Matches the Storyboard tab's own resolution keys, e.g. '1080p' or '9:16 (Shorts)'. */
  resKey: string
  fps: number
  /** First photo the phone attached, used as the tab's single "my photo". */
  photoPath: string | null
}

/** Beats that asked for the user's own photo/clip but have no file yet — the PC fills these. */
export function beatsNeedingMedia(doc: StoryboardDoc): { index: number; kind: 'photo' | 'clip'; visual: string }[] {
  const out: { index: number; kind: 'photo' | 'clip'; visual: string }[] = []
  doc.beats.forEach((b, index) => {
    if ((b.subject.kind === 'photo' || b.subject.kind === 'clip') && !b.subject.src) {
      out.push({ index, kind: b.subject.kind, visual: b.visual })
    }
  })
  return out
}

/** A safe, readable filename for the exported plan. */
export function projectFileName(title: string): string {
  const clean = (title || 'plan')
    .replace(/[^a-z0-9\-_ ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${clean || 'plan'}${PROJECT_FILE_EXT}`
}
