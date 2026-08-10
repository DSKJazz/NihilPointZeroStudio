/**
 * FREE, keyless AI image generation via Pollinations' hosted image endpoint. No API
 * key, no signup, no install — just internet. Used for real AI thumbnails, for
 * per-scene AI "footage" visuals, and for generating objects (a car, a rocket…) from
 * a description in the AI Command panel.
 *
 * Images are generated at a sensible 16:9 size and the video engine scales them to the
 * chosen resolution — generating at the full 8K would be slow/unreliable on a free tier.
 */
import { writeFileSync } from 'fs'
import { logAiError } from '../llm/errorLog'
import { nextDelayMs, worthRetrying } from './retryPolicy'

const BASE = 'https://image.pollinations.ai/prompt/'

export interface ImageGenOptions {
  width?: number
  height?: number
  /** Deterministic seed (varies the image when changed). */
  seed?: number
  /** Pollinations model: 'flux' (default, best) or 'turbo' (faster/more reliable). */
  model?: string
  /** How many times to try before giving up (default 4). */
  attempts?: number
  /** Per-attempt timeout in ms (default 60s — flux can be slow but must not hang forever). */
  timeoutMs?: number
  /** Abort signal — lets a Stop cancel an in-flight download immediately. */
  signal?: AbortSignal
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Keeps the status AND the service's own Retry-After alive up to the retry loop. Both used
 * to be flattened into a message and thrown away, which is why the loop could only guess.
 */
export class ImageHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null
  ) {
    super(`Free image service returned ${status}. It can get busy — retrying.`)
  }
}

/** One HTTP attempt with a hard timeout, so a hung request can't stall the whole build. */
async function fetchImageOnce(
  prompt: string,
  outPath: string,
  width: number,
  height: number,
  model: string,
  seed: number | undefined,
  timeoutMs: number,
  external?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    // Strict content filter — see sceneImageUrl in styles.ts, which must stay identical.
    safe: 'true',
    model,
    referrer: 'nihilpointzero-studio'
  })
  if (seed !== undefined) params.set('seed', String(seed))
  const url = `${BASE}${encodeURIComponent(prompt.slice(0, 1500))}?${params.toString()}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  // Chain the caller's Stop signal into our controller.
  const onExternalAbort = (): void => ctrl.abort()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      // The status and Retry-After used to be flattened into a message string and lost.
      // The retry loop then had to guess when to come back while the service was telling
      // it exactly — see image/retryPolicy.ts.
      throw new ImageHttpError(res.status, res.headers.get('retry-after'))
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // Pollinations sometimes returns a tiny placeholder/error body instead of a real JPEG.
    if (buf.length < 2000) throw new Error('Free image service returned an empty image.')
    writeFileSync(outPath, buf)
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Generates one image from a text prompt and writes it to `outPath`. Returns the path.
 *
 * The free Pollinations endpoint (especially the high-quality `flux` model) frequently
 * returns 502/503 or times out under load — a single-shot request meant most scenes in a
 * build failed and were skipped ("only 1–2 of 8 images generated"). So we retry with
 * backoff and, on the last attempts, fall back to the faster/more reliable `turbo` model
 * so a scene ends up with SOME real image rather than none. Only throws if every attempt
 * fails, letting the caller fall back to the animated look.
 */
export async function generateImage(prompt: string, outPath: string, opts: ImageGenOptions = {}): Promise<string> {
  const width = opts.width ?? 1280
  const height = opts.height ?? 720
  const attempts = Math.max(1, opts.attempts ?? 5)
  const timeoutMs = opts.timeoutMs ?? 60_000
  // Try the requested model (default flux) for the first attempts, then drop to turbo,
  // which is markedly more reliable when the queue is busy.
  const primary = opts.model ?? 'flux'
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new Error('Render cancelled by user.')
    const model = i >= attempts - 1 && primary !== 'turbo' ? 'turbo' : primary
    try {
      await fetchImageOnce(prompt, outPath, width, height, model, opts.seed, timeoutMs, opts.signal)
      return outPath
    } catch (err) {
      lastErr = err
      if (opts.signal?.aborted) throw new Error('Render cancelled by user.', { cause: err })
      // Exponential backoff with ±40% jitter, capped at 12s. The jitter matters: several
      // scenes generating in parallel used to retry in LOCKSTEP, hammering the busy free
      // queue at the same instants — so whole batches failed together.
      const http = err instanceof ImageHttpError ? err : null
      // A 4xx that is not 408/429 says the same thing every time; five tries just makes
      // the user wait five times longer for one identical error.
      if (!worthRetrying(http?.status)) break
      if (i < attempts - 1) {
        await sleep(
          nextDelayMs({
            attempt: i,
            status: http?.status,
            retryAfter: http?.retryAfter,
            nowMs: Date.now(),
            random: Math.random()
          })
        )
      }
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : 'unknown error'
  logAiError({
    at: new Date().toISOString(),
    provider: `free-image/${primary}`,
    feature: 'image',
    message: `gave up after ${attempts} tries: ${detail}`
  })
  throw new Error(
    `Free image service failed after ${attempts} tries (${detail}). ` +
      `It can get busy — the video will use the animated look for this scene.`
  )
}

/**
 * Re-exported from ./styles, which has no imports and can therefore be bundled by the
 * phone app. Keeping the name exported here means every existing caller
 * (`import { sceneImagePrompt } from '../image'`) is completely unaffected.
 */
export { sceneImagePrompt } from './styles'
