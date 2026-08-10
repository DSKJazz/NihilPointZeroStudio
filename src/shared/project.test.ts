/**
 * The project file is the ONE thing that crosses from the phone into the studio, so
 * it is the one place a malformed or hostile file could reach the render pipeline.
 * These tests exist to prove it cannot: bad input is dropped and reported, never
 * silently trusted and never fatal to the user's other work.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUILD,
  MAX_ASSET_BYTES,
  PROJECT_FORMAT_VERSION,
  assetRef,
  base64Bytes,
  beatsNeedingMedia,
  frameSize,
  projectFileName,
  sanitizeBuild,
  sanitizeProject
} from './project'
import type { StoryboardDoc } from './types'

/** A minimal well-formed project, which individual tests then damage on purpose. */
function goodProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    title: 'The Rupee Trap',
    storyboard: {
      title: 'The Rupee Trap',
      style: 'noir',
      beats: [
        { durationSec: 8, visual: 'Karachi skyline at dawn', narration: 'Aaj hum baat karain ge.', motion: 'in' },
        { durationSec: 6, visual: 'A trading floor', caption: 'PSX', motion: 'left' }
      ]
    },
    build: { resolution: '1080p', aspect: '16:9', template: 'news', style: 'noir', narrationVoice: 'silent' },
    assets: [],
    ...over
  }
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='

describe('sanitizeProject — rejecting what is not a plan', () => {
  it('refuses non-objects', () => {
    for (const bad of [null, undefined, 42, 'a string', []]) {
      expect(() => sanitizeProject(bad)).toThrow(/not a NihilPointZero plan/i)
    }
  })

  it('refuses a file with no version marker', () => {
    expect(() => sanitizeProject({ title: 'x', storyboard: {} })).toThrow(/version marker/i)
  })

  it('refuses a plan from a NEWER app rather than guessing at it', () => {
    expect(() => sanitizeProject(goodProject({ formatVersion: 99 }))).toThrow(/newer version/i)
  })
})

describe('sanitizeProject — keeping good work', () => {
  it('keeps the storyboard and settings', () => {
    const { project, warnings } = sanitizeProject(goodProject())
    expect(warnings).toEqual([])
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION)
    expect(project.title).toBe('The Rupee Trap')
    expect(project.storyboard.beats).toHaveLength(2)
    expect(project.storyboard.beats[0].narration).toBe('Aaj hum baat karain ge.')
    expect(project.build.template).toBe('news')
  })

  it('sizes the storyboard frame from the chosen resolution and aspect', () => {
    const { project } = sanitizeProject(
      goodProject({ build: { resolution: '4k', aspect: '9:16', style: 'cinematic' } })
    )
    expect(project.storyboard.width).toBe(2160)
    expect(project.storyboard.height).toBe(3840)
  })

  it('lets the build screen win over the storyboard for style', () => {
    // Two places can carry a style; the one the user actually set must be used, or
    // the phone preview and the PC render would disagree.
    const { project } = sanitizeProject(
      goodProject({ build: { style: 'anime', resolution: '1080p', aspect: '16:9' } })
    )
    expect(project.storyboard.style).toBe('anime')
  })

  it('falls back to safe defaults for nonsense settings', () => {
    const { project } = sanitizeProject(
      goodProject({ build: { resolution: '16k', aspect: 'triangle', template: 'zzz', narrationVoice: 'elvis' } })
    )
    expect(project.build.resolution).toBe(DEFAULT_BUILD.resolution)
    expect(project.build.aspect).toBe(DEFAULT_BUILD.aspect)
    expect(project.build.template).toBe(DEFAULT_BUILD.template)
    expect(project.build.narrationVoice).toBe(DEFAULT_BUILD.narrationVoice)
  })

  it('carries the script across when there is one', () => {
    const { project } = sanitizeProject(goodProject({ script: { title: 'T', body: 'Full script body' } }))
    expect(project.script?.body).toBe('Full script body')
  })

  it('drops an empty script rather than carrying a hollow one', () => {
    const { project } = sanitizeProject(goodProject({ script: { title: 'T', body: '   ' } }))
    expect(project.script).toBeUndefined()
  })
})

