/**
 * The one engine seam every video-producing tab shares: given the scene list, an
 * engine produces one asset per scene (a REAL motion clip, or an AI still as the
 * per-scene fallback), and the assembler turns the mixed list into a single
 * background video that exactly covers the narration.
 *
 * Design rules (the app's reliability contract):
 *  - A scene's motion generation failing NEVER fails the build — that scene falls
 *    back to an AI still, with the reason surfaced via onProgress.
 *  - Two consecutive hard failures = the service is down/out of allowance; stop
 *    burning time (and the user's free allowance) and use stills for the rest.
 *  - The actual generators are injected (Puter / ComfyUI / anything future), so this
 *    module stays pure enough to unit-test with fakes and swapping vendors is a
 *    config change, not a rewrite.
 */
import { basename, dirname, extname, join, sep } from 'path'
import { copyFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { generateImage, sceneImagePrompt } from '../image'
import { makeSlideshow, type Layout } from './render'
import { runFfmpeg } from './ffmpeg'
import type { VideoStyle } from '../../shared/types'

export interface SceneAsset {
  index: number
  kind: 'video' | 'image'
  path: string
}

/** Generates one REAL motion clip for a scene prompt; throws on failure. */
export type MotionClipGenerator = (scene: {
  prompt: string
  seconds: number
  width: number
  height: number
  seed: number
}) => Promise<string>

export interface MotionSceneOptions {
  scenes: string[]
  title: string
  style: VideoStyle
  secondsPerScene: number
  width: number
  height: number
  scratch: string
  /** Cap on how many scenes get real motion (protects free allowances). Infinity = all. */
  motionCap?: number
  /**
   * Caller-supplied stills (e.g. Scene Studio's curated images), preferred over
   * freshly generated ones as the per-scene fallback (matched by scene index).
   */
  fallbackImages?: string[]
  /** Human label for the engine, used in progress lines ("free cloud", "local GPU"). */
  engineLabel: string
  signal?: AbortSignal
  onProgress?: (s: string) => void
}

export interface MotionSceneResult {
  assets: SceneAsset[]
  /** How many scenes got REAL generated motion. */
  motionCount: number
  /** The classified reason motion stopped/never started, when it did. */
  stoppedReason?: string
}

/** After this many consecutive motion failures, the engine is treated as down. */
const HARD_FAILURE_LIMIT = 2

/**
 * Runs the injected motion generator over every scene with per-scene still fallback.
 * Never throws for engine trouble — only rethrows a user Stop ('stopped').
 */
export async function generateMotionSceneAssets(
  generate: MotionClipGenerator,
  o: MotionSceneOptions
): Promise<MotionSceneResult> {
  const assets: SceneAsset[] = []
  const cap = o.motionCap ?? Infinity
  let motionCount = 0
  let consecutiveFailures = 0
  let stoppedReason: string | undefined
  let capNoted = false

  for (let i = 0; i < o.scenes.length; i++) {
    if (o.signal?.aborted) throw new Error('stopped')
    const scene = o.scenes[i]
    const tryMotion = motionCount < cap && consecutiveFailures < HARD_FAILURE_LIMIT

    if (!tryMotion && !capNoted && cap >= 1 && cap !== Infinity && motionCount >= cap) {
      capNoted = true
      o.onProgress?.(
        `Motion cap reached (${cap} scenes get real video per build — adjustable in Settings → AI Video). Remaining scenes use AI stills.`
      )
    }

    if (tryMotion) {
      o.onProgress?.(`Scene ${i + 1}/${o.scenes.length}: generating REAL AI video (${o.engineLabel})…`)
      try {
        const clip = await generate({
          prompt: sceneImagePrompt(o.style, scene, o.title),
          seconds: o.secondsPerScene,
          width: o.width,
          height: o.height,
          seed: i + 1
        })
        // Adopt the clip into this build's scratch: every generator writes into its
        // own single-file %TEMP%\ai-* dir that nothing cleans afterwards, so a build
        // used to leak one temp directory per motion scene. (Only dirs matching the
        // generators' known ai- prefix are removed — never arbitrary parents.)
        let clipPath = clip
        const clipParent = dirname(clip)
        if (!clip.startsWith(o.scratch + sep) && /^ai-/.test(basename(clipParent))) {
          clipPath = join(o.scratch, `motion-${i}${extname(clip) || '.mp4'}`)
          copyFileSync(clip, clipPath)
          try {
            rmSync(clipParent, { recursive: true, force: true })
          } catch {
            /* cleanup is best-effort */
          }
        }
        assets.push({ index: i, kind: 'video', path: clipPath })
        motionCount++
        consecutiveFailures = 0
        continue
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === 'stopped') throw err
        consecutiveFailures++
        if (consecutiveFailures >= HARD_FAILURE_LIMIT) {
          stoppedReason = msg
          o.onProgress?.(
            `Real AI video (${o.engineLabel}) is unavailable — ${msg}. Remaining scenes use AI stills instead.`
          )
        } else {
          o.onProgress?.(`Scene ${i + 1}: real video failed (${msg}) — using an AI still for this scene.`)
        }
      }
    }

    // Per-scene fallback: the caller's own still for this scene when provided
    // (e.g. Scene Studio's curated images), else a fresh AI still in the same
    // visual language as the slideshow engine.
    const provided = o.fallbackImages?.[i]
    if (provided) {
      assets.push({ index: i, kind: 'image', path: provided })
      continue
    }
    try {
      const imgPath = join(o.scratch, `scene-${i}.jpg`)
      await generateImage(sceneImagePrompt(o.style, scene, o.title), imgPath, {
        width: o.width,
        height: o.height,
        seed: i + 1,
        signal: o.signal
      })
      assets.push({ index: i, kind: 'image', path: imgPath })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'stopped' || o.signal?.aborted) throw new Error('stopped', { cause: err })
      o.onProgress?.(`Scene ${i + 1}: still image also failed (${msg}) — skipping this scene.`)
    }
  }

  return { assets, motionCount, stoppedReason }
}

