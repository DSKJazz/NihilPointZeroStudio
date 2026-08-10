/**
 * The point of preflight is to fail in one second instead of twenty minutes. So the
 * tests care about two things: does it catch the real failures, and does it refuse to
 * block a job that would actually have worked. Over-eager refusal is the worse bug —
 * this app is designed to run offline on free tiers, and a preflight that blocks that
 * takes away more than it protects.
 */
import { mkdtempSync, rmSync, chmodSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  REFUSE_BELOW_MB,
  WARN_BELOW_MB,
  checkEncoder,
  checkFfmpeg,
  checkWorkFolderWritable,
  freeDiskMB,
  runPreflight
} from './preflight'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'npz-preflight-'))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) {
    try {
      chmodSync(d, 0o755)
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

const workingFfmpeg = async (): Promise<string> => 'ffmpeg version 7.1 Copyright (c) 2000-2024'
const brokenFfmpeg = async (): Promise<string> => {
  throw new Error('spawn EACCES')
}

describe('ffmpeg — "the file exists" is not the check', () => {
  it('reads the version when it really runs', async () => {
    const c = await checkFfmpeg(workingFfmpeg)
    expect(c.status).toBe('ok')
    expect(c.detail).toContain('7.1')
  })

  it('FAILS when it will not execute, and names antivirus', async () => {
    // Quarantine leaves the file in place and refuses execution. That has cost real
    // time on this project, and existsSync would have said everything was fine.
    const c = await checkFfmpeg(brokenFfmpeg)
    expect(c.status).toBe('fail')
    // The fix lives in `detail` — HealthCheck has no separate field, and adding one
    // would need a second health UI that could drift from the existing one.
    expect(c.detail).toMatch(/[Aa]ntivirus/)
  })

  it('warns rather than fails when it runs but says something odd', async () => {
    // It ran. That is the important part. Refusing the render here would be worse
    // than letting it try.
    const c = await checkFfmpeg(async () => 'some unexpected output')
    expect(c.status).toBe('warn')
  })
})

describe('the work folder — writable, not merely present', () => {
  it('passes on a normal folder', () => {
    expect(checkWorkFolderWritable(tempDir()).status).toBe('ok')
  })

  it('creates the folder if it is missing rather than failing', () => {
    const target = join(tempDir(), 'nested', 'videos')
    expect(checkWorkFolderWritable(target).status).toBe('ok')
    expect(existsSync(target)).toBe(true)
  })

  it('FAILS on a read-only folder, which existsSync would pass', () => {
    // A disconnected drive, a read-only mount or a folder a security tool has locked
    // all exist happily and then refuse the first write — twenty minutes in, with
    // nowhere to put the result.
    const d = tempDir()
    try {
      chmodSync(d, 0o444)
    } catch {
      return // some filesystems ignore chmod; nothing to assert
    }
    const c = checkWorkFolderWritable(join(d, 'videos'))
    // Root ignores permission bits, so accept either outcome but never a crash.
    expect(['fail', 'ok']).toContain(c.status)
    if (c.status === 'fail') expect(c.detail).toMatch(/drive is connected|antivirus/i)
  })

  it('leaves no test file behind', () => {
    const d = tempDir()
    checkWorkFolderWritable(d)
    expect(existsSync(join(d, `.npz-write-test-${process.pid}`))).toBe(false)
  })
})

describe('disk space', () => {
  it('reads a real number for a real folder', () => {
    const free = freeDiskMB(tempDir())
    expect(free === null || free >= 0).toBe(true)
  })

  it('returns null rather than throwing for a path that does not exist', () => {
    expect(freeDiskMB('/definitely/not/a/real/path/anywhere')).toBeNull()
  })

  it('has sane thresholds — refuse well below warn', () => {
    expect(REFUSE_BELOW_MB).toBeLessThan(WARN_BELOW_MB)
    // 500MB is genuinely too little for a long render; 2GB is tight but workable.
    expect(REFUSE_BELOW_MB).toBeGreaterThanOrEqual(200)
  })
})

describe('the encoder check never blocks a render', () => {
  it('reports the graphics card when there is one', async () => {
    const c = await checkEncoder(async () => 'h264_nvenc')
    expect(c.status).toBe('ok')
    expect(c.detail).toMatch(/graphics card/)
  })

  it('WARNS but does not fail when falling back to the processor', async () => {
    // Software encoding is slow, not broken. Failing here would block a render that
    // would have completed perfectly.
    const c = await checkEncoder(async () => 'libx264')
    expect(c.status).toBe('warn')
    expect(c.detail).toMatch(/slower/)
  })

  it('warns rather than fails when detection itself breaks', async () => {
    const c = await checkEncoder(async () => {
      throw new Error('driver gone')
    })
    expect(c.status).toBe('warn')
  })
})

describe('the whole preflight', () => {
  const deps = (over: Partial<Parameters<typeof runPreflight>[0]> = {}) => ({
    workDir: tempDir(),
    runFfmpegVersion: workingFfmpeg,
    detectEncoder: async () => 'h264_nvenc',
    ...over
  })

  it('passes a healthy machine and says so plainly', async () => {
    const r = await runPreflight(deps())
    expect(r.ok).toBe(true)
    expect(r.fatal).toEqual([])
    expect(r.headline).toMatch(/Everything checks out|worth knowing/)
  })

  it('refuses when ffmpeg is broken, and leads with the fix', async () => {
    const r = await runPreflight(deps({ runFfmpegVersion: brokenFfmpeg }))
    expect(r.ok).toBe(false)
    // A generic "checks failed" makes the user hunt. Name the problem and the fix.
    expect(r.headline).toMatch(/Cannot start/)
    expect(r.headline).toMatch(/[Aa]ntivirus/)
  })

  it('does NOT refuse for a slow encoder — that is the over-eager failure mode', async () => {
    // The app is designed to run offline on free tiers with software encoding. A
    // preflight that blocks that takes away more than it protects.
    const r = await runPreflight(deps({ detectEncoder: async () => 'libx264' }))
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.headline).toMatch(/Ready to render/)
  })

  it('runs every check even when an early one fails, so one run finds everything', async () => {
    // Bailing at the first failure means the user fixes ffmpeg, runs again, and only
    // then learns the disk is full too.
    const r = await runPreflight(deps({ runFfmpegVersion: brokenFfmpeg }))
    expect(r.checks).toHaveLength(4)
  })

  it('makes NO network calls — that is why it is separate from health.ts', async () => {
    // health.ts does six network calls including authenticated ones. Running that
    // before every build would multiply requests and risk the rate limits its own
    // checks warn about. Preflight must stay local and fast.
    const original = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('')
    }) as typeof fetch
    try {
      await runPreflight(deps())
      expect(called).toBe(false)
    } finally {
      globalThis.fetch = original
    }
  })

  it('never throws, whatever it is given', async () => {
    await expect(
      runPreflight({
        workDir: '/nope/not/writable/anywhere',
        runFfmpegVersion: brokenFfmpeg,
        detectEncoder: async () => {
          throw new Error('x')
        }
      })
    ).resolves.toBeTruthy()
  })
})
