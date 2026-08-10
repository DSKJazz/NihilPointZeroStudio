/**
 * The hole this fills: a tab crash was already caught, but an unhandled error in the main
 * process tore the app down with no message and no log line. From the outside the app
 * "just closed" — the only failure in the whole application that left no evidence.
 *
 * So the tests are about evidence: is it recorded, is it diagnosable a week later, and is
 * it kept out of the log when it is not actually a crash.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { describeCrash, installCrashReporting, isWorthRecording } from './crashReport'
import type { AiErrorEntry } from '../shared/types'

/**
 * A no-op listener kept installed for the whole file.
 *
 * Every test here emits a real `uncaughtException`, and that is safe only while something
 * of ours is listening. The moment ours is the last one removed, the emit reaches vitest's
 * own handler as the only listener and fails the entire run — which is exactly how this
 * file broke CI once. This guard makes that impossible regardless of test order.
 */
const guard = (): void => {}
beforeAll(() => process.on('uncaughtException', guard))
afterAll(() => {
  process.off('uncaughtException', guard)
})

const removers: (() => void)[] = []
afterEach(() => {
  while (removers.length) removers.pop()!()
})

function install(): { entries: AiErrorEntry[]; notices: string[]; fatals: number } {
  const state = { entries: [] as AiErrorEntry[], notices: [] as string[], fatals: 0 }
  removers.push(
    installCrashReporting({
      record: (e) => state.entries.push(e),
      notify: (m) => state.notices.push(m),
      onFatal: () => {
        state.fatals++
      }
    })
  )
  return state
}

describe('a crash leaves evidence', () => {
  it('records an unhandled exception, tells the user, and lets the process go', () => {
    const s = install()
    process.emit('uncaughtException', new Error('something broke badly'))
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0].message).toMatch(/^CRASH — something broke badly/)
    expect(s.notices[0]).toMatch(/has to close/)
    // After an unhandled exception the process state is unknown; carrying on risks
    // writing corrupted data over the user's work.
    expect(s.fatals).toBe(1)
  })

  it('records an unhandled rejection WITHOUT closing the app', () => {
    // A forgotten await on a background job should be investigated, not used as a reason
    // to shut the studio while somebody is working in it.
    const s = install()
    process.emit('unhandledRejection', new Error('a background job never finished'), Promise.resolve())
    expect(s.entries).toHaveLength(1)
    expect(s.fatals).toBe(0)
    expect(s.notices).toEqual([])
  })

  it('is diagnosable a week later — versions and platform, not just a message', () => {
    const entry = describeCrash('exception', new Error('boom'))
    expect(entry.body).toContain('platform:')
    expect(entry.body).toContain('node:')
    expect(entry.body).toContain('electron:')
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('marks itself clearly, so it stands out in a list of AI failures', () => {
    expect(describeCrash('exception', new Error('x')).message).toMatch(/^CRASH — /)
    expect(describeCrash('exception', new Error('x')).feature).toMatch(/the app itself/)
  })
})

describe('what it deliberately does NOT record', () => {
  it('ignores a user cancellation, which is not a crash', () => {
    // Filling Known Issues with the user's own Stop presses would bury the real failures.
    for (const m of ['Cancelled by you', 'render stopped by you', 'canceled']) {
      expect(isWorthRecording(new Error(m)), m).toBe(false)
    }
    const s = install()
    process.emit('uncaughtException', new Error('Cancelled by you'))
    expect(s.entries).toEqual([])
    expect(s.fatals).toBe(0)
  })

  it('ignores the pipe error a killed child process produces', () => {
    // The normal end of a cancelled ffmpeg.
    expect(isWorthRecording(new Error('write EPIPE'))).toBe(false)
    expect(isWorthRecording(new Error('read ECONNRESET'))).toBe(false)
  })

  it('records anything it does not recognise', () => {
    expect(isWorthRecording(new Error('a completely novel failure'))).toBe(true)
  })
})

describe('it never throws while handling a throw', () => {
  it('survives a non-Error being thrown', () => {
    const s = install()
    expect(() => process.emit('uncaughtException', 'a bare string' as unknown as Error)).not.toThrow()
    expect(s.entries[0].message).toContain('a bare string')
  })

  it('survives undefined, and an object with no message', () => {
    expect(describeCrash('exception', undefined).message).toContain('no error value')
    expect(() => describeCrash('exception', { weird: true })).not.toThrow()
    expect(describeCrash('exception', { weird: true }).message).toContain('weird')
  })

  it('survives a CIRCULAR object, which a thrown non-Error often is', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(() => describeCrash('exception', circular)).not.toThrow()
    expect(describeCrash('exception', circular).message).toContain('circular')
  })

  it('still exits when RECORDING itself fails — the log is not worth the app hanging on', () => {
    let fatals = 0
    const remove = installCrashReporting({
      record: () => {
        throw new Error('the log file is locked')
      },
      notify: () => {
        throw new Error('the window is already gone')
      },
      onFatal: () => {
        fatals++
      }
    })
    removers.push(remove)
    expect(() => process.emit('uncaughtException', new Error('boom'))).not.toThrow()
    expect(fatals).toBe(1)
  })

  it('caps a runaway message and stack rather than writing megabytes into the log', () => {
    const huge = new Error('x'.repeat(100_000))
    huge.stack = 'y'.repeat(500_000)
    const entry = describeCrash('exception', huge)
    expect(entry.message.length).toBeLessThanOrEqual(500)
    expect((entry.body ?? '').length).toBeLessThanOrEqual(8000)
  })
})

describe('the handlers can be removed', () => {
  it('records while installed, and is gone afterwards', () => {
    // Removal is asserted by the LISTENER BEING GONE, not by emitting another exception
    // after removing it. That was the original test and it broke CI: with our handler
    // removed, the emitted exception reaches vitest's own uncaughtException handler, which
    // correctly reports it as an unhandled error and fails the whole run. It passed
    // locally by luck of file ordering. Emitting while our handler IS installed is safe —
    // it absorbs it — which is what every other test in this file does.
    const entries: AiErrorEntry[] = []
    const exceptionsBefore = process.listenerCount('uncaughtException')
    const rejectionsBefore = process.listenerCount('unhandledRejection')

    const remove = installCrashReporting({ record: (e) => entries.push(e), onFatal: () => {} })
    expect(process.listenerCount('uncaughtException')).toBe(exceptionsBefore + 1)
    expect(process.listenerCount('unhandledRejection')).toBe(rejectionsBefore + 1)

    process.emit('uncaughtException', new Error('one'))
    expect(entries).toHaveLength(1)

    remove()
    // Both handlers go, and nothing else's listeners were disturbed.
    expect(process.listenerCount('uncaughtException')).toBe(exceptionsBefore)
    expect(process.listenerCount('unhandledRejection')).toBe(rejectionsBefore)
  })
})
