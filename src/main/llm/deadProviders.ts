/**
 * Short-lived memory of which AI providers are currently not working, so a broken one
 * stops being tried first on every single request.
 *
 * Why a failure STREAK and not just a status code: when the hosted free text service
 * stopped being free in July 2026 it did not fail in one tidy way. Observed in a single
 * afternoon: 402 (payment required), 404 (model removed), 429 (rate limited), 520 (a
 * Cloudflare HTML error page), and outright timeouts. Keying the decision off specific
 * codes would have caught some of those and let the rest keep costing the user 15-45
 * seconds before every answer. Counting consecutive failures catches all of them,
 * including whatever it does next.
 *
 * A permanent refusal (rejected key, service gone paid) demotes immediately — there is
 * no reason to give that a second chance. Anything else needs to fail twice in a row,
 * so one blip doesn't sideline a working provider.
 *
 * Deliberately expiring and in-memory: services recover, and a verdict cached forever
 * would be its own bug. A restart re-checks everything.
 */
const streaks = new Map<string, number>()
const deadUntil = new Map<string, number>()

const TTL_MS = 30 * 60 * 1000
const FAILURES_BEFORE_DEMOTION = 2

export function recordProviderFailure(label: string, permanent = false): void {
  const streak = (streaks.get(label) ?? 0) + 1
  streaks.set(label, streak)
  if (permanent || streak >= FAILURES_BEFORE_DEMOTION) deadUntil.set(label, Date.now() + TTL_MS)
}

/** Clears the slate — a provider that just worked is not broken, whatever it did before. */
export function recordProviderSuccess(label: string): void {
  streaks.delete(label)
  deadUntil.delete(label)
}

export function isProviderDead(label: string): boolean {
  const until = deadUntil.get(label)
  if (until === undefined) return false
  if (Date.now() >= until) {
    deadUntil.delete(label)
    streaks.delete(label)
    return false
  }
  return true
}

export function clearDeadProviders(): void {
  streaks.clear()
  deadUntil.clear()
}