/**
 * Normalizes ONE motion clip to the layout size, 25 fps, exactly `seconds` long
 * (trims longer clips; freeze-extends shorter ones), silent, libx264 — the same
 * shape makeSlideshow produces, so the segments concatenate cleanly.
 */
export async function normalizeClip(input: string, layout: Layout, seconds: number, outPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    input,
    '-vf',
    `scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,crop=${layout.w}:${layout.h},setsar=1,` +
      `fps=25,tpad=stop_mode=clone:stop_duration=${Math.ceil(seconds)}`,
    '-t',
    seconds.toFixed(2),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    outPath
  ])
}

/**
 * Best-effort removal of a generated clip's temp directory (each engine downloads
 * into its own mkdtemp dir). Guarded hard: only ever touches our own ai-* dirs
 * directly under the OS temp dir — never user files.
 */
export function cleanupClipTemp(clipPath: string): void {
  try {
    const dir = dirname(clipPath)
    const base = dir.slice(dir.lastIndexOf(sep) + 1)
    if (dirname(dir) === tmpdir() && /^ai-(puter|comfy|local|pollin)-/.test(base)) {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    /* temp cleanup is never worth failing a build over */
  }
}

/**
 * Turns the mixed asset list into ONE background video covering the whole narration:
 * the total duration is divided across the surviving scenes (motion clips normalized,
 * stills Ken-Burns animated), then all segments are concatenated in scene order. The
 * last segment gets a small cushion so the background can never come up SHORT of the
 * narration — render.ts encodes with -shortest, so short would truncate the video
 * (overshoot is simply cut).
 * Returns undefined when there is nothing usable (caller falls back to stills/animated).
 */
export async function assembleSceneBackground(o: {
  assets: SceneAsset[]
  layout: Layout
  totalSeconds: number
  scratch: string
  onProgress?: (s: string) => void
}): Promise<string | undefined> {
  if (!o.assets.length) return undefined
  const segments: string[] = []
  // +1s cushion over the narration, redistributed live: when a segment fails, its
  // share flows into the remaining ones, so the total stays covered.
  const target = o.totalSeconds + 1
  let covered = 0
  for (let k = 0; k < o.assets.length; k++) {
    const asset = o.assets[k]
    const segSeconds = Math.max(1, (target - covered) / (o.assets.length - k))
    const seg = join(o.scratch, `segment-${asset.index}.mp4`)
    try {
      if (asset.kind === 'video') {
        await normalizeClip(asset.path, o.layout, segSeconds, seg)
        cleanupClipTemp(asset.path)
      } else {
        await makeSlideshow([asset.path], o.layout, segSeconds, seg)
      }
      segments.push(seg)
      covered += segSeconds
    } catch (err) {
      o.onProgress?.(
        `Scene ${asset.index + 1}: could not prepare its segment (${err instanceof Error ? err.message : 'error'}) — skipping.`
      )
    }
  }
  if (!segments.length) return undefined
  if (segments.length === 1) return segments[0]

  // Concat demuxer with a uniform re-encode: all segments share size/fps already, and
  // one clean encode is far more robust than stream-copying near-identical files.
  const listPath = join(o.scratch, 'segments.txt')
  // ffmpeg concat demuxer quoting: inside single quotes, escape each embedded single
  // quote as '\'' (close, escaped quote, reopen). Backslashes/spaces are fine quoted.
  const listBody = segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  writeFileSync(listPath, listBody)
  const out = join(o.scratch, 'scene-background.mp4')
  o.onProgress?.('Joining the scene clips into one background…')
  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-an',
    out
  ])
  return out
}
