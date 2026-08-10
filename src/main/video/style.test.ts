import { describe, expect, it } from 'vitest'
import { STYLE_THEMES, themeFor, buildFfmpegArgs, buildGradientSource, computeLayout, buildAudioFilter } from './render'
import { VIDEO_STYLES } from '../../shared/types'

describe('buildGradientSource', () => {
  it('builds an animated gradients lavfi source sized to the frame', () => {
    const src = buildGradientSource(STYLE_THEMES.neon, 1920, 1080, 12)
    expect(src.startsWith('gradients=s=1920x1080')).toBe(true)
    expect(src).toContain('c0=0x05010D')
    expect(src).toContain('speed=') // it moves
    expect(src).toContain(':d=12.00')
  })
})

describe('themeFor', () => {
  it('has a distinct theme for every declared style', () => {
    for (const s of VIDEO_STYLES) expect(STYLE_THEMES[s]).toBeDefined()
    expect(Object.keys(STYLE_THEMES).sort()).toEqual([...VIDEO_STYLES].sort())
  })

  it('defaults to cinematic for an unknown style', () => {
    // @ts-expect-error deliberately passing an invalid style
    expect(themeFor('nope')).toBe(STYLE_THEMES.cinematic)
    expect(themeFor()).toBe(STYLE_THEMES.cinematic)
  })
})

describe('buildAudioFilter waveColor', () => {
  const layout = computeLayout('1080p')
  it('defaults to the cinematic gold', () => {
    const plan = buildAudioFilter({ hasMusic: false, sfxTimesSec: [], dur: 10, layout })
    expect(plan.chains.join(';')).toContain('0xE8B923@0.85')
  })
  it('uses a custom wave color when provided', () => {
    const plan = buildAudioFilter({ hasMusic: false, sfxTimesSec: [], dur: 10, layout, waveColor: '0x39FF14@0.9' })
    expect(plan.chains.join(';')).toContain('0x39FF14@0.9')
  })
})

describe('buildFfmpegArgs background', () => {
  const layout = computeLayout('1080p')
  const common = {
    layout,
    dur: 5,
    audioPath: 'a.wav',
    sfxCount: 0,
    filter: '[0:v]null[v]',
    videoMap: '[v]',
    audioMap: '1:a',
    outPath: 'o.mp4'
  }

  it('defaults to a solid color lavfi source', () => {
    const args = buildFfmpegArgs(common)
    expect(args.join(' ')).toContain('color=c=0x0B0F1A')
  })

  it('uses a custom color when the background is a color spec', () => {
    const args = buildFfmpegArgs({ ...common, background: { kind: 'color', color: '0x05010D' } })
    expect(args.join(' ')).toContain('color=c=0x05010D')
  })

  it('uses a looped file input (no lavfi color) when the background is a file', () => {
    const args = buildFfmpegArgs({ ...common, background: { kind: 'file', path: 'bg.mp4' } })
    expect(args.join(' ')).not.toContain('color=c=')
    // First input is the background file, LOOPED: the output uses -shortest, so an
    // unlooped background shorter than the narration cut off the end of the video.
    expect(args.slice(0, 6)).toEqual(['-y', '-stream_loop', '-1', '-i', 'bg.mp4', '-i'])
  })

  it('uses a gradients lavfi source for an animated background', () => {
    const src = buildGradientSource(STYLE_THEMES.cinematic, 1920, 1080, 5)
    const args = buildFfmpegArgs({ ...common, background: { kind: 'animated', source: src } })
    expect(args.join(' ')).toContain('gradients=s=1920x1080')
    expect(args.join(' ')).not.toContain('color=c=')
  })
})