describe('sanitizeProject — attachments', () => {
  it('keeps a valid photo', () => {
    const { project, warnings } = sanitizeProject(
      goodProject({ assets: [{ id: 'a1', kind: 'photo', mime: 'image/png', data: PNG_B64, name: 'me.png' }] })
    )
    expect(warnings).toEqual([])
    expect(project.assets).toHaveLength(1)
    expect(project.assets[0].id).toBe('a1')
  })

  it('drops a disguised executable and says so', () => {
    const { project, warnings } = sanitizeProject(
      goodProject({ assets: [{ id: 'a1', kind: 'photo', mime: 'application/x-msdownload', data: PNG_B64, name: 'x.exe' }] })
    )
    expect(project.assets).toHaveLength(0)
    expect(warnings.join(' ')).toMatch(/not a file type/i)
  })

  it('drops an oversized attachment', () => {
    const huge = 'A'.repeat(Math.ceil((MAX_ASSET_BYTES + 1024) / 3) * 4)
    const { project, warnings } = sanitizeProject(
      goodProject({ assets: [{ id: 'a1', kind: 'clip', mime: 'video/mp4', data: huge, name: 'big.mp4' }] })
    )
    expect(project.assets).toHaveLength(0)
    expect(warnings.join(' ')).toMatch(/larger than/i)
  })

  it('drops data that is not really base64', () => {
    const { project, warnings } = sanitizeProject(
      goodProject({ assets: [{ id: 'a1', kind: 'photo', mime: 'image/png', data: '<<not base64>>' }] })
    )
    expect(project.assets).toHaveLength(0)
    expect(warnings.join(' ')).toMatch(/damaged/i)
  })

  it('drops duplicate ids so a reference can never be ambiguous', () => {
    const { project, warnings } = sanitizeProject(
      goodProject({
        assets: [
          { id: 'same', kind: 'photo', mime: 'image/png', data: PNG_B64 },
          { id: 'same', kind: 'photo', mime: 'image/png', data: PNG_B64 }
        ]
      })
    )
    expect(project.assets).toHaveLength(1)
    expect(warnings.join(' ')).toMatch(/duplicate/i)
  })
})

describe('sanitizeProject — dangling references', () => {
  it('clears a beat photo whose attachment did not arrive, and keeps the beat', () => {
    const p = goodProject()
    ;(p.storyboard as Record<string, unknown>).beats = [
      { durationSec: 5, visual: 'Me in the studio', subject: { kind: 'photo', src: assetRef('missing') } }
    ]
    const { project, warnings } = sanitizeProject(p)
    expect(project.storyboard.beats).toHaveLength(1)
    expect(project.storyboard.beats[0].subject.kind).toBe('photo')
    expect(project.storyboard.beats[0].subject.src).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/pick one on this PC/i)
  })

  it('drops a beat sound whose recording did not arrive', () => {
    const p = goodProject()
    ;(p.storyboard as Record<string, unknown>).beats = [
      {
        durationSec: 5,
        visual: 'A scene',
        sounds: [
          { id: 's1', kind: 'file', src: assetRef('gone') },
          { id: 's2', kind: 'music', ref: 'calm' }
        ]
      }
    ]
    const { project, warnings } = sanitizeProject(p)
    expect(project.storyboard.beats[0].sounds?.map((s) => s.kind)).toEqual(['music'])
    expect(warnings.join(' ')).toMatch(/did not arrive/i)
  })

  it('keeps a reference whose attachment DID arrive', () => {
    const p = goodProject({ assets: [{ id: 'photo1', kind: 'photo', mime: 'image/jpeg', data: PNG_B64 }] })
    ;(p.storyboard as Record<string, unknown>).beats = [
      { durationSec: 5, visual: 'Me', subject: { kind: 'photo', src: assetRef('photo1') } }
    ]
    const { project, warnings } = sanitizeProject(p)
    expect(project.storyboard.beats[0].subject.src).toBe('asset:photo1')
    expect(warnings).toEqual([])
  })
})

describe('helpers', () => {
  it('frameSize covers every aspect', () => {
    expect(frameSize('1080p', '16:9')).toEqual({ width: 1920, height: 1080 })
    expect(frameSize('1080p', '9:16')).toEqual({ width: 1080, height: 1920 })
    expect(frameSize('1080p', '1:1')).toEqual({ width: 1080, height: 1080 })
  })

  it('base64Bytes accounts for padding', () => {
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('AAA=')).toBe(2)
    expect(base64Bytes('AA==')).toBe(1)
  })

  it('sanitizeBuild works on completely absent input', () => {
    expect(sanitizeBuild(undefined)).toEqual(DEFAULT_BUILD)
  })

  it('beatsNeedingMedia finds only the unfilled ones', () => {
    const doc = {
      title: 't',
      style: 'cinematic',
      width: 1920,
      height: 1080,
      fps: 30,
      beats: [
        { id: 'b1', durationSec: 5, visual: 'need a photo', subject: { kind: 'photo' } },
        { id: 'b2', durationSec: 5, visual: 'already has one', subject: { kind: 'photo', src: 'C:/me.jpg' } },
        { id: 'b3', durationSec: 5, visual: 'scene only', subject: { kind: 'none' } },
        { id: 'b4', durationSec: 5, visual: 'need a clip', subject: { kind: 'clip' } }
      ]
    } as StoryboardDoc
    expect(beatsNeedingMedia(doc)).toEqual([
      { index: 0, kind: 'photo', visual: 'need a photo' },
      { index: 3, kind: 'clip', visual: 'need a clip' }
    ])
  })

  it('projectFileName strips characters a filesystem would reject', () => {
    expect(projectFileName('Rupee: the "trap"/ 2026')).toBe('Rupee-the-trap-2026.npzproject.json')
    expect(projectFileName('')).toBe('plan.npzproject.json')
    expect(projectFileName('////')).toBe('plan.npzproject.json')
  })
})
