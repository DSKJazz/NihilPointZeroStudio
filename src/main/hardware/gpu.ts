/**
 * What this PC can actually run — checked at runtime, told to the user plainly.
 *
 * AI video models are quoted in VRAM: the memory on a DEDICATED graphics card. An
 * integrated chip (Intel UHD, AMD Radeon Graphics) borrows system RAM instead and has
 * no CUDA cores, so a model needing "only 6GB VRAM" will not run on it at any usable
 * speed — it is not a matter of waiting longer. Saying that up front is the whole point
 * of this module: the alternative is a progress bar that never finishes.
 */
import { spawn } from 'child_process'

export interface GpuInfo {
  /** Adapter name as Windows reports it, e.g. "Intel(R) UHD Graphics". */
  name: string
  /** Dedicated video memory in GB. Integrated chips report shared memory here. */
  vramGB: number
  /** True only for a discrete NVIDIA card with a working driver (nvidia-smi answers). */
  hasCuda: boolean
  /** True when the adapter is integrated (shares system RAM) rather than discrete. */
  integrated: boolean
  totalRamGB: number
}

/** Runs a command and resolves its stdout, or null if it isn't available. */
function tryCommand(cmd: string, args: string[], timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: string | null): void => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    try {
      const p = spawn(cmd, args, { windowsHide: true })
      const timer = setTimeout(() => {
        p.kill()
        finish(null)
      }, timeoutMs)
      p.stdout.on('data', (d) => (out += d.toString()))
      p.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      p.on('close', (code) => {
        clearTimeout(timer)
        finish(code === 0 ? out : null)
      })
    } catch {
      finish(null)
    }
  })
}

const INTEGRATED_HINTS = ['intel', 'uhd', 'iris', 'hd graphics', 'radeon(tm) graphics', 'vega', 'microsoft basic']

/** True when an adapter name looks like an on-CPU integrated chip. Pure + tested. */
export function looksIntegrated(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('geforce') || n.includes('quadro') || n.includes('tesla') || n.includes('rtx') || n.includes('gtx')) {
    return false
  }
  return INTEGRATED_HINTS.some((h) => n.includes(h))
}

/** Reads GPU + RAM facts from Windows. Never throws; unknown values come back as zeros. */
export async function detectGpu(): Promise<GpuInfo> {
  const nvidia = await tryCommand('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  if (nvidia && nvidia.trim()) {
    const [name, mib] = nvidia.trim().split('\n')[0].split(',').map((s) => s.trim())
    return {
      name: name || 'NVIDIA GPU',
      vramGB: Math.round((Number(mib) / 1024) * 10) / 10 || 0,
      hasCuda: true,
      integrated: false,
      totalRamGB: await totalRam()
    }
  }

  const ps = await tryCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$g = Get-CimInstance Win32_VideoController | Select-Object -First 1; ' +
      'Write-Output ("{0}|{1}" -f $g.Name, $g.AdapterRAM)'
  ])
  const [name, ramBytes] = (ps || '|').trim().split('|')
  const adapterName = (name || '').trim() || 'Unknown graphics'
  return {
    name: adapterName,
    vramGB: Math.round((Number(ramBytes) / 1024 ** 3) * 10) / 10 || 0,
    hasCuda: false,
    integrated: looksIntegrated(adapterName),
    totalRamGB: await totalRam()
  }
}

async function totalRam(): Promise<number> {
  const out = await tryCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory'
  ])
  return Math.round((Number((out || '').trim()) / 1024 ** 3) * 10) / 10 || 0
}

export interface VideoModelSpec {
  id: string
  label: string
  /** Dedicated VRAM the model needs to run at a usable speed. */
  minVramGB: number
  note: string
}

/** The open-source motion-video / talking-head models, with their real requirements.
 * Tiers follow the mid-2026 landscape: 8GB entry models, LTX-2 at 12GB, LTX-2.3 at
 * 16GB (native 4K + sound, the recommended local model), and the 24GB heavyweights. */
