/**
 * How long any one AI service is allowed to keep the user waiting.
 *
 * THE BUG THIS FIXES — the "widget just never responds" complaint
 * The Anthropic and OpenAI SDKs were constructed with nothing but a key. Both then
 * apply their own generous defaults: a ten-minute request timeout AND two automatic
 * retries. A service that hangs rather than refusing therefore held a single request
 * for up to THIRTY MINUTES, in total silence. From the other side that is not a slow
 * answer, it is a dead panel — and worse, the fallback chain never got a turn, because
 * nothing had failed yet.
 *
 * Two numbers, chosen for different jobs:
 *
 *   CHOSEN    — the provider the user picked. Generous, because a long script really
 *               can take a while and cutting off good work would be its own bug.
 *   FALLBACK  — a backup being tried after something else already failed. Short, because
 *               the user has ALREADY waited once and is watching a spinner.
 *
 * Retries are set to 0 deliberately. The chain in index.ts is the retry mechanism, and
 * it is a better one: it moves to a DIFFERENT service instead of asking the broken one
 * the same question again. Leaving the SDK's own retries on meant every failure was
 * paid for three times before the chain even noticed.
 */

/** The provider the user actually chose. Long enough for a full-length script. */
export const CHOSEN_TIMEOUT_MS = 4 * 60 * 1000

/** A backup, tried only after something already failed. The user is waiting twice over. */
export const FALLBACK_TIMEOUT_MS = 90 * 1000

/** Ollama running locally on CPU is slow but free; as the CHOSEN brain it gets room. */
export const OLLAMA_CHOSEN_TIMEOUT_MS = 20 * 60 * 1000

/**
 * Never let an SDK retry internally. The chain retries by moving to a different
 * service, which is the only kind of retry that helps when one is down.
 */
export const SDK_MAX_RETRIES = 0

/**
 * A plain-English ceiling for the UI, so a panel can say "this is taking unusually
 * long" rather than looking broken while it waits legitimately.
 */
export function describeWait(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} seconds`
  const m = Math.round(s / 60)
  return `${m} minute${m === 1 ? '' : 's'}`
}
