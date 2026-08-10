/**
 * The plan the user is building on the phone: the storyboard, the video settings and
 * any attachments — held in memory, saved to IndexedDB, and exported as the project
 * file the PC imports.
 *
 * Every planning function here comes from the studio's own tested core
 * (`src/shared/storyboard.ts`), not from a phone reimplementation. The phone decides
 * WHEN to call them and how to show the result; it never invents its own idea of what
 * a storyboard is. That is what keeps a phone-made plan renderable on the PC.
 */
// Only the PURE, non-secret parts of the studio are bundled here: validation, the
// duration maths, and the offline script splitter. The prompt builders and the style
// wording deliberately stay on the PC — see pc.ts.
import { sanitizeStoryboard, storyboardDuration, storyboardFromScript } from '../../src/shared/storyboard'
import {
  DEFAULT_BUILD,
  MAX_PROJECT_BYTES,
  PROJECT_FORMAT_VERSION,
  assetRef,
  assetRefId,
  base64Bytes,
  frameSize,
  isAssetRef,
  projectFileName,
  sanitizeProject,
  type PhoneBuildSettings,
  type PhoneProject,
  type ProjectAsset
} from '../../src/shared/project'
import type { StoryboardBeat, StoryboardDoc } from '../../src/shared/types'
import * as PC from './pc'
import { dbGet, dbSet } from './db'

const KEY = 'project'

export interface PhoneProjectState {
  title: string
  script?: { title: string; body: string }
  storyboard: StoryboardDoc | null
  build: PhoneBuildSettings
  assets: ProjectAsset[]
}

let state: PhoneProjectState = {
  title: '',
  storyboard: null,
  build: { ...DEFAULT_BUILD },
  assets: []
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export function getProject(): PhoneProjectState {
  return state
}

export function hasStoryboard(): boolean {
  return !!state.storyboard?.beats.length
}

/** Loads the saved plan on start-up. Never throws — a broken save must not block the app. */
export async function loadProject(): Promise<void> {
  const saved = await dbGet<PhoneProjectState>(KEY)
  if (!saved) return
  try {
    state = {
      title: typeof saved.title === 'string' ? saved.title : '',
      script: saved.script,
      storyboard: saved.storyboard ?? null,
      build: { ...DEFAULT_BUILD, ...(saved.build ?? {}) },
      assets: Array.isArray(saved.assets) ? saved.assets : []
    }
  } catch {
    /* keep the empty default */
  }
}

/**
 * Writes the plan out NOW. Every discrete action — adding, deleting, reordering,
 * attaching a photo, finishing a recording, changing a setting — uses this.
 *
 * It deliberately does NOT debounce. A debounce restarts on each call, so a burst of
 * quick actions followed by the user swiping the app away can flush nothing at all
 * and lose the lot. That is a real way to lose work on a phone, and it is not worth
 * saving a few database writes for.
 */
export function saveProject(): void {
  clearTimeout(saveTimer)
  saveTimer = undefined
  void dbSet(KEY, state)
}

/** Debounced — for typing only, so a keystroke doesn't hit the database each time. */
export function saveSoon(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void dbSet(KEY, state), 400)
}

/** Flushes anything the typing debounce still owes, e.g. when the page is hidden. */
export async function flushProject(): Promise<void> {
  clearTimeout(saveTimer)
  saveTimer = undefined
  await dbSet(KEY, state)
}

export function setBuild(patch: Partial<PhoneBuildSettings>): void {
  state.build = { ...state.build, ...patch }
  if (state.storyboard) {
    state.storyboard.style = state.build.style
    const { width, height } = frameSize(state.build.resolution, state.build.aspect)
    state.storyboard.width = width
    state.storyboard.height = height
  }
  saveProject()
}

export function setTitle(title: string): void {
  state.title = title
  if (state.storyboard) state.storyboard.title = title
  saveProject()
}

export function setScript(script: { title: string; body: string }): void {
  state.script = script
  if (!state.title) state.title = script.title
  saveProject()
}

