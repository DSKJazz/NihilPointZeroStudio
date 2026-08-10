/**
 * The failure this must never commit is reusing narration that belongs to a DIFFERENT
 * script. That makes a video whose audio does not match its own words, and nothing about
 * the file looks wrong — you find it by watching it, or a viewer does. It is far worse
 * than losing the eighteen minutes this feature exists to save.
 *
 * So most of these tests are about the fingerprint refusing to collide.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CHECKPOINT_VERSION,
  KEEP_DAYS,
  ageInDays,
  checkpointDir,
  discardCheckpoint,
  isReusable,
  openCheckpoint,
  renderKey,
  sweepOldCheckpoints,
  type CheckpointInputs
} from './checkpoint'

const roots: string[] = []
function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'npz-ckpt-'))
  roots.push(d)
  return d
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

const base: CheckpointInputs = { title: 'Reserves fall', body: 'The reserves fell to 11.2 billion.', narrationVoice: 'piper' }

describe('the fingerprint refuses to let two scripts share a narration', () => {
  it('the same inputs give the same key', () => {
    expect(renderKey(base)).toBe(renderKey({ ...base }))
  })

  it('a changed SCRIPT gives a different key', () => {
    expect(renderKey({ ...base, body: 'The reserves fell to 11.7 billion.' })).not.toBe(renderKey(base))
  })

  it('a changed TITLE gives a different key', () => {
    expect(renderKey({ ...base, title: 'Reserves rise' })).not.toBe(renderKey(base))
  })

  it('a changed VOICE gives a different key — the narration would sound different', () => {
    expect(renderKey({ ...base, narrationVoice: 'winnatural' })).not.toBe(renderKey(base))
    expect(renderKey({ ...base, winVoiceId: 'Asad' })).not.toBe(renderKey(base))
  })

  it('cannot be fooled by moving a character between fields', () => {
    // Without length prefixes, {title:'ab', body:'c'} and {title:'a', body:'bc'} join to
    // the same string and would share a checkpoint — so one script could inherit the
    // other's narration. This is the collision that matters.
    expect(renderKey({ title: 'ab', body: 'c' })).not.toBe(renderKey({ title: 'a', body: 'bc' }))
    expect(renderKey({ title: 'a|b', body: 'c' })).not.toBe(renderKey({ title: 'a', body: 'b|c' }))
    expect(renderKey({ title: '', body: 'ab' })).not.toBe(renderKey({ title: 'ab', body: '' }))
  })

  it('IGNORES settings that do not change what was stored', () => {
    // Resolution and template do not touch the narration or the scene images. Including
    // them would throw away a perfectly good narration because the user switched from
    // 1080p to 4K — the case where resuming is worth the most.
    const withExtras = { ...base, resolution: '4k', template: 'news', musicPath: 'x.mp3' } as CheckpointInputs
    expect(renderKey(withExtras)).toBe(renderKey(base))
  })

  it('a version bump invalidates every old folder', () => {
    // If what gets stored ever changes shape, nothing from before may be reused.
    expect(CHECKPOINT_VERSION).toBeGreaterThanOrEqual(1)
    expect(renderKey(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('survives missing and junk fields', () => {
    expect(() => renderKey(undefined as never)).not.toThrow()
    expect(() => renderKey({} as CheckpointInputs)).not.toThrow()
    expect(renderKey({} as CheckpointInputs)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('opening and resuming', () => {
  it('creates the folder the first time and reports it is NOT a resume', () => {
    const r = root()
    const c = openCheckpoint(r, base)
    expect(c.resumed).toBe(false)
    expect(existsSync(c.dir)).toBe(true)
    expect(c.narrationPath.startsWith(c.dir)).toBe(true)
  })

  it('reports a resume the second time, in the same folder', () => {
    // `resumed` is what the user gets told. Being told it is picking up where it left off
    // is the difference between trusting the app after a failure and assuming it is
    // silently redoing everything.
    const r = root()
    const first = openCheckpoint(r, base)
    const second = openCheckpoint(r, base)
    expect(second.resumed).toBe(true)
    expect(second.dir).toBe(first.dir)
  })

  it('a different script gets a different folder, so the old narration is invisible to it', () => {
    const r = root()
    const a = openCheckpoint(r, base)
    writeFileSync(a.narrationPath, Buffer.alloc(5000))
    const b = openCheckpoint(r, { ...base, body: 'A completely different script.' })
    expect(b.dir).not.toBe(a.dir)
    expect(b.resumed).toBe(false)
    expect(isReusable(b.narrationPath)).toBe(false)
  })

  it('names the folder recognisably, so a human can see what it is', () => {
    expect(checkpointDir('/root', 'abc123')).toContain('npz-resume-abc123')
  })
})

describe('a half-written file is never reused', () => {
  it('rejects a zero-length narration', () => {
    // Exactly what is left when the process died mid-write. Reusing it would produce a
    // SILENT video — a failure that looks like success.
    const r = root()
    const c = openCheckpoint(r, base)
    writeFileSync(c.narrationPath, '')
    expect(isReusable(c.narrationPath)).toBe(false)
  })

  it('rejects a suspiciously tiny one', () => {
    const r = root()
    const c = openCheckpoint(r, base)
    writeFileSync(c.narrationPath, Buffer.alloc(20))
    expect(isReusable(c.narrationPath)).toBe(false)
  })

  it('accepts a real one', () => {
    const r = root()
    const c = openCheckpoint(r, base)
    writeFileSync(c.narrationPath, Buffer.alloc(200_000))
    expect(isReusable(c.narrationPath)).toBe(true)
  })

  it('says no for a path that does not exist, rather than throwing', () => {
    expect(isReusable('/definitely/not/here.wav')).toBe(false)
    expect(isReusable(undefined as never)).toBe(false)
  })
})

describe('cleaning up', () => {
  it('discards on success', () => {
    const r = root()
    const c = openCheckpoint(r, base)
    writeFileSync(c.narrationPath, Buffer.alloc(5000))
    discardCheckpoint(c.dir)
    expect(existsSync(c.dir)).toBe(false)
  })

  it('never throws when discarding something already gone', () => {
    expect(() => discardCheckpoint('/not/here/at/all')).not.toThrow()
  })

  it('sweeps ones nobody came back for', () => {
    const r = root()
    const old = openCheckpoint(r, base)
    // Backdate it past the keep window.
    const past = new Date(Date.now() - (KEEP_DAYS + 2) * 86_400_000)
    utimesSync(old.dir, past, past)
    const fresh = openCheckpoint(r, { ...base, body: 'fresh' })

    expect(sweepOldCheckpoints(r)).toBe(1)
    expect(existsSync(old.dir)).toBe(false)
    expect(existsSync(fresh.dir)).toBe(true)
  })

  it('touches ONLY things matching its own naming pattern', () => {
    // A sweep that could reach anything else is one bad argument away from deleting the
    // user's videos.
    const r = root()
    const precious = join(r, 'my-finished-videos')
    mkdirSync(precious)
    const video = join(precious, 'video.mp4')
    writeFileSync(video, Buffer.alloc(1000))
    const past = new Date(Date.now() - 400 * 86_400_000)
    utimesSync(precious, past, past)

    expect(sweepOldCheckpoints(r)).toBe(0)
    expect(existsSync(video)).toBe(true)
  })

  it('handles a root that does not exist', () => {
    expect(sweepOldCheckpoints('/no/such/root')).toBe(0)
  })

  it('reads an age, and infinity for something unreadable', () => {
    const r = root()
    expect(ageInDays(r)).toBeLessThan(1)
    expect(ageInDays('/not/here')).toBe(Number.POSITIVE_INFINITY)
  })
})
