/**
 * The Scenes studio — the reason this app exists.
 *
 * Plain DOM rather than a framework: the whole bundle stays tiny, which matters on a
 * phone opening the app on mobile data. Two views:
 *   • the scene LIST — a card per shot, reorderable, with a real preview picture;
 *   • the beat EDITOR — a full-screen panel with every field of a StoryboardBeat.
 *
 * Preview images are generated on demand, never automatically for the whole list: each
 * one is a real request to the free image service that takes seconds, and silently
 * firing twenty of them would burn the user's data and make the app feel broken.
 */
import { MOODS, SFX_KINDS, VIDEO_STYLES, VIDEO_TEMPLATES, VIDEO_ASPECTS } from '../../src/shared/types'
import { listStyles, pcConfigured, type PcStyle } from './pc'
import type { BeatSound, Mood, SfxKind, ShotMotion, ShotSubjectKind, StoryboardBeat } from '../../src/shared/types'
import { beatsNeedingMedia } from '../../src/shared/project'
import * as P from './project'
import { assetObjectUrl, canRecord, clipAsset, humanBytes, photoAsset, startRecording, type Recording } from './media'
import { listSaved } from './store'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.round(total % 60)
  return m ? `${m}m ${s}s` : `${s}s`
}

let toastFn: (msg: string) => void = () => undefined
export function setToast(fn: (msg: string) => void): void {
  toastFn = fn
}

/** Preview URLs already fetched, so re-rendering the list doesn't re-request them. */
const previewCache = new Map<number, string>()

/**
 * Human-readable style names, fetched from the PC. Only the LABELS travel — the style
 * wording that shapes an image is prompt text and stays on the PC. Until the PC has
 * been reached, the tidied id is shown, so the picker is never empty or broken.
 */
let styleLabels: Record<string, string> = {}