function adopt(raw: unknown, fallbackTitle: string): void {
  const { width, height } = frameSize(state.build.resolution, state.build.aspect)
  const doc = sanitizeStoryboard(raw, { width, height, fps: 30 })
  doc.style = state.build.style
  if (!doc.title || doc.title === 'Untitled') doc.title = fallbackTitle || 'Untitled'
  state.storyboard = doc
  state.title = doc.title
  saveProject()
}

/**
 * Builds a storyboard from a script with NO AI and NO internet — the studio's own
 * `storyboardFromScript`. This is the offline route: useful on a plane, on bad
 * signal, or when the free AI service is having a bad day.
 */
export function planFromScriptOffline(input: { title: string; body: string; totalSeconds?: number; language?: string }): void {
  adopt(
    storyboardFromScript({
      title: input.title,
      brief: input.body,
      totalSeconds: input.totalSeconds,
      language: input.language
    }),
    input.title
  )
}

/**
 * Asks the PC to direct the whole thing. The prompt wording lives there; the phone
 * sends only the title, the script and the desired length. The PC returns an
 * already-validated storyboard, which is re-validated here anyway — a reply from the
 * network is never trusted just because it came from your own machine.
 */
export async function planWithAi(input: {
  title: string
  brief: string
  mode: 'auto' | 'guided'
  totalSeconds?: number
  language?: string
}): Promise<void> {
  const { width, height } = frameSize(state.build.resolution, state.build.aspect)
  adopt(await PC.directStoryboard({ ...input, width, height }), input.title)
}

export function emptyStoryboard(title: string): void {
  adopt({ title, beats: [{ durationSec: 8, visual: 'A cinematic establishing shot', motion: 'in' }] }, title)
}

// ─────────────────────────────── beats ───────────────────────────────

export function beats(): StoryboardBeat[] {
  return state.storyboard?.beats ?? []
}

export function totalSeconds(): number {
  return state.storyboard ? storyboardDuration(state.storyboard) : 0
}

/**
 * @param typing true when this came from a text field, so the write is debounced.
 *               Everything else (a dropdown, a number, a toggle) saves immediately.
 */
export function updateBeat(index: number, patch: Partial<StoryboardBeat>, typing = false): void {
  const list = beats()
  if (!list[index]) return
  list[index] = { ...list[index], ...patch }
  if (typing) saveSoon()
  else saveProject()
}

export function addBeat(afterIndex?: number): number {
  if (!state.storyboard) return -1
  const beat: StoryboardBeat = {
    id: `beat-${Date.now().toString(36)}`,
    durationSec: 8,
    visual: '',
    subject: { kind: 'none' },
    transitionSec: 0.8,
    motion: 'in',
    sounds: []
  }
  const at = afterIndex === undefined ? state.storyboard.beats.length : afterIndex + 1
  state.storyboard.beats.splice(at, 0, beat)
  saveProject()
  return at
}

export function duplicateBeat(index: number): void {
  const list = beats()
  if (!list[index]) return
  const copy: StoryboardBeat = JSON.parse(JSON.stringify(list[index]))
  copy.id = `beat-${Date.now().toString(36)}`
  list.splice(index + 1, 0, copy)
  saveProject()
}

/** Removes the beat AND any attachments only it was using, so the plan doesn't bloat. */
export function removeBeat(index: number): void {
  const list = beats()
  if (!list[index]) return
  list.splice(index, 1)
  pruneAssets()
  saveProject()
}

export function moveBeat(index: number, delta: number): void {
  const list = beats()
  const to = index + delta
  if (!list[index] || to < 0 || to >= list.length) return
  const [b] = list.splice(index, 1)
  list.splice(to, 0, b)
  saveProject()
}

// ────────────────────────────── attachments ──────────────────────────────

export function addAsset(a: ProjectAsset): void {
  state.assets.push(a)
  saveProject()
}

export function getAsset(id: string): ProjectAsset | undefined {
  return state.assets.find((a) => a.id === id)
}

export function assetForRef(src: string | undefined): ProjectAsset | undefined {
  return isAssetRef(src) ? getAsset(assetRefId(src)) : undefined
}

