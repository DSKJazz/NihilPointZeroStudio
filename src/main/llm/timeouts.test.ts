import { describe, expect, it } from 'vitest'
import { CHOSEN_TIMEOUT_MS, FALLBACK_TIMEOUT_MS, OLLAMA_CHOSEN_TIMEOUT_MS } from './limits'
import {
  fallbackTimeoutMs,
  LOCAL_FALLBACK_FLOOR_MS,
  LOCAL_MS_PER_TOKEN,
  timeoutWasOurFault,
  waitNotice
} from './timeouts'

describe('fallbackTimeoutMs', () => {
  it('THE REPORTED BUG: a local model never gets the 90-second cloud leash', () => {
    // The user's screenshot: "Ollama did not respond within 2 minute(s)" on a CPU-only
    // machine. 90s was chosen for cloud backups; an 8B model cannot finish a long script
    // in it, ever. So this must be strictly more.
    const ms = fallbackTimeoutMs({ isLocal: true, isLastResort: false, expectedTokens: 2000 })
    expect(ms).toBeGreaterThan(FALLBACK_TIMEOUT_MS)
    expect(ms).toBeGreaterThanOrEqual(LOCAL_FALLBACK_FLOOR_MS)
  })

  it('gives the last provider standing the full allowance', () => {
    // Cutting off the only working brain converts "slow" into "failed" and buys nothing,
    // because there is no next provider to hurry towards.
    expect(fallbackTimeoutMs({ isLocal: true, isLastResort: true })).toBe(OLLAMA_CHOSEN_TIMEOUT_MS)
    expect(fallbackTimeoutMs({ isLocal: false, isLastResort: true })).toBe(CHOSEN_TIMEOUT_MS)
  })

  it('keeps a cloud backup on the short leash', () => {
    // A healthy cloud service answers in seconds; a slow one should be skipped quickly.
    expect(fallbackTimeoutMs({ isLocal: false, isLastResort: false, expectedTokens: 5000 })).toBe(FALLBACK_TIMEOUT_MS)
  })

  it('scales a local model with the size of the job', () => {
    const small = fallbackTimeoutMs({ isLocal: true, isLastResort: false, expectedTokens: 200 })
    // 2000 tokens is 16m40s — under the 20-minute ceiling, so the scaling is visible
    // rather than clamped. (4000 would hit the cap; that case is its own test below.)
    const large = fallbackTimeoutMs({ isLocal: true, isLastResort: false, expectedTokens: 2000 })
    expect(large).toBeGreaterThan(small)
    expect(large).toBe(2000 * LOCAL_MS_PER_TOKEN)
  })

  it('is never less patient than the behaviour it replaces', () => {
    // A "fix" that made anything time out SOONER would be a new bug in a fix's clothes.
    for (const isLocal of [true, false]) {
      for (const isLastResort of [true, false]) {
        for (const expectedTokens of [undefined, 0, -1, NaN, 1, 10_000_000]) {
          expect(fallbackTimeoutMs({ isLocal, isLastResort, expectedTokens })).toBeGreaterThanOrEqual(
            FALLBACK_TIMEOUT_MS
          )
        }
      }
    }
  })

  it('has an upper bound, so a silly token count cannot hang the app for a day', () => {
    expect(fallbackTimeoutMs({ isLocal: true, isLastResort: false, expectedTokens: 10_000_000 })).toBe(
      OLLAMA_CHOSEN_TIMEOUT_MS
    )
  })

  it('falls back to the floor when the token count is unusable', () => {
    for (const t of [undefined, 0, -5, NaN, Infinity]) {
      expect(fallbackTimeoutMs({ isLocal: true, isLastResort: false, expectedTokens: t })).toBe(
        LOCAL_FALLBACK_FLOOR_MS
      )
    }
  })
})

describe('waitNotice', () => {
  it('warns BEFORE the wait, not after the failure', () => {
    // The old behaviour said nothing for 90 seconds and then produced an error, which
    // reads as a broken app rather than a slow one.
    const ms = fallbackTimeoutMs({ isLocal: true, isLastResort: true })
    const note = waitNotice({ isLocal: true, isLastResort: true }, ms)
    expect(note).toMatch(/local AI/)
    expect(note).toMatch(/slow/)
    expect(note).toMatch(/20 minutes/)
  })

  it('says nothing for a cloud provider, which should be quick', () => {
    expect(waitNotice({ isLocal: false, isLastResort: false }, FALLBACK_TIMEOUT_MS)).toBeNull()
  })

  it('never says "0 minutes"', () => {
    expect(waitNotice({ isLocal: true, isLastResort: false }, 1000)).toMatch(/1 minute\b/)
  })
})

describe('timeoutWasOurFault', () => {
  it('admits it when a local model was cut off at the cloud number', () => {
    // "Try a shorter length" is advice that blames the user for a number we chose.
    expect(timeoutWasOurFault({ isLocal: true, isLastResort: false }, FALLBACK_TIMEOUT_MS)).toBe(true)
  })

  it('does not claim fault when the model had a real allowance and still failed', () => {
    expect(timeoutWasOurFault({ isLocal: true, isLastResort: true }, OLLAMA_CHOSEN_TIMEOUT_MS)).toBe(false)
  })

  it('is never our fault for a cloud provider on the short leash', () => {
    expect(timeoutWasOurFault({ isLocal: false, isLastResort: false }, FALLBACK_TIMEOUT_MS)).toBe(false)
  })
})
