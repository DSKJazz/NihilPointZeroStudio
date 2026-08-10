import { describe, expect, it } from 'vitest'
import { canRunModel, describeGpu, looksIntegrated, recommendVideoModel, VIDEO_MODELS, type GpuInfo } from './gpu'

const model = (id: string) => VIDEO_MODELS.find((m) => m.id === id)!

const intelUhd: GpuInfo = {
  name: 'Intel(R) UHD Graphics',
  vramGB: 2,
  hasCuda: false,
  integrated: true,
  totalRamGB: 15.7
}
const rtx3060: GpuInfo = { name: 'NVIDIA GeForce RTX 3060', vramGB: 12, hasCuda: true, integrated: false, totalRamGB: 32 }
const rtx3050: GpuInfo = { name: 'NVIDIA GeForce RTX 3050', vramGB: 4, hasCuda: true, integrated: false, totalRamGB: 16 }

describe('looksIntegrated', () => {
  it('recognises Intel integrated graphics', () => {
    expect(looksIntegrated('Intel(R) UHD Graphics')).toBe(true)
    expect(looksIntegrated('Intel(R) Iris(R) Xe Graphics')).toBe(true)
  })

  it('does not mistake a discrete NVIDIA card for integrated', () => {
    expect(looksIntegrated('NVIDIA GeForce RTX 4090')).toBe(false)
    expect(looksIntegrated('NVIDIA GeForce GTX 1650')).toBe(false)
  })
})

describe('canRunModel', () => {
  // The machine this was built on. Every model must be refused, including the
  // lightest one — 2GB of SHARED memory is not 6GB of dedicated VRAM.
  it('refuses every AI video model on integrated Intel graphics', () => {
    for (const m of VIDEO_MODELS) {
      expect(canRunModel(intelUhd, m).canRun).toBe(false)
    }
  })

  it('says so plainly, without jargon or false hope', () => {
    const v = canRunModel(intelUhd, model('cogvideox-2b'))
    expect(v.message).toContain('cannot run')
    expect(v.message).toMatch(/Photo Slideshow|Stock Footage/)
  })

  it('points integrated users at something that does work', () => {
    expect(canRunModel(intelUhd, model('ltx-video')).suggestion).toBe('photo-slideshow')
  })

  it('allows a model that fits the card', () => {
    expect(canRunModel(rtx3060, model('cogvideox-2b')).canRun).toBe(true)
    expect(canRunModel(rtx3060, model('ltx-video')).canRun).toBe(true)
  })

  it('refuses a model too big for a small card and names a smaller one', () => {
    const v = canRunModel(rtx3050, model('ltx-video'))
    expect(v.canRun).toBe(false)
    expect(v.message).toContain('4GB')
    expect(v.message).toContain('12GB')
  })

  it('never claims a non-NVIDIA card works, however much memory it reports', () => {
    const bigIntegrated: GpuInfo = { ...intelUhd, vramGB: 32 }
    expect(canRunModel(bigIntegrated, model('cogvideox-2b')).canRun).toBe(false)
  })
})

describe('recommendVideoModel', () => {
  it('recommends nothing on this machine (no CUDA)', () => {
    expect(recommendVideoModel(intelUhd)).toBeNull()
  })

  it('recommends nothing on an integrated chip even with a big reported memory', () => {
    expect(recommendVideoModel({ ...intelUhd, vramGB: 32 })).toBeNull()
  })

  it('recommends the LTX tier for a 12GB card', () => {
    expect(recommendVideoModel(rtx3060)?.id).toBe('ltx-video')
  })

  it('recommends LTX-2.3 for a 16GB card', () => {
    const rtx4080: GpuInfo = { name: 'NVIDIA GeForce RTX 4080', vramGB: 16, hasCuda: true, integrated: false, totalRamGB: 64 }
    expect(recommendVideoModel(rtx4080)?.id).toBe('ltx-2.3')
  })

  it('recommends a 24GB heavyweight for a 4090', () => {
    const rtx4090: GpuInfo = { name: 'NVIDIA GeForce RTX 4090', vramGB: 24, hasCuda: true, integrated: false, totalRamGB: 64 }
    expect(recommendVideoModel(rtx4090)?.minVramGB).toBe(24)
  })

  it('never recommends a talking-photo tool as the motion model', () => {
    const tiny: GpuInfo = { name: 'NVIDIA GeForce RTX 3050', vramGB: 8, hasCuda: true, integrated: false, totalRamGB: 16 }
    const rec = recommendVideoModel(tiny)
    expect(rec && ['sadtalker', 'liveportrait'].includes(rec.id)).toBe(false)
  })
})

describe('describeGpu', () => {
  it('is honest on this machine', () => {
    expect(describeGpu(intelUhd)).toContain('not available on this PC')
  })

  it('is positive on a capable card', () => {
    expect(describeGpu(rtx3060)).toContain('supported')
  })
})