export function attachToBeat(index: number, asset: ProjectAsset): void {
  const beat = beats()[index]
  if (!beat) return
  addAsset(asset)
  if (asset.kind === 'audio') {
    beat.sounds = [
      ...(beat.sounds ?? []).filter((s) => s.kind !== 'file'),
      { id: `snd-${asset.id}`, kind: 'file', src: assetRef(asset.id), gain: 1 }
    ]
  } else {
    beat.subject = { ...beat.subject, kind: asset.kind === 'photo' ? 'photo' : 'clip', src: assetRef(asset.id) }
  }
  pruneAssets()
  saveProject()
}

export function detachFromBeat(index: number, what: 'media' | 'audio'): void {
  const beat = beats()[index]
  if (!beat) return
  if (what === 'audio') beat.sounds = (beat.sounds ?? []).filter((s) => s.kind !== 'file')
  else beat.subject = { ...beat.subject, src: undefined }
  pruneAssets()
  saveProject()
}

/** Drops attachments nothing references any more. Called after every removal. */
function pruneAssets(): void {
  const used = new Set<string>()
  for (const b of beats()) {
    if (isAssetRef(b.subject.src)) used.add(assetRefId(b.subject.src))
    for (const s of b.sounds ?? []) if (isAssetRef(s.src)) used.add(assetRefId(s.src))
  }
  state.assets = state.assets.filter((a) => used.has(a.id))
}

export function projectBytes(): number {
  return state.assets.reduce((n, a) => n + base64Bytes(a.data), 0)
}

export function overSizeLimit(): boolean {
  return projectBytes() > MAX_PROJECT_BYTES
}

// ─────────────────────────────── previews ───────────────────────────────

/**
 * The preview URL for a beat, built BY THE PC so the style wording never ships in
 * this app. The PC uses the same prompt and the same seed (`index + 1`) its renderer
 * will use, so the preview really is the picture you will get — not an approximation.
 *
 * Needs the PC to be reachable; the caller reports that plainly rather than showing
 * a broken image.
 */
export async function beatPreviewUrl(index: number, opts?: { width?: number }): Promise<string> {
  const beat = beats()[index]
  const doc = state.storyboard
  if (!beat || !doc) return ''
  const width = opts?.width ?? 512
  const height = Math.round(width * (doc.height / doc.width))
  const { url } = await PC.sceneImage({
    style: doc.style,
    visual: beat.visual,
    title: doc.title,
    width,
    height,
    seed: index + 1
  })
  return url
}

// ─────────────────────────── export / hand-off ───────────────────────────

export function toProjectFile(): PhoneProject {
  const { width, height } = frameSize(state.build.resolution, state.build.aspect)
  const doc: StoryboardDoc = state.storyboard ?? {
    title: state.title || 'Untitled',
    style: state.build.style,
    width,
    height,
    fps: 30,
    beats: []
  }
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    title: state.title || doc.title || 'Untitled',
    script: state.script,
    storyboard: doc,
    build: state.build,
    assets: state.assets
  }
}

export function projectJson(): string {
  return JSON.stringify(toProjectFile())
}

export function fileName(): string {
  return projectFileName(state.title || 'plan')
}

/**
 * Round-trips the plan through the same validator the PC will use, so the phone can
 * warn the user BEFORE they send something the studio would reject or trim.
 */
export function selfCheck(): string[] {
  try {
    return sanitizeProject(JSON.parse(projectJson())).warnings
  } catch (err) {
    return [err instanceof Error ? err.message : 'This plan could not be checked.']
  }
}

/** Replaces the whole plan (used by "open a plan file" on the phone). */
export function loadFromFile(raw: unknown): string[] {
  const { project, warnings } = sanitizeProject(raw)
  state = {
    title: project.title,
    script: project.script,
    storyboard: project.storyboard,
    build: project.build,
    assets: project.assets
  }
  saveProject()
  return warnings
}

export function clearProject(): void {
  state = { title: '', storyboard: null, build: { ...DEFAULT_BUILD }, assets: [] }
  saveProject()
}