export const VIDEO_MODELS: VideoModelSpec[] = [
  { id: 'cogvideox-2b', label: 'CogVideoX-2B', minVramGB: 6, note: 'Lowest requirement of the motion-video models.' },
  { id: 'animatediff', label: 'AnimateDiff', minVramGB: 8, note: 'Smallest modern footprint; roughest quality.' },
  { id: 'wan-2.1-1.3b', label: 'Wan 2.1 (1.3B)', minVramGB: 8, note: 'Small and quick; rough.' },
  { id: 'ltx-video', label: 'LTX-Video / LTX-2', minVramGB: 12, note: 'The speed champion — good quality balance.' },
  { id: 'ltx-2.3', label: 'LTX-2.3', minVramGB: 16, note: 'Recommended: native 4K, generates sound too, vertical Shorts trained natively.' },
  { id: 'wan-2.2', label: 'Wan 2.2', minVramGB: 24, note: 'Top quality when time isn\'t critical.' },
  { id: 'hunyuanvideo-1.5', label: 'HunyuanVideo 1.5', minVramGB: 24, note: 'Top-quality alternative to Wan 2.2.' },
  { id: 'sadtalker', label: 'SadTalker (talking photo)', minVramGB: 6, note: 'Animates one photo into a talking head.' },
  { id: 'liveportrait', label: 'LivePortrait (talking photo)', minVramGB: 8, note: 'Higher-fidelity talking head.' }
]

/** Motion models only (talking-photo tools recommend differently). */
const MOTION_MODEL_IDS = new Set(['cogvideox-2b', 'animatediff', 'wan-2.1-1.3b', 'ltx-video', 'ltx-2.3', 'wan-2.2', 'hunyuanvideo-1.5'])

/**
 * The best motion-video model this GPU can actually run, or null when none can
 * (no CUDA / not enough VRAM). Used by Settings → AI Video to recommend a model
 * size the day real hardware shows up. Pure + tested.
 */
export function recommendVideoModel(gpu: GpuInfo): VideoModelSpec | null {
  if (!gpu.hasCuda || gpu.vramGB <= 0) return null
  const fits = VIDEO_MODELS.filter((m) => MOTION_MODEL_IDS.has(m.id) && m.minVramGB <= gpu.vramGB)
  if (!fits.length) return null
  return fits.sort((a, b) => b.minVramGB - a.minVramGB)[0]
}

export interface Verdict {
  canRun: boolean
  /** Plain-English explanation written for a non-technical reader. */
  message: string
  /** A model that WOULD run here, when the requested one won't. */
  suggestion?: string
}

/**
 * Decides whether a model can run, in words a non-technical user can act on.
 * Deliberately refuses on integrated graphics even when the "VRAM" number looks big
 * enough: shared memory is not dedicated VRAM, and there are no CUDA cores to use it.
 */
export function canRunModel(gpu: GpuInfo, model: VideoModelSpec): Verdict {
  if (!gpu.hasCuda) {
    const kind = gpu.integrated ? 'built into your processor' : 'not an NVIDIA card'
    return {
      canRun: false,
      message:
        `${model.label} needs a dedicated NVIDIA graphics card with at least ${model.minVramGB}GB of video memory. ` +
        `This PC has ${gpu.name}, which is ${kind}, so it cannot run these AI video models — not slowly, not at all. ` +
        `Everything else in the studio still works: use Photo Slideshow or Stock Footage for your videos.`,
      suggestion: 'photo-slideshow'
    }
  }
  if (gpu.vramGB > 0 && gpu.vramGB < model.minVramGB) {
    const smaller = VIDEO_MODELS.filter((m) => m.minVramGB <= gpu.vramGB).sort((a, b) => b.minVramGB - a.minVramGB)[0]
    return {
      canRun: false,
      message:
        `Your graphics card (${gpu.name}, ${gpu.vramGB}GB) does not have enough memory for ${model.label}, ` +
        `which needs ${model.minVramGB}GB.` +
        (smaller ? ` Try ${smaller.label} instead — it fits in ${smaller.minVramGB}GB.` : ' A bigger graphics card would be needed.'),
      suggestion: smaller?.id ?? 'photo-slideshow'
    }
  }
  return { canRun: true, message: `${gpu.name} (${gpu.vramGB}GB) can run ${model.label}.` }
}

/** One-line summary for the Settings/health panel. */
export function describeGpu(gpu: GpuInfo): string {
  if (gpu.hasCuda) return `${gpu.name} · ${gpu.vramGB}GB video memory · AI video generation supported`
  return `${gpu.name}${gpu.integrated ? ' (built into the processor)' : ''} · no dedicated NVIDIA card · AI video generation not available on this PC`
}