function styleLabel(id: string): string {
  return styleLabels[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function loadStyleLabels(): Promise<void> {
  if (!pcConfigured()) return
  try {
    const styles: PcStyle[] = await listStyles()
    styleLabels = Object.fromEntries(styles.map((s) => [s.id, s.label]))
  } catch {
    // Offline is fine — the tidied ids are perfectly usable names.
  }
}

const MOTIONS: ShotMotion[] = ['still', 'in', 'out', 'left', 'right', 'up', 'down']
const SUBJECT_KINDS: { id: ShotSubjectKind; label: string }[] = [
  { id: 'none', label: 'Scene only (no person)' },
  { id: 'photo', label: 'My photo in this scene' },
  { id: 'clip', label: 'My video clip' },
  { id: 'ai-person', label: 'A made-up character' }
]

// ─────────────────────────────── start view ───────────────────────────────

export function renderStart(): void {
  const scripts = listSaved().filter((i) => i.kind === 'script')
  const sel = $<HTMLSelectElement>('sc-source')
  const current = sel.value
  sel.innerHTML =
    `<option value="">— type the idea myself below —</option>` +
    scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')
  if (current) sel.value = current
}

function chosenScript(): { title: string; body: string } | null {
  const id = $<HTMLSelectElement>('sc-source').value
  if (!id) return null
  const item = listSaved().find((i) => i.id === id)
  return item ? { title: item.title, body: item.body } : null
}

function startInputs(): { title: string; brief: string; totalSeconds?: number } {
  const script = chosenScript()
  const typed = $<HTMLInputElement>('sc-title').value.trim()
  const mins = Number($<HTMLInputElement>('sc-mins').value)
  return {
    title: typed || script?.title || 'Untitled',
    brief: script?.body || typed,
    totalSeconds: mins > 0 ? Math.round(mins * 60) : undefined
  }
}

export async function planWithAi(): Promise<void> {
  const { title, brief, totalSeconds } = startInputs()
  if (!brief) {
    $('sc-start-out').innerHTML = '<div class="err">Pick a script, or type a title to work from.</div>'
    return
  }
  const btn = $<HTMLButtonElement>('sc-ai')
  btn.disabled = true
  btn.textContent = 'Directing…'
  $('sc-start-out').innerHTML = '<div class="muted">Planning your scenes — this takes 20-60 seconds.</div>'
  try {
    const script = chosenScript()
    if (script) P.setScript(script)
    await P.planWithAi({ title, brief, mode: 'auto', totalSeconds })
    $('sc-start-out').innerHTML = ''
    renderScenes()
  } catch (err) {
    $('sc-start-out').innerHTML = `<div class="err">${esc(err instanceof Error ? err.message : String(err))}</div>`
  } finally {
    btn.disabled = false
    btn.textContent = 'Let the AI direct it'
  }
}

export function planOffline(): void {
  const { title, brief, totalSeconds } = startInputs()
  if (!brief) {
    $('sc-start-out').innerHTML = '<div class="err">Pick a script, or type a title to work from.</div>'
    return
  }
  const script = chosenScript()
  if (script) P.setScript(script)
  P.planFromScriptOffline({ title, body: brief, totalSeconds })
  $('sc-start-out').innerHTML = ''
  renderScenes()
}

export function planBlank(): void {
  const { title } = startInputs()
  P.emptyStoryboard(title)
  renderScenes()
}

// ─────────────────────────────── scene list ───────────────────────────────

export function renderScenes(): void {
  const have = P.hasStoryboard()
  $('sc-start').classList.toggle('hidden', have)
  $('sc-have').classList.toggle('hidden', !have)
  if (!have) {
    renderStart()
    return
  }

  const list = P.beats()
  const needing = P.getProject().storyboard ? beatsNeedingMedia(P.getProject().storyboard!) : []
  const bytes = P.projectBytes()
  $('sc-summary').innerHTML =
    `<h3>${esc(P.getProject().title || 'Untitled')}</h3>` +
    `<div class="muted">${list.length} scene${list.length === 1 ? '' : 's'} · ${mmss(P.totalSeconds())} · ` +
    `${esc(styleLabel(P.getProject().build.style))}${bytes ? ` · ${humanBytes(bytes)} attached` : ''}</div>` +
    (needing.length
      ? `<div class="muted" style="margin-top:6px;color:#ffcf7a">${needing.length} scene${needing.length === 1 ? '' : 's'} waiting for a photo or clip on your PC.</div>`
      : '') +
    (P.overSizeLimit()
      ? `<div class="err">This plan is too big to send. Remove an attachment or two.</div>`
      : '')

  $('sc-list').innerHTML = list.map((b, i) => sceneCard(b, i)).join('')
}

function sceneCard(b: StoryboardBeat, i: number): string {
  const cached = previewCache.get(i)
  const thumb = cached
    ? `<div class="thumb" style="background-image:url('${esc(cached)}')"></div>`
    : `<div class="thumb" data-preview="${i}">Tap to see this scene</div>`

  const tags: string[] = [`<span class="tag">${b.durationSec}s</span>`]
  if (b.motion && b.motion !== 'still') tags.push(`<span class="tag">${esc(b.motion)}</span>`)
  if (b.mood) tags.push(`<span class="tag">${esc(b.mood)}</span>`)
  if (b.caption) tags.push(`<span class="tag">caption</span>`)
  if (b.subject.kind === 'photo' || b.subject.kind === 'clip') {
    tags.push(
      b.subject.src
        ? `<span class="tag ok">${b.subject.kind} attached</span>`
        : `<span class="tag warn">${b.subject.kind} on PC</span>`
    )
  }
  if (b.subject.kind === 'ai-person') tags.push(`<span class="tag">character</span>`)
  if ((b.sounds ?? []).some((s) => s.kind === 'file')) tags.push(`<span class="tag ok">my voice</span>`)
  for (const s of b.sounds ?? []) if (s.kind !== 'file') tags.push(`<span class="tag">${esc(s.ref ?? s.kind)}</span>`)

  return `<div class="scene">
    <div class="top">
      ${thumb}
      <div class="meta">
        <div class="n">SCENE ${i + 1}</div>
        <div class="vis">${esc(b.visual || '(nothing yet — tap Edit)')}</div>
        ${b.narration ? `<div class="narr">“${esc(b.narration)}”</div>` : ''}
        <div>${tags.join('')}</div>
      </div>
    </div>
    <div class="acts">
      <button class="mini" data-sc-edit="${i}">Edit</button>
      <button class="mini" data-sc-up="${i}">↑</button>
      <button class="mini" data-sc-down="${i}">↓</button>
      <button class="mini" data-sc-dup="${i}">Copy</button>
      <button class="mini danger" data-sc-del="${i}">Delete</button>
    </div>
  </div>`
}

/**
 * Loads one preview picture on demand and keeps it for the session.
 *
 * The PC builds the image link (the style wording lives there), so this needs the PC
 * to be reachable. When it isn't, the card says so plainly rather than showing a
 * broken image — everything else about the scene still works offline.
 */
export async function loadPreview(index: number): Promise<void> {
  const el = document.querySelector<HTMLElement>(`.thumb[data-preview="${index}"]`)
  if (!el) return
  const beat = P.beats()[index]
  if (!beat?.visual.trim()) {
    toastFn('Describe what this scene shows first')
    return
  }
  el.textContent = 'Drawing…'
  try {
    const url = await P.beatPreviewUrl(index)
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image failed'))
      img.src = url
    })
    previewCache.set(index, url)
    el.textContent = ''
    el.style.backgroundImage = `url('${url}')`
    el.removeAttribute('data-preview')
  } catch (err) {
    el.textContent = err instanceof Error && /PC/i.test(err.message) ? 'Needs your PC' : 'Tap to try again'
    toastFn(err instanceof Error ? err.message : 'Could not draw that scene')
  }
}

