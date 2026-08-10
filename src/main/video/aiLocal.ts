/**
 * Local AI-footage engine (🟢 free per video — but needs an NVIDIA GPU). Two kinds:
 *
 *  - 'comfyui' (default): a REAL ComfyUI server — the standard backend the open
 *    text-to-video models (LTX-2.x, Wan, AnimateDiff, HunyuanVideo) ship nodes for.
 *    Protocol client lives in ./comfyui.ts. Default port 8188 (ComfyUI's own).
 *  - 'generic': the legacy custom shim contract, kept for anyone who built one:
 *      GET  {localEndpoint}/health   -> 200 when the server is up
 *      POST {localEndpoint}/generate -> { prompt, seconds, width, height } -> video bytes
 *        (either raw video/* body, or JSON { videoUrl } we then download)
 *
 * Free at inference time, but the model + GPU are NOT bundled: this engine is
 * OPTIONAL and hardware-gated. It stays VISIBLE in the UI on machines without an
 * NVIDIA card — greyed out with plain instructions — so the app is ready the day
 * the hardware exists.
 */
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getAiVideoConfig } from '../store'
import { buildFootagePrompt, type AiFootageRequest } from './aiCloud'
import { DEFAULT_COMFY_ENDPOINT, detectComfy, generateComfyClip } from './comfyui'

const DEFAULT_GENERIC_ENDPOINT = 'http://127.0.0.1:7860'

export function localKind(): 'comfyui' | 'generic' {
  return getAiVideoConfig().localKind === 'generic' ? 'generic' : 'comfyui'
}

export function localEndpoint(): string {
  const cfg = getAiVideoConfig()
  return cfg.localEndpoint || (localKind() === 'comfyui' ? DEFAULT_COMFY_ENDPOINT : DEFAULT_GENERIC_ENDPOINT)
}

/** Pings the configured local server (kind-aware); false on any error. */
export async function detectLocal(): Promise<boolean> {
  if (localKind() === 'comfyui') return detectComfy(localEndpoint())
  try {
    const res = await fetch(`${localEndpoint()}/health`, { method: 'GET', signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

const RES_WH: Record<string, [number, number]> = {
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '8k': [7680, 4320]
}

/**
 * Generates ONE motion clip for a scene prompt on the local server (kind-aware).
 * Used per scene by the engine seam; throws a plain-English error on failure so the
 * caller can fall back to a still for that scene.
 */
export async function generateLocalClip(opts: {
  prompt: string
  seconds: number
  width: number
  height: number
  seed: number
  signal?: AbortSignal
  onStatus?: (s: string) => void
}): Promise<string> {
  const cfg = getAiVideoConfig()
  if (localKind() === 'comfyui') {
    return generateComfyClip({
      endpoint: localEndpoint(),
      workflowPath: cfg.comfyWorkflowPath || undefined,
      prompt: opts.prompt,
      seconds: opts.seconds,
      width: opts.width,
      height: opts.height,
      seed: opts.seed,
      signal: opts.signal,
      onStatus: opts.onStatus
    })
  }
  // Legacy generic shim: one POST per clip.
  const res = await fetch(`${localEndpoint()}/generate`, {
    method: 'POST',
    signal: opts.signal ?? AbortSignal.timeout(15 * 60_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: opts.prompt,
      seconds: Math.max(1, Math.round(opts.seconds)),
      width: opts.width,
      height: opts.height
    })
  })
  if (!res.ok) throw new Error(`Local AI server returned HTTP ${res.status}.`)
  const out = join(mkdtempSync(join(tmpdir(), 'ai-local-')), 'footage.mp4')
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const data = (await res.json()) as { videoUrl?: string; url?: string }
    const url = data.videoUrl || data.url
    if (!url) throw new Error('Local AI server did not return video data.')
    const dl = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!dl.ok) throw new Error(`Could not download local footage (HTTP ${dl.status}).`)
    writeFileSync(out, Buffer.from(await dl.arrayBuffer()))
  } else {
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
  return out
}

/**
 * Legacy whole-video generation (generic shim only) — kept for compatibility with
 * the old single-clip flow. New builds go per scene through generateLocalClip.
 */
export async function generateLocalFootage(req: AiFootageRequest): Promise<string> {
  if (!(await detectLocal())) {
    throw new Error(
      'Local AI video server not detected. This engine is FREE per video but needs an NVIDIA GPU and a local ' +
        `ComfyUI server running on this PC (default ${DEFAULT_COMFY_ENDPOINT}) — or your own custom server. ` +
        'Set it up under Settings → AI Video — or switch to another engine; the build falls back to the slideshow automatically.'
    )
  }
  const [w, h] = RES_WH[req.resolution ?? '1080p']
  return generateLocalClip({
    prompt: buildFootagePrompt(req),
    seconds: Math.max(1, Math.round(req.durationSec)),
    width: w,
    height: h,
    seed: 1
  })
}
