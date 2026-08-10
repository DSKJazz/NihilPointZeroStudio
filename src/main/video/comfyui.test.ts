import { describe, expect, it } from 'vitest'
import { buildWorkflow, findVideoOutput, snapLtxFrames, STARTER_LTX_WORKFLOW } from './comfyui'

describe('snapLtxFrames', () => {
  it('snaps to the 8k+1 frame counts LTX requires', () => {
    for (const s of [0.2, 1, 2.5, 4, 5, 8, 10]) {
      const f = snapLtxFrames(s)
      expect((f - 1) % 8).toBe(0)
      expect(f).toBeGreaterThanOrEqual(9)
    }
  })

  it('lands near the requested duration at 24fps', () => {
    expect(snapLtxFrames(4)).toBe(97) // 4s*24 = 96 -> 97
    expect(snapLtxFrames(5)).toBe(121) // 120 -> 121
  })
})

describe('buildWorkflow', () => {
  it('fills every placeholder in the starter template and yields valid JSON', () => {
    const graph = buildWorkflow(STARTER_LTX_WORKFLOW, {
      prompt: 'a red apple',
      width: 768,
      height: 512,
      frames: 97,
      seed: 7
    })
    const text = JSON.stringify(graph)
    expect(text).toContain('a red apple')
    expect(text).not.toContain('{{')
    const nodes = Object.values(graph) as { class_type: string; inputs: Record<string, unknown> }[]
    const latent = nodes.find((n) => n.class_type === 'EmptyLTXVLatentVideo')!
    expect(latent.inputs.width).toBe(768)
    expect(latent.inputs.length).toBe(97)
    const sampler = nodes.find((n) => n.class_type === 'KSampler')!
    expect(sampler.inputs.seed).toBe(7)
  })

  it('JSON-escapes quotes/newlines/Urdu in the prompt so the graph stays valid', () => {
    const graph = buildWorkflow(STARTER_LTX_WORKFLOW, {
      prompt: 'کراچی "rain", line1\nline2',
      width: 768,
      height: 512,
      frames: 9,
      seed: 1
    })
    const encode = Object.values(graph).find(
      (n) => (n as { class_type: string }).class_type === 'CLIPTextEncode'
    ) as { inputs: { text: string } }
    expect(encode.inputs.text).toContain('کراچی')
    expect(encode.inputs.text).toContain('"rain"')
    expect(encode.inputs.text).toContain('line1\nline2')
  })

  it('throws a plain-English error for an invalid template', () => {
    expect(() => buildWorkflow('{ not json', { prompt: 'p', width: 1, height: 1, frames: 9, seed: 1 })).toThrow(
      /Save \(API format\)/
    )
  })
})

describe('findVideoOutput', () => {
  it('finds a video in a "gifs" output array (video-combine style nodes)', () => {
    const history = {
      abc: { outputs: { '9': { gifs: [{ filename: 'out_00001.mp4', subfolder: 'video', type: 'output' }] } } }
    }
    expect(findVideoOutput(history, 'abc')).toEqual({ filename: 'out_00001.mp4', subfolder: 'video', type: 'output' })
  })

  it('finds a webm saved under "images" (SaveWEBM reports there)', () => {
    const history = { abc: { outputs: { '9': { images: [{ filename: 'nihil_0001.webm', type: 'output' }] } } } }
    expect(findVideoOutput(history, 'abc')?.filename).toBe('nihil_0001.webm')
  })

  it('ignores plain image outputs and missing entries', () => {
    const history = { abc: { outputs: { '9': { images: [{ filename: 'preview.png', type: 'temp' }] } } } }
    expect(findVideoOutput(history, 'abc')).toBeNull()
    expect(findVideoOutput({}, 'abc')).toBeNull()
    expect(findVideoOutput(undefined, 'abc')).toBeNull()
  })
})
