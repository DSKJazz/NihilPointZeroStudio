/**
 * FREE image-to-image via AI Horde (aihorde.net) — the only free route that accepts
 * YOUR uploaded photo directly (as base64, no public hosting) and generates a new
 * scene from it ("me as an astronaut", "me in a suit on a stage"). It's a crowdsourced
 * queue: with the anonymous key it can take several minutes; a FREE registered key
 * (Settings) gets priority. We stream queue position so it never looks frozen.
 *
 * Honest limit: img2img keeps your photo's composition/colours and follows the prompt,
 * but exact face likeness isn't guaranteed on free models — lower "photo strength" to
 * keep more of you, raise it to transform more.
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runFfmpeg } from '../video/ffmpeg'
import { thumbnailsDir } from '../store'

const API = 'https://aihorde.net/api/v2'
// Baked-in registered AI Horde key so photo scenes get priority on EVERY copy of the
// studio with zero setup. A user-supplied key in Settings overrides this. To revoke,
// regenerate the key at aihorde.net (this one becomes inert).
const DEFAULT_KEY = 'MT3afd5XmUg1PGAMoiUxdQ'
const CLIENT_AGENT = 'nihilpointzero-studio:1.0'

export interface HordeProgress {
  message: string
  queuePosition?: number
  waitSeconds?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Generates an image FROM a source photo using img2img. Returns a .jpg path the video
 * engine can use directly. `strength` (0..1) is how much to transform the photo
 * (0.35 = keep more of you, 0.7 = transform more); default 0.5.
 */
export async function generateFromPhoto(opts: {
  prompt: string
  sourceImagePath: string
  apikey?: string
  strength?: number
  onProgress?: (p: HordeProgress) => void
  maxWaitMs?: number
}): Promise<string> {
  const { prompt, sourceImagePath, onProgress } = opts
  const apikey = opts.apikey?.trim() || DEFAULT_KEY
  const denoise = Math.min(0.95, Math.max(0.2, opts.strength ?? 0.5))
  const maxWaitMs = opts.maxWaitMs ?? 12 * 60 * 1000

  // A moved/renamed/deleted photo must say so plainly — not surface a raw system error.
  if (!existsSync(sourceImagePath)) {
    throw new Error('The attached photo can’t be found anymore (was it moved, renamed or deleted?). Click "Change photo" and attach it again.')
  }
  // Phone photos are often 6–12MB; base64 of that blows past the free service's request
  // limit. Downscale to ~1280px first (the model works at 512 anyway) — best-effort:
  // if ffmpeg can't read it, fall back to the original bytes.
  let uploadPath = sourceImagePath
  let scaled: string | null = null
  try {
    if (statSync(sourceImagePath).size > 1_500_000) {
      onProgress?.({ message: 'Shrinking your photo for upload…' })
      scaled = join(thumbnailsDir(), `photo-upload-${Date.now().toString(36)}.jpg`)
      await runFfmpeg(['-y', '-i', sourceImagePath, '-vf', "scale='min(1280,iw)':-2", '-frames:v', '1', '-q:v', '3', scaled])
      if (existsSync(scaled) && statSync(scaled).size > 0) uploadPath = scaled
    }
  } catch {
    uploadPath = sourceImagePath // odd format ffmpeg couldn't read — try the original as-is
  }
  const b64 = readFileSync(uploadPath).toString('base64')
  if (scaled && uploadPath === scaled) {
    // The temp upload copy is no longer needed once encoded.
    try {
      rmSync(scaled, { force: true })
    } catch {
      /* best-effort */
    }
  }
  onProgress?.({ message: 'Submitting your photo to the free image queue…' })

  const submit = await fetch(`${API}/generate/async`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000), // submit carries the photo payload — bounded, not infinite
    headers: { 'Content-Type': 'application/json', apikey, 'Client-Agent': CLIENT_AGENT },
    body: JSON.stringify({
      prompt: `${prompt}. high detail, no text, no watermark`,
      params: { sampler_name: 'k_euler_a', steps: 18, width: 512, height: 512, denoising_strength: denoise, n: 1 },
      source_image: b64,
      source_processing: 'img2img',
      models: ['stable_diffusion'],
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      trusted_workers: false
    })
  })
  if (!submit.ok) {
    const t = await submit.text().catch(() => '')
    throw new Error(
      submit.status === 429
        ? 'The free image queue is rate-limiting anonymous use. Add a free AI Horde key in Settings for priority.'
        : `Photo image service rejected the request (${submit.status}). ${t.slice(0, 160)}`
    )
  }
  const { id } = (await submit.json()) as { id: string }
  if (!id) throw new Error('Photo image service did not return a job id.')

  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    await sleep(6000)
    const chkRes = await fetch(`${API}/generate/check/${id}`, {
      headers: { 'Client-Agent': CLIENT_AGENT },
      signal: AbortSignal.timeout(20_000) // one stuck poll must not stall the whole queue wait
    })
    if (!chkRes.ok) continue
    const st = (await chkRes.json()) as {
      done: boolean
      faulted?: boolean
      processing?: number
      queue_position?: number
      wait_time?: number
    }
    if (st.faulted) throw new Error('The image worker faulted. Try again (or add a free AI Horde key for reliability).')
    onProgress?.({
      message: st.processing ? 'Generating your scene…' : `In the free queue (position ${st.queue_position ?? '?'})…`,
      queuePosition: st.queue_position,
      waitSeconds: st.wait_time
    })
    if (st.done) {
      const res = await fetch(`${API}/generate/status/${id}`, {
        headers: { 'Client-Agent': CLIENT_AGENT },
        signal: AbortSignal.timeout(30_000)
      })
      const data = (await res.json()) as { generations?: { img?: string }[] }
      const img = data.generations?.[0]?.img
      if (!img) throw new Error('No image came back from the queue. Try again.')
      const raw = join(thumbnailsDir(), `photo-src-${id.slice(0, 8)}`)
      if (img.startsWith('http')) {
        const dl = await fetch(img, { signal: AbortSignal.timeout(180_000) })
        writeFileSync(raw, Buffer.from(await dl.arrayBuffer()))
      } else {
        writeFileSync(raw, Buffer.from(img, 'base64'))
      }
      // Convert whatever came back (webp/png) to a jpg the slideshow reliably reads.
      const out = join(thumbnailsDir(), `photo-scene-${id.slice(0, 8)}.jpg`)
      await runFfmpeg(['-y', '-i', raw, '-frames:v', '1', out])
      onProgress?.({ message: 'Done.' })
      return out
    }
  }
  throw new Error('Still queued after several minutes — the free queue is busy. Add a free AI Horde key in Settings for priority, or try again.')
}
