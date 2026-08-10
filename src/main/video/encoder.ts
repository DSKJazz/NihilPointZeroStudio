/**
 * Hardware-accelerated H.264 encoder selection. The bundled ffmpeg ships GPU
 * encoders (NVIDIA nvenc, Intel QuickSync qsv, AMD amf, Windows MediaFoundation mf);
 * using one is typically several times faster than the CPU libx264 encoder — the
 * biggest free speed win. We probe which one actually WORKS on this machine (being
 * compiled-in doesn't mean the GPU is present) and cache the result, falling back to
 * libx264 so a video always renders.
 *
 * The chosen encoder changes SPEED, not correctness — the video content is the same.
 * buildVideoEncoderArgs is pure + unit-tested.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CANCELLED_MESSAGE, runFfmpeg } from './ffmpeg'

/** Hardware H.264 encoders to try, best-first. */
export const HW_H264 = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'] as const

/** True for any non-CPU encoder. */
export function isHardware(encoder: string): boolean {
  return encoder !== 'libx264'
}

/**
 * Whether hardware encoding is worth its fixed startup overhead for this job. GPU
 * encoders win big on high resolution and long duration, but can be SLOWER than a
 * fast CPU encode for tiny clips. So: use hardware for 4K/8K (width ≥ 3840) or any
 * video ≥ 45s; use the CPU encoder for short, low-res clips. Pure + unit-tested.
 */
export function shouldUseHardware(width: number, durationSec: number): boolean {
  return width >= 3840 || durationSec >= 45
}

/**
 * The largest frame dimension a hardware H.264 encoder can be trusted with here.
 * Intel QuickSync H.264 tops out around 4096 px, and most consumer NVENC/AMF/
 * MediaFoundation H.264 also cap near there — so anything larger (notably 8K =
 * 7680×4320) MUST use the CPU encoder or the GPU rejects the job at runtime
 * ("Current resolution is unsupported"), which is exactly the 8K crash we hit.
 * 4K (3840×2160) stays under the cap, so 4K keeps its GPU speed. Pure + unit-tested.
 */
export const MAX_HARDWARE_DIMENSION = 4096

/** True if a hardware encoder can be trusted at this frame size (CPU is always fine). */
export function hardwareSupportsResolution(encoder: string, width: number, height: number): boolean {
  if (!isHardware(encoder)) return true
  return width <= MAX_HARDWARE_DIMENSION && height <= MAX_HARDWARE_DIMENSION
}

/** A short human label for the UI. */
export function encoderLabel(encoder: string): string {
  switch (encoder) {
    case 'h264_nvenc': return 'NVIDIA GPU (NVENC)'
    case 'h264_qsv': return 'Intel QuickSync GPU'
    case 'h264_amf': return 'AMD GPU (AMF)'
    case 'h264_mf': return 'Hardware (MediaFoundation)'
    default: return 'CPU (libx264)'
  }
}

/**
 * The `-c:v …` argument block for an encoder (constant-quality settings tuned for a
 * good speed/quality balance). Pure — no fs.
 */
export function buildVideoEncoderArgs(encoder: string): string[] {
  switch (encoder) {
    // HARDWARE PATHS SPEND THEIR SPEED ON QUALITY.
    // These were tuned for "speed/quality balance" back when the choice was against a
    // slow CPU encode. But a graphics chip is already 5-10x faster than libx264 — the
    // speed is not scarce here, and hardware encoders are weaker quality-per-bit than
    // x264, so a middling setting on hardware looks worse than the CPU path it
    // replaced. Better preset, tighter quality target: still far faster than the CPU,
    // and no longer a downgrade in exchange.
    case 'h264_nvenc':
      // p6 = slow preset, cq 19 = near-transparent. Was p4/cq23.
      return ['-c:v', 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p']
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryslow', '-global_quality', '21', '-pix_fmt', 'nv12']
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-quality', 'quality', '-pix_fmt', 'yuv420p']
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-pix_fmt', 'yuv420p']
    default:
      // The CPU path is DELIBERATELY left at veryfast. This is the fallback used when
      // no graphics encoder works, so it is already the slow route — spending another
      // 2-3x of the user's time here to chase a difference they would struggle to see
      // is the wrong trade. Speed is scarce on this path; on the hardware paths above
      // it is not. That asymmetry is the whole reasoning.
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
  }
}

/** Runs a tiny real encode to confirm an encoder actually works on this machine. */
async function testEncoder(encoder: string): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'enc-'))
  const out = join(dir, 't.mp4')
  try {
    await runFfmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.3:r=10',
      ...buildVideoEncoderArgs(encoder), '-frames:v', '3', out
    ])
    return existsSync(out) && statSync(out).size > 0
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let cached: string | null = null

/**
 * Returns the best working H.264 encoder id (cached for the process). Tries each
 * hardware encoder with a real 3-frame encode; falls back to libx264.
 */
export async function probeBestH264Encoder(): Promise<string> {
  if (cached) return cached
  for (const enc of HW_H264) {
    if (await testEncoder(enc)) {
      cached = enc
      return enc
    }
  }
  cached = 'libx264'
  return cached
}

/** For tests/UI: reset or inspect the cache. */
export function _setCachedEncoder(v: string | null): void {
  cached = v
}

/**
 * Picks the encoder for a real job: the best working hardware encoder when it's worth
 * it AND the frame size is within hardware limits, otherwise the CPU encoder. This is
 * the single place that decides "GPU or CPU" for a full-size render. Combine with
 * `runEncodeWithFallback` for a runtime safety net.
 */
export async function chooseEncoderForJob(width: number, height: number, durationSec: number): Promise<string> {
  const hw = await probeBestH264Encoder()
  const useHw =
    isHardware(hw) && shouldUseHardware(width, durationSec) && hardwareSupportsResolution(hw, width, height)
  return useHw ? hw : 'libx264'
}

/**
 * Runs an ffmpeg encode with an automatic CPU fallback. A hardware encoder can pass
 * the tiny capability probe yet still reject the REAL job (resolution, frame rate,
 * pixel format or rate-control it can't do — e.g. Intel QSV at 8K). When that happens
 * we rebuild the command with libx264 and retry ONCE, so a video always renders.
 *
 * `buildArgs(encoderArgs)` must return the full ffmpeg arg list using the supplied
 * `-c:v …` block. User cancellations are never retried. Returns the encoder that
 * actually produced the file.
 */
export async function runEncodeWithFallback(
  encoder: string,
  buildArgs: (encoderArgs: string[]) => string[],
  opts?: { onLog?: (line: string) => void; onNotice?: (msg: string) => void }
): Promise<string> {
  try {
    await runFfmpeg(buildArgs(buildVideoEncoderArgs(encoder)), opts?.onLog)
    return encoder
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Never fall back on a user cancel, and CPU encoding has no further fallback.
    if (!isHardware(encoder) || msg === CANCELLED_MESSAGE) throw err
    opts?.onNotice?.(
      `⚠ ${encoderLabel(encoder)} could not encode these settings — switching to CPU (libx264) and retrying…`
    )
    await runFfmpeg(buildArgs(buildVideoEncoderArgs('libx264')), opts?.onLog)
    return 'libx264'
  }
}