// ────────────────────────────── beat editor ──────────────────────────────

let editing = -1
let recording: Recording | null = null

export function openEditor(index: number): void {
  editing = index
  $('editor').classList.remove('hidden')
  $('ed-title').textContent = `Scene ${index + 1} of ${P.beats().length}`
  renderEditor()
}

export function closeEditor(): void {
  if (recording) {
    recording.cancel()
    recording = null
  }
  editing = -1
  $('editor').classList.add('hidden')
  renderScenes()
}

function opts(values: readonly string[], selected: string | undefined, labels?: Record<string, string>): string {
  return values
    .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(labels?.[v] ?? v)}</option>`)
    .join('')
}

function renderEditor(): void {
  const b = P.beats()[editing]
  if (!b) return closeEditor()

  const media = P.assetForRef(b.subject.src)
  const voice = (b.sounds ?? []).find((s) => s.kind === 'file')
  const voiceAsset = P.assetForRef(voice?.src)
  const musicSounds = (b.sounds ?? []).filter((s) => s.kind === 'music')
  const sfxSounds = (b.sounds ?? []).filter((s) => s.kind === 'sfx')
  const cached = previewCache.get(editing)

  $('ed-body').innerHTML = `
    ${cached ? `<img class="preview" src="${esc(cached)}" alt="" />` : ''}
    <button class="go alt" id="ed-preview">${cached ? 'Draw it again' : 'Show me this scene'}</button>

    <label>What the camera shows</label>
    <textarea id="ed-visual" rows="3" placeholder="e.g. Karachi skyline at dawn, haze over the port">${esc(b.visual)}</textarea>

    <label>What you say over it</label>
    <textarea id="ed-narration" rows="3" placeholder="Leave empty for a silent shot">${esc(b.narration ?? '')}</textarea>

    <label>Words on screen (optional, keep it short)</label>
    <input id="ed-caption" value="${esc(b.caption ?? '')}" placeholder="e.g. RECORD LOW" />

    <label>How long (seconds)</label>
    <input id="ed-duration" type="number" min="1" max="120" value="${b.durationSec}" />

    <label>Camera movement</label>
    <select id="ed-motion">${opts(MOTIONS, b.motion ?? 'in', {
      still: 'Still', in: 'Slow zoom in', out: 'Slow zoom out', left: 'Pan left', right: 'Pan right', up: 'Pan up', down: 'Pan down'
    })}</select>

    <label>Blend from the scene before (seconds, 0 = hard cut)</label>
    <input id="ed-transition" type="number" min="0" max="5" step="0.1" value="${b.transitionSec ?? 0}" />

    <label>Mood (optional)</label>
    <input id="ed-mood" value="${esc(b.mood ?? '')}" placeholder="e.g. tense" />

    <label>Who is on screen</label>
    <select id="ed-subject">${SUBJECT_KINDS.map(
      (k) => `<option value="${k.id}"${b.subject.kind === k.id ? ' selected' : ''}>${esc(k.label)}</option>`
    ).join('')}</select>

    ${
      b.subject.kind === 'ai-person'
        ? `<label>Describe the character</label><input id="ed-person" value="${esc(b.subject.description ?? '')}" placeholder="e.g. a young analyst at a desk" />`
        : ''
    }

    ${
      b.subject.kind === 'photo' || b.subject.kind === 'clip'
        ? `<div class="note">
            ${
              media
                ? `<div class="muted">Attached: ${esc(media.name ?? media.kind)} · ${humanBytes(
                    Math.round((media.data.length * 3) / 4)
                  )}</div>
                   ${media.kind === 'photo' ? `<img class="preview" style="margin-top:8px" src="${assetObjectUrl(media)}" alt="" />` : ''}
                   <div class="row"><button class="mini danger" id="ed-detach">Remove it</button></div>`
                : `<div class="muted">Nothing attached. Either pick it here, or leave it and your PC will ask you for it when you import the plan.</div>
                   <div class="row">
                     <button class="mini" id="ed-attach">Pick from my phone</button>
                     <button class="mini" id="ed-shoot">🎥 Film it now (back camera)</button>
                     <button class="mini" id="ed-selfie">🤳 Film me (front camera)</button>
                   </div>
                   <div class="muted" style="margin-top:6px">
                     Filming opens your phone's own camera app, so the clip is recorded at your phone's
                     full quality — the same file you would get from the camera itself.
                   </div>`
            }
          </div>`
        : ''
    }

    <label style="margin-top:18px">Your own voice for this scene</label>
    <div class="note">
      ${
        voiceAsset
          ? `<audio controls style="width:100%" src="${assetObjectUrl(voiceAsset)}"></audio>
             <div class="row"><button class="mini danger" id="ed-unrec">Delete recording</button></div>`
          : canRecord()
            ? `<div class="muted">Record narration right here — it travels with the plan.</div>
               <div class="row"><button class="mini" id="ed-rec">● Record</button></div>`
            : `<div class="muted">This browser will not let the app use your microphone.</div>`
      }
      <div id="ed-rec-out" class="muted"></div>
    </div>

    <label>Music under this scene</label>
    <select id="ed-music">${opts(['', ...MOODS], musicSounds[0]?.ref ?? '', { '': '— none —' })}</select>

    <label>Sound effect</label>
    <select id="ed-sfx">${opts(['', ...SFX_KINDS], sfxSounds[0]?.ref ?? '', { '': '— none —' })}</select>
  `

  wireEditor()
}

function setBeat(patch: Partial<StoryboardBeat>, typing = false): void {
  P.updateBeat(editing, patch, typing)
}

function wireEditor(): void {
  const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void): void => {
    const el = document.getElementById(id) as T | null
    el?.addEventListener(ev, () => fn(el))
  }

  on<HTMLTextAreaElement>('ed-visual', 'input', (el) => {
    setBeat({ visual: el.value }, true)
    // The picture is drawn from this text, so an edit invalidates it.
    previewCache.delete(editing)
  })
  on<HTMLTextAreaElement>('ed-narration', 'input', (el) => setBeat({ narration: el.value.trim() || undefined }, true))
  on<HTMLInputElement>('ed-caption', 'input', (el) => setBeat({ caption: el.value.trim() || undefined }, true))
  on<HTMLInputElement>('ed-duration', 'change', (el) => {
    const v = Math.min(Math.max(Number(el.value) || 1, 1), 120)
    el.value = String(v)
    setBeat({ durationSec: v })
  })
  on<HTMLInputElement>('ed-transition', 'change', (el) => {
    const v = Math.min(Math.max(Number(el.value) || 0, 0), 5)
    el.value = String(v)
    setBeat({ transitionSec: v })
  })
  on<HTMLSelectElement>('ed-motion', 'change', (el) => setBeat({ motion: el.value as ShotMotion }))
  on<HTMLInputElement>('ed-mood', 'input', (el) => setBeat({ mood: el.value.trim() || undefined }, true))

  on<HTMLSelectElement>('ed-subject', 'change', (el) => {
    const kind = el.value as ShotSubjectKind
    const beat = P.beats()[editing]
    // Changing away from photo/clip drops a now-meaningless attachment.
    if (kind !== 'photo' && kind !== 'clip' && beat.subject.src) P.detachFromBeat(editing, 'media')
    setBeat({ subject: { ...P.beats()[editing].subject, kind } })
    renderEditor()
  })
  on<HTMLInputElement>('ed-person', 'input', (el) =>
    setBeat({ subject: { ...P.beats()[editing].subject, description: el.value.trim() || undefined } }, true)
  )

  on('ed-preview', 'click', () => {
    void (async () => {
      const btn = $('ed-preview')
      const at = editing
      previewCache.delete(at)
      btn.textContent = 'Drawing…'
      try {
        const url = await P.beatPreviewUrl(at)
        await new Promise<void>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('image failed'))
          img.src = url
        })
        previewCache.set(at, url)
        // The editor may have been closed or moved on while the picture loaded.
        if (editing === at) renderEditor()
      } catch (err) {
        btn.textContent = err instanceof Error ? err.message.slice(0, 60) : 'Could not draw it — try again'
      }
    })()
  })

  on('ed-attach', 'click', () => pickMediaFor(editing))
  on('ed-shoot', 'click', () => shootFor(editing, 'back'))
  on('ed-selfie', 'click', () => shootFor(editing, 'front'))
  on('ed-detach', 'click', () => {
    P.detachFromBeat(editing, 'media')
    renderEditor()
  })
  on('ed-unrec', 'click', () => {
    P.detachFromBeat(editing, 'audio')
    renderEditor()
  })
  on('ed-rec', 'click', () => void toggleRecord())

  on<HTMLSelectElement>('ed-music', 'change', (el) => setSound('music', el.value))
  on<HTMLSelectElement>('ed-sfx', 'change', (el) => setSound('sfx', el.value))
}

/** Replaces the single music/sfx entry for this beat (or removes it when blank). */
function setSound(kind: 'music' | 'sfx', ref: string): void {
  const beat = P.beats()[editing]
  const kept = (beat.sounds ?? []).filter((s) => s.kind !== kind)
  const next: BeatSound[] = ref
    ? [...kept, { id: `${kind}-${Date.now().toString(36)}`, kind, ref: ref as Mood | SfxKind, gain: kind === 'music' ? 0.35 : 1 }]
    : kept
  setBeat({ sounds: next })
}

async function toggleRecord(): Promise<void> {
  const btn = $('ed-rec')
  const out = $('ed-rec-out')
  if (recording) {
    const blob = await recording.stop()
    recording = null
    btn.textContent = '● Record'
    btn.classList.remove('rec')
    if (!blob.size) {
      out.textContent = 'Nothing was recorded.'
      return
    }
    const { audioAsset } = await import('./media')
    P.attachToBeat(editing, await audioAsset(blob, `scene-${editing + 1}`))
    renderEditor()
    return
  }
  try {
    recording = await startRecording()
    btn.textContent = '■ Stop'
    btn.classList.add('rec')
    out.textContent = 'Recording… speak now.'
  } catch (err) {
    out.innerHTML = `<span class="err">${esc(err instanceof Error ? err.message : String(err))}</span>`
  }
}

// ───────────────────────────── media picking ─────────────────────────────

let pickTarget = -1

export function pickMediaFor(index: number): void {
  pickTarget = index
  $<HTMLInputElement>('pick-media').click()
}

/**
 * Films a clip with the phone's OWN camera app rather than in the page.
 *
 * This is the route that actually looks professional. A browser recording is limited
 * to what getUserMedia hands over — no stabilisation, no proper autofocus, software
 * encoding, and whatever bitrate the browser feels like. The camera app uses the full
 * sensor pipeline and hardware encoder, which on a modern phone is genuinely hard to
 * tell from a camera. The clip comes back through the same attachment path as a file
 * picked from the gallery.
 */
export function shootFor(index: number, camera: 'front' | 'back'): void {
  pickTarget = index
  $<HTMLInputElement>(camera === 'front' ? 'shoot-selfie' : 'shoot-media').click()
}

export async function onMediaPicked(file: File): Promise<void> {
  if (pickTarget < 0) return
  const index = pickTarget
  pickTarget = -1
  try {
    const asset = file.type.startsWith('video/') ? await clipAsset(file) : await photoAsset(file)
    P.attachToBeat(index, asset)
    toastFn(`Attached ${humanBytes(Math.round((asset.data.length * 3) / 4))}`)
    if (editing === index) renderEditor()
    else renderScenes()
  } catch (err) {
    toastFn(err instanceof Error ? err.message : 'Could not attach that file')
  }
}

// ──────────────────────────── video settings ────────────────────────────

export function renderVideoSettings(): void {
  const b = P.getProject().build
  const styleSel = $<HTMLSelectElement>('v-style')
  styleSel.innerHTML = VIDEO_STYLES.map(
    (s) => `<option value="${esc(s)}"${s === b.style ? ' selected' : ''}>${esc(styleLabel(s))}</option>`
  ).join('')
  $<HTMLSelectElement>('v-template').innerHTML = opts(VIDEO_TEMPLATES, b.template, {
    clean: 'Clean — no extra grading', news: 'News desk', cinematic: 'Cinematic', bold: 'Bold'
  })
  $<HTMLSelectElement>('v-aspect').innerHTML = opts(VIDEO_ASPECTS, b.aspect, {
    '16:9': 'Wide 16:9 — YouTube', '9:16': 'Tall 9:16 — Shorts/Reels', '1:1': 'Square 1:1'
  })
  $<HTMLSelectElement>('v-resolution').innerHTML = opts(['1080p', '1440p', '4k', '8k'], b.resolution)
  $<HTMLSelectElement>('v-voice').value = b.narrationVoice
  $<HTMLInputElement>('v-captions').checked = b.captionsAndChapters
  $<HTMLInputElement>('v-overlays').checked = b.textOverlays
  $<HTMLInputElement>('v-sfx').checked = b.soundEffects
}

export function wireVideoSettings(): void {
  const bind = (id: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void): void =>
    $(id).addEventListener('change', (e) => {
      fn(e.target as HTMLInputElement & HTMLSelectElement)
      // A style change makes every cached preview wrong.
      previewCache.clear()
      $('v-out').innerHTML = '<div class="muted">Saved.</div>'
    })

  bind('v-style', (el) => P.setBuild({ style: el.value as never }))
  bind('v-template', (el) => P.setBuild({ template: el.value as never }))
  bind('v-aspect', (el) => P.setBuild({ aspect: el.value as never }))
  bind('v-resolution', (el) => P.setBuild({ resolution: el.value as never }))
  bind('v-voice', (el) => P.setBuild({ narrationVoice: el.value as never }))
  bind('v-captions', (el) => P.setBuild({ captionsAndChapters: el.checked }))
  bind('v-overlays', (el) => P.setBuild({ textOverlays: el.checked }))
  bind('v-sfx', (el) => P.setBuild({ soundEffects: el.checked }))
}

export function clearPreviewCache(): void {
  previewCache.clear()
}
