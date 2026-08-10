/**
 * LOCAL-GPU real-video engine: a first-class client for the ComfyUI API — the
 * standard local backend the open text-to-video models (LTX-2.x, Wan, AnimateDiff,
 * HunyuanVideo) ship official nodes for. Replaces the old invented
 * "GET /health + POST /generate" contract that no stock server actually speaks
 * (that shim is kept as localKind 'generic' for anyone who built one).
 *
 * Real ComfyUI protocol (verified against ComfyUI's server API):
 *   GET  {base}/system_stats           -> 200 JSON when the server is up
 *   POST {base}/prompt                 -> { prompt: <workflow graph>, client_id }
 *                                          => { prompt_id }
 *   GET  {base}/history/{prompt_id}    -> {} until done; then outputs per node
 *   GET  {base}/view?filename=&subfolder=&type= -> the produced file's bytes
 *
 * The workflow graph is a template with {{PROMPT}} {{WIDTH}} {{HEIGHT}} {{FRAMES}}
 * {{SEED}} placeholders. A starter LTX template is built in; because model/node
 * names vary by ComfyUI install, Settings lets the user point at their OWN workflow
 * exported in API format ("Save (API format)" in ComfyUI) — that is the reliable
 * path on any setup. All pure pieces are unit-tested (comfyui.test.ts).
 *
 * HONEST LIMIT: this machine (Intel UHD, no CUDA) cannot run these models, so this
 * client could not be end-to-end verified against live LTX generation here — the
 * protocol layer is tested against mocks, and every failure falls back to the
 *slideshow with the reason logged. It exists so the app is ready the day the
 * hardware is.
 */
import { writeFileSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const DEFAULT_COMFY_ENDPOINT = 'http://127.0.0.1:8188'
/** Local generation ceiling — big models on small cards are legitimately slow. */
const GENERATION_TIMEOUT_MS = 15 * 60_000
const POLL_INTERVAL_MS = 2_000

/**
 * LTX wants frame counts of the form 8k+1 (9, 17, …, 97, 121). Snaps a duration at
 * the given fps to the nearest valid count, minimum 9. Pure + tested.
 */
export function snapLtxFrames(seconds: number, fps = 24): number {
  const raw = Math.max(1, Math.round(seconds * fps))
  return Math.max(9, Math.round((raw - 1) / 8) * 8 + 1)
}

/**
 * Substitutes the placeholders into a workflow template and parses it. {{PROMPT}}
 * is JSON-escaped so quotes/newlines/Urdu in a scene direction can never corrupt
 * the graph. Throws a plain-English error on an invalid template. Pure + tested.
 */
export function buildWorkflow(
  template: string,
  vars: { prompt: string; width: number; height: number; frames: number; seed: number }
): Record<string, unknown> {
  // JSON-encode then strip the surrounding quotes: the template holds "{{PROMPT}}".
  // Replacement callbacks, not strings: a plain-string replacement interprets
  // $-patterns ($$, $&) — a finance prompt like "costs $$40" would corrupt the graph.
  const escapedPrompt = JSON.stringify(vars.prompt).slice(1, -1)
  const filled = template
    .replaceAll('{{PROMPT}}', () => escapedPrompt)
    .replaceAll('{{WIDTH}}', () => String(Math.round(vars.width)))
    .replaceAll('{{HEIGHT}}', () => String(Math.round(vars.height)))
    .replaceAll('{{FRAMES}}', () => String(Math.round(vars.frames)))
    .replaceAll('{{SEED}}', () => String(Math.round(vars.seed)))
  try {
    const graph = JSON.parse(filled)
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new Error('not an object')
    return graph as Record<string, unknown>
  } catch {
    throw new Error(
      'The ComfyUI workflow template is not valid JSON. Export your working workflow with ' +
        '"Save (API format)" in ComfyUI, add the {{PROMPT}} placeholder, and point Settings → AI Video at that file.'
    )
  }
}

/**
 * Finds the first produced video file in a /history response for one prompt id.
 * ComfyUI reports outputs per node as arrays under keys like "videos", "gifs" or
 * "images" (SaveWEBM and video nodes differ); we accept any entry whose filename
 * looks like a video. Pure + tested.
 */
export function findVideoOutput(
  history: unknown,
  promptId: string
): { filename: string; subfolder: string; type: string } | null {
  const entry = (history as Record<string, { outputs?: Record<string, Record<string, unknown>> }>)?.[promptId]
  if (!entry?.outputs) return null
  const isVideoName = (n: string): boolean => /\.(mp4|webm|mov|avi|gif|webp)$/i.test(n)
  for (const nodeOut of Object.values(entry.outputs)) {
    for (const value of Object.values(nodeOut)) {
      if (!Array.isArray(value)) continue
      for (const item of value) {
        const f = item as { filename?: string; subfolder?: string; type?: string }
        if (f?.filename && isVideoName(f.filename)) {
          return { filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' }
        }
      }
    }
  }
  return null
}

/**
 * STARTER template for LTX text-to-video using ComfyUI's built-in LTXV nodes.
 * Deliberately labelled a starter: checkpoint/text-encoder file names differ per
 * install, so if this doesn't match yours, export your own working workflow in API
 * format and set its path in Settings → AI Video (the app substitutes the same
 * placeholders). Structured so swapping in Wan/Hunyuan is a template change, not
 * a code change.
 */
export const STARTER_LTX_WORKFLOW = `{
  "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "ltx-video-2b-v0.9.5.safetensors" } },
  "2": { "class_type": "CLIPLoader", "inputs": { "clip_name": "t5xxl_fp16.safetensors", "type": "ltxv" } },
  "3": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["2", 0], "text": "{{PROMPT}}" } },
  "4": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["2", 0], "text": "blurry, low quality, watermark, text" } },
  "5": { "class_type": "EmptyLTXVLatentVideo", "inputs": { "width": {{WIDTH}}, "height": {{HEIGHT}}, "length": {{FRAMES}}, "batch_size": 1 } },
  "6": { "class_type": "LTXVConditioning", "inputs": { "positive": ["3", 0], "negative": ["4", 0], "frame_rate": 24 } },
  "7": { "class_type": "KSampler", "inputs": { "model": ["1", 0], "positive": ["6", 0], "negative": ["6", 1], "latent_image": ["5", 0], "seed": {{SEED}}, "steps": 24, "cfg": 3.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0 } },
  "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7", 0], "vae": ["1", 2] } },
  "9": { "class_type": "SaveWEBM", "inputs": { "images": ["8", 0], "filename_prefix": "nihilpointzero", "codec": "vp9", "fps": 24, "crf": 32 } }
}`

/**
 * A signal that aborts on the caller's Stop OR after ms — whichever first. Falls
 * back to the caller's signal alone on runtimes without AbortSignal.any (the poll
 * deadline still bounds the total wait there).
 */
function composeSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(ms)
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  return anyFn ? anyFn.call(AbortSignal, [signal, AbortSignal.timeout(ms)]) : signal
}

/** Pings a real ComfyUI server. */
export async function detectComfy(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/system_stats`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000)
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Generates ONE clip through a live ComfyUI server and returns a local file path.
 * Throws a plain-English error on any failure — the caller decides the fallback.
 */
export async function generateComfyClip(opts: {
  endpoint: string
  workflowTemplate?: string
  workflowPath?: string
  prompt: string
  seconds: number
  width: number
  height: number
  seed: number
  signal?: AbortSignal
  onStatus?: (s: string) => void
}): Promise<string> {
  const base = (opts.endpoint || DEFAULT_COMFY_ENDPOINT).replace(/\/+$/, '')
  let template = opts.workflowTemplate ?? STARTER_LTX_WORKFLOW
  if (opts.workflowPath) {
    try {
      template = readFileSync(opts.workflowPath, 'utf-8')
    } catch {
      throw new Error(`Could not read the ComfyUI workflow file at ${opts.workflowPath} — check the path in Settings → AI Video.`)
    }
  }
  // Video models want /32 dimensions; snapping here keeps every caller honest.
  const snap32 = (n: number): number => Math.max(256, Math.round(n / 32) * 32)
  const graph = buildWorkflow(template, {
    prompt: opts.prompt,
    width: snap32(opts.width),
    height: snap32(opts.height),
    frames: snapLtxFrames(opts.seconds),
    seed: opts.seed
  })

  const submit = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'nihilpointzero-studio' }),
    signal: composeSignal(opts.signal, 30_000)
  })
  if (!submit.ok) {
    const body = await submit.text().catch(() => '')
    throw new Error(
      `ComfyUI rejected the workflow (HTTP ${submit.status}${body ? `: ${body.slice(0, 200)}` : ''}). ` +
        'Usually this means a node or model file in the workflow does not exist on your install — ' +
        'export your own working workflow (API format) and set its path in Settings → AI Video.'
    )
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id?: string }
  if (!promptId) throw new Error('ComfyUI did not return a prompt id.')

  const deadline = Date.now() + GENERATION_TIMEOUT_MS
  const interruptServer = (): void => {
    // Best-effort: tell ComfyUI to stop rendering, so a Stop here doesn't leave the
    // GPU grinding on a clip nobody wants.
    void fetch(`${base}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(3_000) }).catch(() => {})
  }
  for (;;) {
    if (opts.signal?.aborted) {
      interruptServer()
      throw new Error('stopped')
    }
    if (Date.now() > deadline) {
      interruptServer()
      throw new Error('ComfyUI generation timed out (15 minutes).')
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(`${base}/history/${promptId}`, { signal: composeSignal(opts.signal, 10_000) }).catch(() => null)
    if (!res || !res.ok) continue
    const history = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!history || !history[promptId]) continue
    const status = (history[promptId] as { status?: { status_str?: string; completed?: boolean } }).status
    if (status?.status_str === 'error') throw new Error('ComfyUI reported a generation error — check the ComfyUI console.')
    const video = findVideoOutput(history, promptId)
    if (video) {
      opts.onStatus?.('Downloading the generated clip from ComfyUI…')
      const q = `filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder)}&type=${encodeURIComponent(video.type)}`
      const dl = await fetch(`${base}/view?${q}`, { signal: composeSignal(opts.signal, 120_000) })
      if (!dl.ok) throw new Error(`Could not download the clip from ComfyUI (HTTP ${dl.status}).`)
      const ext = video.filename.includes('.') ? video.filename.slice(video.filename.lastIndexOf('.')) : '.mp4'
      const out = join(mkdtempSync(join(tmpdir(), 'ai-comfy-')), `clip${ext}`)
      writeFileSync(out, Buffer.from(await dl.arrayBuffer()))
      return out
    }
    if (status?.completed) throw new Error('ComfyUI finished but produced no video file — the workflow must end in a video-saving node (e.g. SaveWEBM).')
  }
}
