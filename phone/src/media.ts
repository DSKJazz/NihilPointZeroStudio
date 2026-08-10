/**
 * Turning things on the phone — gallery photos, video clips, the microphone — into
 * attachments a plan can carry to the PC.
 *
 * The governing constraint is TRANSFER, not storage: a plan gets sent over mobile
 * data and lands in WhatsApp or Drive. A modern phone photo is 4-8 MB, and ten of
 * them would make a plan that cannot realistically be sent. So photos are downscaled
 * and re-encoded before they are embedded. Video clips are not re-encoded (a phone
 * browser cannot do that quickly) — the user is told their size instead.
 */
import { MAX_ASSET_BYTES, base64Bytes, type ProjectAsset, type ProjectAssetKind } from '../../src/shared/project'
import { AUDIO_MIME_PREFERENCE, audioBitrate, pickMime } from '../../src/shared/recordingQuality'

/** Plenty for compositing a face into a 1080p/4K scene; a fraction of the original bytes. */
const MAX_PHOTO_EDGE = 1600
const PHOTO_QUALITY = 0.82

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Strips the `data:<mime>;base64,` prefix a FileReader/canvas produces. */
function stripDataUrl(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;,]+)(?:;[^,]*)*,(.*)$/s.exec(dataUrl)
  if (!m) return { mime: 'application/octet-stream', data: '' }
  return { mime: m[1], data: m[2] }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read that file from your phone.'))
    r.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file did not open as a picture.'))
    img.src = url
  })
}

/**
 * Downscales a gallery photo and re-encodes it as JPEG. Returns the embeddable asset.
 * Falls back to the original bytes if the canvas route fails for any reason.
 */
export async function photoAsset(file: File): Promise<ProjectAsset> {
  const original = await readAsDataUrl(file)
  try {
    const img = await loadImage(original)
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(img, 0, 0, w, h)
    const out = stripDataUrl(canvas.toDataURL('image/jpeg', PHOTO_QUALITY))
    if (out.data) {
      return { id: newId(), kind: 'photo', name: file.name, mime: 'image/jpeg', data: out.data }
    }
  } catch {
    // Fall through to the untouched original — better a big photo than none.
  }
  const raw = stripDataUrl(original)
  return { id: newId(), kind: 'photo', name: file.name, mime: raw.mime, data: raw.data }
}

/** Wraps a video clip as-is. Phone browsers cannot transcode, so size is reported honestly. */
export async function clipAsset(file: File): Promise<ProjectAsset> {
  const raw = stripDataUrl(await readAsDataUrl(file))
  return { id: newId(), kind: 'clip', name: file.name, mime: raw.mime, data: raw.data }
}

export async function audioAsset(blob: Blob, name: string): Promise<ProjectAsset> {
  const raw = stripDataUrl(await readAsDataUrl(blob))
  return { id: newId(), kind: 'audio', name, mime: blob.type || raw.mime, data: raw.data }
}

export function assetBytes(a: ProjectAsset): number {
  return base64Bytes(a.data)
}

export function tooBig(a: ProjectAsset): boolean {
  return assetBytes(a) > MAX_ASSET_BYTES
}

export function humanBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/** A playable URL for an embedded attachment, for preview inside the app. */
export function assetObjectUrl(a: ProjectAsset): string {
  return `data:${a.mime};base64,${a.data}`
}

export function kindForFile(file: File): ProjectAssetKind | null {
  if (file.type.startsWith('image/')) return 'photo'
  if (file.type.startsWith('video/')) return 'clip'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

// ────────────────────────────── microphone ──────────────────────────────

/**
 * The same container ranking and the same bitrate the desktop Recorder uses, so a
 * scene narrated on the phone sounds identical to one narrated at the laptop. Only
 * the mic differs.
 */
function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return pickMime(AUDIO_MIME_PREFERENCE, (t) => MediaRecorder.isTypeSupported?.(t) ?? false)
}

export interface Recording {
  stop: () => Promise<Blob>
  cancel: () => void
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/**
 * Starts recording from the phone's microphone. Resolves once recording is actually
 * running, so the UI never shows "recording" before it is true.
 */
export async function startRecording(): Promise<Recording> {
  if (!canRecord()) throw new Error('This phone/browser will not allow recording here.')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The same cleanup the laptop applies, done by the phone's own audio hardware.
      audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
    })
  } catch {
    throw new Error('Microphone permission was refused. Allow it in your browser settings and try again.')
  }
  const mime = pickAudioMime()
  // Explicit bitrate for the same reason as on the laptop: left to itself the browser
  // picks a low default, and narration is the one thing in a video nobody forgives.
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    audioBitsPerSecond: audioBitrate('youtube')
  })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const cleanup = (): void => stream.getTracks().forEach((t) => t.stop())
  rec.start()

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          cleanup()
          resolve(new Blob(chunks, { type: mime || 'audio/webm' }))
        }
        // Calling stop() on an already-inactive recorder throws; guard it.
        if (rec.state !== 'inactive') rec.stop()
        else {
          cleanup()
          resolve(new Blob(chunks, { type: mime || 'audio/webm' }))
        }
      }),
    cancel: () => {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } finally {
        cleanup()
      }
    }
  }
}
