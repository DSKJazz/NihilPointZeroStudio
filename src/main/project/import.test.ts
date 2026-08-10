/**
 * Importing a plan made on the phone.
 *
 * The most valuable test here is the ROUND TRIP: a plan built with the phone's own
 * planning functions, imported by this code, then compiled by the studio's real
 * `compileStoryboardToTimeline`. That is the whole promise of the feature — plan on
 * the phone, render on the PC — and it either holds end to end or it does not.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const assetsDir = mkdtempSync(join(tmpdir(), 'npz-phone-assets-'))
const drafts = new Map<string, unknown>()
const activity: string[] = []

vi.mock('../store', () => ({
  phoneAssetsDir: () => assetsDir,
  setDraft: (key: string, value: unknown) => drafts.set(key, value),
  logActivity: (_actor: string, action: string) => activity.push(action)
}))

import { importPhoneProject, importPhoneProjectJson, STORYBOARD_DRAFT_KEY } from './import'
import { compileStoryboardToTimeline, storyboardFromScript, sanitizeStoryboard } from '../../shared/storyboard'
import { DEFAULT_BUILD, PROJECT_FORMAT_VERSION, assetRef } from '../../shared/project'
import type { PhoneProject } from '../../shared/project'

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function plan(over: Partial<PhoneProject> = {}): PhoneProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    createdAt: '2026-08-01T00:00:00.000Z',
    title: 'The Rupee Trap',
    storyboard: sanitizeStoryboard(
      {
        title: 'The Rupee Trap',
        style: 'noir',
        beats: [
          { durationSec: 8, visual: 'Karachi skyline at dawn', narration: 'Aaj hum baat karain ge.' },
          { durationSec: 6, visual: 'A trading floor', caption: 'PSX' }
        ]
      },
      { width: 1920, height: 1080, fps: 30 }
    ),
    build: { ...DEFAULT_BUILD, style: 'noir' },
    assets: [],
    ...over
  }
}

beforeEach(() => {
  drafts.clear()
  activity.length = 0
  // Recreate rather than tear down per test: several tests write attachments here,
  // and removing it between them made the suite order-dependent.
  mkdirSync(assetsDir, { recursive: true })
})

afterAll(() => {
  rmSync(assetsDir, { recursive: true, force: true })
})

describe('importPhoneProject', () => {
  it('reports what arrived', () => {
    const r = importPhoneProject(plan())
    expect(r.title).toBe('The Rupee Trap')
    expect(r.scenes).toBe(2)
    expect(r.seconds).toBe(14)
    expect(r.warnings).toEqual([])
    expect(r.style).toBe('noir')
  })

  it('hands the storyboard to the tab in the shape that tab restores', () => {
    importPhoneProject(plan())
    const draft = drafts.get(STORYBOARD_DRAFT_KEY) as Record<string, unknown>
    // These key names are the contract with StoryboardPage's useAutosave.
    for (const key of ['mode', 'title', 'brief', 'language', 'resKey', 'fps', 'totalSeconds', 'style', 'beats', 'photoPath', 'beautifyStrength']) {
      expect(draft, `draft must carry ${key}`).toHaveProperty(key)
    }
    expect(Array.isArray(draft.beats)).toBe(true)
  })

  it('maps the phone aspect onto the tab resolution keys', () => {
    expect(importPhoneProject(plan({ build: { ...DEFAULT_BUILD, aspect: '9:16' } })).resKey).toBe('9:16 (Shorts)')
    expect(importPhoneProject(plan({ build: { ...DEFAULT_BUILD, aspect: '1:1' } })).resKey).toBe('1:1')
    expect(importPhoneProject(plan()).resKey).toBe('1080p')
  })

  it('records the import in the activity log', () => {
    importPhoneProject(plan())
    expect(activity.join(' ')).toMatch(/Imported a plan made on the phone/i)
  })

  it('carries the script over so the PC has it for narration', () => {
    const r = importPhoneProject(plan({ script: { title: 'T', body: 'The full script' } }))
    expect(r.script?.body).toBe('The full script')
    expect((drafts.get(STORYBOARD_DRAFT_KEY) as { brief: string }).brief).toBe('The full script')
  })
})

describe('attachments', () => {
  it('writes an attached photo to disk and points the beat at the real file', () => {
    const p = plan({ assets: [{ id: 'p1', kind: 'photo', mime: 'image/png', data: PNG_B64, name: 'me.png' }] })
    p.storyboard.beats[0].subject = { kind: 'photo', src: assetRef('p1') }

    const r = importPhoneProject(p)
    expect(r.writtenAssets).toBe(1)
    const src = r.storyboardBeats[0].subject.src as string
    expect(src.startsWith(assetsDir)).toBe(true)
    expect(existsSync(src)).toBe(true)
    // The bytes must survive the base64 round trip intact.
    expect(readFileSync(src)).toEqual(Buffer.from(PNG_B64, 'base64'))
    expect(r.photoPath).toBe(src)
  })

  it('picks the extension from the validated mime type, never the filename', () => {
    // A plan claiming "me.exe" must not produce an .exe on the user's disk.
    const p = plan({ assets: [{ id: 'p1', kind: 'photo', mime: 'image/png', data: PNG_B64, name: 'me.exe' }] })
    p.storyboard.beats[0].subject = { kind: 'photo', src: assetRef('p1') }
    const src = importPhoneProject(p).storyboardBeats[0].subject.src as string
    expect(src.endsWith('.png')).toBe(true)
    expect(src.endsWith('.exe')).toBe(false)
  })

  it('resolves a recorded narration into a playable file path', () => {
    const p = plan({ assets: [{ id: 'a1', kind: 'audio', mime: 'audio/webm;codecs=opus', data: PNG_B64 }] })
    p.storyboard.beats[0].sounds = [{ id: 's1', kind: 'file', src: assetRef('a1'), gain: 1 }]
    const r = importPhoneProject(p)
    const sound = r.storyboardBeats[0].sounds?.[0]
    expect(sound?.kind).toBe('file')
    expect(existsSync(sound?.src as string)).toBe(true)
    expect((sound?.src as string).endsWith('.webm')).toBe(true)
  })

  it('leaves a "photo goes here" beat unfilled and lists it for the PC', () => {
    const p = plan()
    p.storyboard.beats[0].subject = { kind: 'photo' }
    const r = importPhoneProject(p)
    expect(r.storyboardBeats[0].subject.src).toBeUndefined()
    expect(r.needMedia).toEqual([{ index: 0, kind: 'photo', visual: 'Karachi skyline at dawn' }])
  })

  it('keeps music and sfx sounds, which need no files at all', () => {
    const p = plan()
    p.storyboard.beats[0].sounds = [
      { id: 's1', kind: 'music', ref: 'tense', gain: 0.35 },
      { id: 's2', kind: 'sfx', ref: 'riser', gain: 1 }
    ]
    const r = importPhoneProject(p)
    expect(r.storyboardBeats[0].sounds?.map((s) => s.ref)).toEqual(['tense', 'riser'])
  })
})

describe('bad input', () => {
  it('refuses a file that is not a plan', () => {
    expect(() => importPhoneProjectJson('not json at all')).toThrow(/not readable/i)
    expect(() => importPhoneProjectJson('{"hello":1}')).toThrow(/not a NihilPointZero plan/i)
  })

  it('imports a damaged plan as far as it can, and reports what was lost', () => {
    const p = plan({ assets: [{ id: 'p1', kind: 'photo', mime: 'application/x-msdownload', data: PNG_B64, name: 'x.exe' }] })
    p.storyboard.beats[0].subject = { kind: 'photo', src: assetRef('p1') }
    const r = importPhoneProject(p)
    // The user's two scenes still arrive; only the bad attachment is refused.
    expect(r.scenes).toBe(2)
    expect(r.writtenAssets).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/not a file type/i)
    expect(r.needMedia).toHaveLength(1)
  })

  it('never leaves a "file" sound pointing at nothing', () => {
    const p = plan()
    p.storyboard.beats[0].sounds = [{ id: 's1', kind: 'file', src: assetRef('missing'), gain: 1 }]
    const r = importPhoneProject(p)
    expect(r.storyboardBeats[0].sounds).toEqual([])
  })
})

describe('round trip: planned on the phone, rendered on the PC', () => {
  it('a phone-planned storyboard compiles onto the real timeline engine', () => {
    // 1. The phone builds a storyboard from a script, exactly as its offline route does.
    const raw = storyboardFromScript({
      title: 'The Rupee Trap',
      brief:
        'The rupee has lost more value in five years than in the previous twenty. ' +
        'Most people blame one government, and that answer is wrong. ' +
        'The real mechanism is the current account deficit working quietly. ' +
        'Every imported barrel is paid for in dollars, so demand for dollars rises.',
      language: 'Roman Urdu'
    })
    const storyboard = sanitizeStoryboard(raw, { width: 1920, height: 1080, fps: 30 })
    expect(storyboard.beats.length).toBeGreaterThan(1)

    // 2. It travels as JSON, exactly as the file would.
    const onTheWire = JSON.stringify({
      formatVersion: PROJECT_FORMAT_VERSION,
      createdAt: '2026-08-01T00:00:00.000Z',
      title: 'The Rupee Trap',
      storyboard,
      build: { ...DEFAULT_BUILD, style: 'noir' },
      assets: [{ id: 'p1', kind: 'photo', mime: 'image/png', data: PNG_B64, name: 'me.png' }]
    } satisfies PhoneProject)

    // 3. The PC imports it.
    const imported = importPhoneProjectJson(onTheWire)
    expect(imported.warnings).toEqual([])
    expect(imported.scenes).toBe(storyboard.beats.length)

    // 4. And the studio's REAL compiler turns it into a renderable timeline. The
    //    renderer would have produced one clip per beat by this point; stand those in
    //    so the compile exercises the actual placement/timing code.
    const doc = { ...storyboard, beats: imported.storyboardBeats }
    const rendered = Object.fromEntries(doc.beats.map((b) => [b.id, { clipPath: `/tmp/${b.id}.mp4` }]))
    const timeline = compileStoryboardToTimeline(doc, rendered)

    expect(timeline.video).toHaveLength(doc.beats.length)
    expect(timeline.width).toBe(1920)
    expect(timeline.fps).toBe(30)
    // Every beat must land on the timeline with real time on screen.
    for (const clip of timeline.video) expect(clip.outSec).toBeGreaterThan(clip.inSec)
  })
})
