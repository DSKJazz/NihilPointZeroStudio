import { describe, expect, it } from 'vitest'
import { MAX_WAIT_MS, nextDelayMs, parseRetryAfter, RATE_LIMIT_FLOOR_MS, worthRetrying } from './retryPolicy'

const NOW = Date.parse('2026-08-02T03:00:00.000Z')

describe('parseRetryAfter', () => {
  it('reads a plain number of seconds', () => {
    expect(parseRetryAfter('7', NOW)).toBe(7000)
    expect(parseRetryAfter('  30  ', NOW)).toBe(30_000)
  })

  it('reads an HTTP date', () => {
    expect(parseRetryAfter('Sun, 02 Aug 2026 03:00:20 GMT', NOW)).toBe(20_000)
  })

  it('treats a date already past as "now", not a negative wait', () => {
    expect(parseRetryAfter('Sun, 02 Aug 2026 02:59:00 GMT', NOW)).toBe(0)
  })

  it('caps an absurd value rather than freezing the app for an hour', () => {
    expect(parseRetryAfter('99999', NOW)).toBe(MAX_WAIT_MS)
  })

  it('returns null for anything unparseable, so the known-sane curve is used', () => {
    for (const h of [null, undefined, '', '   ', 'soon', '-5', '3.5', 'tomorrow']) {
      expect(parseRetryAfter(h, NOW)).toBeNull()
    }
  })
})

describe('nextDelayMs', () => {
  it('THE BUG: obeys the service instead of guessing', () => {
    // We came back on our own curve, got 429 again, burned an attempt, and gave up while
    // the service was willing to answer seconds later. 45+ times in the user's log.
    expect(nextDelayMs({ attempt: 0, status: 429, retryAfter: '9', nowMs: NOW, random: 0.5 })).toBe(9000)
  })

  it('does NOT jitter a stated time', () => {
    // Random slop on a named time either wastes seconds or comes back early — the exact
    // failure this exists to fix.
    const a = nextDelayMs({ attempt: 3, status: 429, retryAfter: '9', nowMs: NOW, random: 0 })
    const b = nextDelayMs({ attempt: 3, status: 429, retryAfter: '9', nowMs: NOW, random: 1 })
    expect(a).toBe(b)
  })

  it('is more patient with a rate limit than a server error when no header is sent', () => {
    const limited = nextDelayMs({ attempt: 0, status: 429, nowMs: NOW, random: 0.5 })
    const broken = nextDelayMs({ attempt: 0, status: 500, nowMs: NOW, random: 0.5 })
    expect(limited).toBeGreaterThanOrEqual(RATE_LIMIT_FLOOR_MS)
    expect(limited).toBeGreaterThan(broken)
  })

  it('still backs off exponentially on its own curve', () => {
    const d = [0, 1, 2, 3].map((attempt) => nextDelayMs({ attempt, status: 500, nowMs: NOW, random: 0.5 }))
    expect(d[1]).toBeGreaterThan(d[0])
    expect(d[2]).toBeGreaterThan(d[1])
    expect(d[3]).toBeGreaterThan(d[2])
  })

  it('still jitters its own curve, so parallel scenes do not retry in lockstep', () => {
    const low = nextDelayMs({ attempt: 2, status: 500, nowMs: NOW, random: 0 })
    const high = nextDelayMs({ attempt: 2, status: 500, nowMs: NOW, random: 1 })
    expect(high).toBeGreaterThan(low)
  })

  it('never waits longer than the cap, whatever is thrown at it', () => {
    for (const attempt of [0, 5, 50, 500]) {
      for (const status of [429, 500, undefined]) {
        const ms = nextDelayMs({ attempt, status, nowMs: NOW, random: 1 })
        expect(ms).toBeLessThanOrEqual(MAX_WAIT_MS)
        expect(ms).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('worthRetrying', () => {
  it('retries rate limits and timeouts', () => {
    expect(worthRetrying(429)).toBe(true)
    expect(worthRetrying(408)).toBe(true)
  })

  it('retries server errors and network failures', () => {
    expect(worthRetrying(500)).toBe(true)
    expect(worthRetrying(503)).toBe(true)
    expect(worthRetrying(undefined)).toBe(true)
  })

  it('does NOT retry a request that will fail identically every time', () => {
    // A bad prompt or a withdrawn model says the same thing five times; retrying only
    // makes the user wait five times longer for the same error.
    for (const s of [400, 401, 402, 403, 404, 422]) {
      expect(worthRetrying(s)).toBe(false)
    }
  })
})
