/**
 * Cloud AI-footage engine (💳 paid — you supply an API key). This is a provider-
 * agnostic client: it POSTs a prompt to a REST endpoint you configure and expects a
 * generated video URL back, which it downloads. Because true text-to-video is a paid,
 * online service, this engine is OPTIONAL — the free preset engine is the default and
 * always works offline.
 *
 * Expected endpoint contract (configure in Settings → AI Video):
 *   POST {cloudEndpoint}
 *   headers: { Authorization: `Bearer {cloudApiKey}`, Content-Type: application/json }
 *   body:    { prompt, seconds, model?, width, height }
 *   200 ->   { videoUrl: "https://…" }   (or { url } / { output })
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { getAiVideoConfig } from '../store'
import type { VideoResolution, VideoStyle } from '../../shared/types'

export interface AiFootageRequest {
  title: string
  body: string
  durationSec: number
  style?: VideoStyle
  resolution?: VideoResolution
  /**
   * Where to write footage.mp4. When the caller passes its build-scratch dir the
   * file is cleaned up with the build; without it, each run leaked a fresh
   * %TEMP%\ai-cloud-* directory that nothing ever removed.
   */
  scratchDir?: string
}

/** True when both an API key and an endpoint are configured. */
export function isCloudConfigured(): boolean {
  const c = getAiVideoConfig()
  return !!(c.cloudApiKey && c.cloudEndpoint)
}

const RES_WH: Record<VideoResolution, [number, number]> = {
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '8k': [7680, 4320]
}

/** Builds a concise text prompt for the footage from the script + style. */
export function buildFootagePrompt(req: AiFootageRequest): string {
  const styleWord = req.style ? `${req.style} style` : 'cinematic style'
  const topic = req.title || req.body.slice(0, 120)
  return `${styleWord}, high quality b-roll video for: ${topic}`
}

/**
 * Generates footage via the configured cloud provider and returns a local file path.
 * Throws an instructive error when not configured (so the UI can guide setup) or when
 * the provider call fails.
 */
export async function generateCloudFootage(req: AiFootageRequest): Promise<string> {
  const cfg = getAiVideoConfig()
  if (!cfg.cloudApiKey || !cfg.cloudEndpoint) {
    throw new Error(
      'Cloud AI footage is not set up. It is a PAID option: get an API key from a text-to-video provider ' +
        '(e.g. Runway, Pika, Replicate, or Luma), then add your key + endpoint under Settings → AI Video. ' +
        'Or switch the engine back to “Style presets (free)”.'
    )
  }
  const [w, h] = RES_WH[req.resolution ?? '1080p']
  const res = await fetch(cfg.cloudEndpoint, {
    method: 'POST',
    // Cloud text-to-video generation is legitimately slow — generous, but never infinite.
    signal: AbortSignal.timeout(15 * 60_000),
    headers: { Authorization: `Bearer ${cfg.cloudApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: buildFootagePrompt(req),
      seconds: Math.max(1, Math.round(req.durationSec)),
      model: cfg.cloudModel,
      width: w,
      height: h
    })
  })
  if (!res.ok) throw new Error(`Cloud AI provider returned HTTP ${res.status}. Check your key/endpoint/credits.`)
  const data = (await res.json()) as { videoUrl?: string; url?: string; output?: string }
  const videoUrl = data.videoUrl || data.url || data.output
  if (!videoUrl) throw new Error('Cloud AI provider did not return a video URL in the response.')

  const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(300_000) })
  if (!dl.ok) throw new Error(`Could not download the generated footage (HTTP ${dl.status}).`)
  const buf = Buffer.from(await dl.arrayBuffer())
  const out = join(req.scratchDir ?? mkdtempSync(join(tmpdir(), 'ai-cloud-')), 'footage.mp4')
  writeFileSync(out, buf)
  return out
}
