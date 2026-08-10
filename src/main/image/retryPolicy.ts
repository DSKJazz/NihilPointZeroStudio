/**
 * When a busy service TELLS you when to come back, listen.
 *
 * WHAT WAS ACTUALLY WRONG. The image retry already backed off exponentially with jitter —
 * that part was fine, and an earlier diagnosis of mine that called it "five fast retries"
 * was simply wrong. The real gap is narrower and more embarrassing: a 429 usually carries
 * a `Retry-After` header, which is the service stating precisely when it will serve you
 * again. We ignored it and used our own curve instead, so we came back too early, got 429
 * again, burned an attempt, and gave up while the service was still perfectly willing to
 * answer a few seconds later. The user's log shows this 45+ times.
 *
 * Guessing when a service is ready, while it is actively telling you, is the whole bug.
 *
 * THE OTHER HALF: a 429 is not a 500. A rate limit means "you are early", and the right
 * response is to wait longer. A server error means "something broke", and a quick retry is
 * reasonable. Treating them identically means being too impatient with the first and too
 * patient with the second.
 *
 * This is also the sanctioned way to get more from a free service. The user asked whether
 * we could rotate identities to slip past the limit; that was declined. Honouring
 * `Retry-After` is the opposite approach and it genuinely works better, because the
 * service stops treating you as abusive.
 *
 * Pure and tested.
 */

/** Never wait longer than this for one attempt, however insistent the header. */
export const MAX_WAIT_MS = 60_000
/** A rate limit with no header still deserves more patience than a server error. */
export const RATE_LIMIT_FLOOR_MS = 5_000

/**
 * Seconds from a `Retry-After` header, in milliseconds. Handles both forms the spec
 * allows: a delay in seconds, and an HTTP date.
 *
 * Returns null for anything unparseable rather than guessing — a wrong wait is worse than
 * falling back to our own curve, which at least is known to be sane.
 */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (typeof header !== 'string') return null
  const raw = header.trim()
  if (!raw) return null

  // Form 1: a plain number of seconds.
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000
    return Number.isFinite(ms) ? Math.min(MAX_WAIT_MS, Math.max(0, ms)) : null
  }

  // Form 2: an HTTP date. Guarded first, because Date.parse is far too willing — it
  // accepted "3.5" as a date and produced a delay of zero, which would have hammered a
  // rate-limited service instantly. A real HTTP date always has letters and a colon
  // ("Sun, 02 Aug 2026 03:00:20 GMT"), so anything without both is junk, not a date.
  if (!/[a-z]/i.test(raw) || !raw.includes(':')) return null
  // A date already in the past means "now", not a negative wait.
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  return Math.min(MAX_WAIT_MS, Math.max(0, at - nowMs))
}

export interface DelayInputs {
  /** 0-based attempt that just failed. */
  attempt: number
  /** HTTP status, when there was one. */
  status?: number
  /** The service's own `Retry-After`, if it sent one. */
  retryAfter?: string | null
  /** Current time, injected so this stays testable. */
  nowMs: number
  /** 0..1, injected so this stays testable. */
  random: number
}

/**
 * How long to wait before the next attempt.
 *
 * Order of authority: what the service SAID, then how it failed, then our own curve.
 *
 * Jitter is applied to our own curve but NOT to a `Retry-After` value. Several scenes
 * generate in parallel, and without jitter they retry in lockstep and hammer the queue at
 * the same instants — whole batches used to fail together. But when the service names a
 * time, adding random slop to it either wastes seconds or comes back early, which is the
 * exact bug this exists to fix; the small lockstep risk is the better trade.
 */
export function nextDelayMs(i: DelayInputs): number {
  const stated = parseRetryAfter(i.retryAfter, i.nowMs)
  if (stated !== null) return stated

  const jitter = 0.6 + i.random * 0.8 // ±40%
  const base = Math.min(12_000, 1200 * 2 ** Math.max(0, i.attempt))
  const jittered = Math.round(base * jitter)

  // Rate-limited with no header: be more patient than for a plain failure. Coming back in
  // a second and a half is what makes a busy service keep saying no.
  if (i.status === 429) return Math.min(MAX_WAIT_MS, Math.max(RATE_LIMIT_FLOOR_MS, jittered))
  return Math.min(MAX_WAIT_MS, jittered)
}

/**
 * Is another attempt worth making at all?
 *
 * A 4xx that is not 408/429 will say exactly the same thing next time — a bad prompt, an
 * unknown model, a revoked key. Retrying it five times just makes the user wait five times
 * longer for the identical error.
 */
export function worthRetrying(status: number | undefined): boolean {
  if (status === undefined) return true // network/timeouts: worth another go
  if (status === 408 || status === 429) return true
  if (status >= 400 && status < 500) return false
  return true
}
