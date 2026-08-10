import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The orchestrator's per-scene fallback calls the real image generator — mock it so
// tests never touch the network. sceneImagePrompt stays deterministic for assertions.
vi.mock('../image', () => ({
  generateImage: vi.fn(async (_prompt: string, outPath: string) => outPath),
  sceneImagePrompt: (_style: string, scene: string, _title: string) => `prompt:${scene}`
}))

import { generateMotionSceneAssets, type MotionClipGenerator } from './videoEngine'
import { generateImage } from '../image'

const scratch = mkdtempSync(join(tmpdir(), 'vidzengine-test-'))

function opts(scenes: string[], extra: Partial<Parameters<typeof generateMotionSceneAssets>[1]> = {}) {
  return {
    scenes,
    title: 'T',
    style: 'cinematic' as const,
    secondsPerScene: 4,
    width: 1280,
    height: 736,
    scratch,
    engineLabel: 'test engine',
    ...extra
  }
}

beforeEach(() => {
  vi.mocked(generateImage).mockReset()
  vi.mocked(generateImage).mockImplementation(async (_prompt, outPath) => outPath)
})

describe('generateMotionSceneAssets', () => {
  it('produces one motion clip per scene when the generator always succeeds', async () => {
    const gen: MotionClipGenerator = async (s) => `clip-${s.seed}.mp4`
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c']))
    expect(r.motionCount).toBe(3)
    expect(r.assets.map((a) => a.kind)).toEqual(['video', 'video', 'video'])
    expect(r.assets.map((a) => a.index)).toEqual([0, 1, 2])
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('falls back to a still for a single failed scene, then recovers', async () => {
    let call = 0
    const gen: MotionClipGenerator = async (s) => {
      call++
      if (call === 2) throw new Error('one-off hiccup')
      return `clip-${s.seed}.mp4`
    }
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c']))
    expect(r.motionCount).toBe(2)
    expect(r.assets.map((a) => a.kind)).toEqual(['video', 'image', 'video'])
    expect(r.stoppedReason).toBeUndefined()
  })

  it('stops trying motion after two consecutive hard failures (the service is down)', async () => {
    const gen: MotionClipGenerator = async () => {
      throw new Error('your free Puter allowance is used up for now')
    }
    const progress: string[] = []
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c', 'd'], { onProgress: (s) => progress.push(s) }))
    expect(r.motionCount).toBe(0)
    // Only 2 generator attempts, then stills for everything.
    expect(r.assets.map((a) => a.kind)).toEqual(['image', 'image', 'image', 'image'])
    expect(r.stoppedReason).toContain('allowance')
    expect(progress.some((p) => p.includes('Remaining scenes use AI stills'))).toBe(true)
  })

  it('honours the motion cap and tells the user once', async () => {
    const gen: MotionClipGenerator = async (s) => `clip-${s.seed}.mp4`
    const progress: string[] = []
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c', 'd'], { motionCap: 2, onProgress: (s) => progress.push(s) }))
    expect(r.motionCount).toBe(2)
    expect(r.assets.map((a) => a.kind)).toEqual(['video', 'video', 'image', 'image'])
    expect(progress.filter((p) => p.includes('Motion cap reached')).length).toBe(1)
  })

  it('a motionCap of 0 means stills only (used when the local server is down)', async () => {
    const gen: MotionClipGenerator = async () => {
      throw new Error('must never be called')
    }
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b'], { motionCap: 0 }))
    expect(r.motionCount).toBe(0)
    expect(r.assets.map((a) => a.kind)).toEqual(['image', 'image'])
  })

  it('prefers caller-supplied stills as the per-scene fallback (never regenerates them)', async () => {
    const gen: MotionClipGenerator = async () => {
      throw new Error('down')
    }
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b'], { fallbackImages: ['user-a.jpg', 'user-b.jpg'] }))
    expect(r.assets.map((a) => a.path)).toEqual(['user-a.jpg', 'user-b.jpg'])
    expect(r.assets.every((a) => a.kind === 'image')).toBe(true)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('rethrows a user Stop instead of swallowing it as a fallback', async () => {
    const gen: MotionClipGenerator = async () => {
      throw new Error('stopped')
    }
    await expect(generateMotionSceneAssets(gen, opts(['a', 'b']))).rejects.toThrow('stopped')
  })

  it('skips a scene entirely when the still fallback also fails, without failing the build', async () => {
    const gen: MotionClipGenerator = async () => {
      throw new Error('down')
    }
    vi.mocked(generateImage).mockRejectedValue(new Error('image service down'))
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c']))
    expect(r.motionCount).toBe(0)
    expect(r.assets).toEqual([])
  })

  it('keeps scene order in the asset list (mixed motion + stills)', async () => {
    const gen: MotionClipGenerator = async (s) => {
      if (s.seed % 2 === 0) throw new Error('flaky')
      return `clip-${s.seed}.mp4`
    }
    const r = await generateMotionSceneAssets(gen, opts(['a', 'b', 'c']))
    expect(r.assets.map((a) => a.index)).toEqual([0, 1, 2])
    // seeds are 1-based: scene 0 (seed 1) ok, scene 1 (seed 2) falls back, scene 2 (seed 3) ok.
    expect(r.assets.map((a) => a.kind)).toEqual(['video', 'image', 'video'])
  })
})
