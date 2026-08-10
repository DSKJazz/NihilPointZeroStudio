/**
 * How long a FALLBACK provider gets — which is not one number.
 *
 * THE BUG THIS FIXES, seen in the user's own screenshot
 * Their saved Anthropic key had been revoked, so every request fell down the chain to
 * Ollama running locally on an Intel UHD machine with no NVIDIA card. Ollama then got the
 * flat 90-second fallback allowance and reported:
 *
 *   "Ollama did not respond within 2 minute(s). On a CPU-only machine long scripts are
 *    slow — try a shorter length, or switch to a cloud provider in Settings for speed."
 *
 * Every word of that is true and the whole thing is still wrong, because 90 seconds was
 * chosen for CLOUD backups that answer in a few seconds when healthy. An 8B model
 * generating a long script on a CPU cannot finish in 90 seconds — not sometimes, ever. So
 * the app was reliably killing the only working brain it had left and then apologising
 * for it.
 *
 * THE PRINCIPLE
 * A short leash is only worth having if there is somewhere else to go. The reason to cut a
 * fallback off early is to reach the NEXT provider sooner. When this provider IS the last
 * one, cutting it off buys nothing at all — it converts "slow" into "failed" and hands the
 * user an error instead of an answer. So:
 *
 *   - last in the chain          -> the long allowance, because failing fast fails for good
 *   - local model, more to try   -> scaled to the work asked for, never the cloud number
 *   - cloud backup               -> stays short; it is healthy or it is not
 *
 * Pure and tested; the caller supplies the facts.
 */
import { CHOSEN_TIMEOUT_MS, FALLBACK_TIMEOUT_MS, OLLAMA_CHOSEN_TIMEOUT_MS } from './limits'

export interface FallbackTimeoutInputs {
  /** Runs on this PC (Ollama). Slow is normal, not a symptom. */
  isLocal: boolean
  /** Nothing else is left to try after this one. */
  isLastResort: boolean
  /** Roughly how many tokens are being asked for, when known. */
  expectedTokens?: number
}

/**
 * Seconds per token to allow a local CPU model.
 *
 * Measured against the shape of the failure rather than a benchmark: an 8B model on a
 * mid-range CPU produces very roughly 2-5 tokens a second, so ~0.5s each is a generous
 * floor that still bounds the wait. Deliberately generous — the cost of guessing high is
 * a longer spinner, and the cost of guessing low is the bug above.
 */
export const LOCAL_MS_PER_TOKEN = 500

/** A local fallback never gets less than this, whatever the token estimate says. */
export const LOCAL_FALLBACK_FLOOR_MS = 5 * 60 * 1000

/**
 * How long this fallback provider may take before the chain gives up on it.
 *
 * Never returns less than the flat fallback number, so this can only ever be more patient
 * than the behaviour it replaces — a change that made anything time out SOONER would be a
 * new bug wearing a fix's clothes.
 */
export function fallbackTimeoutMs(i: FallbackTimeoutInputs): number {
  // Last one standing: there is no "next provider" to hurry towards.
  if (i.isLastResort) return i.isLocal ? OLLAMA_CHOSEN_TIMEOUT_MS : CHOSEN_TIMEOUT_MS

  if (!i.isLocal) return FALLBACK_TIMEOUT_MS

  const tokens = Number(i.expectedTokens)
  const scaled = Number.isFinite(tokens) && tokens > 0 ? tokens * LOCAL_MS_PER_TOKEN : 0
  return Math.min(
    OLLAMA_CHOSEN_TIMEOUT_MS,
    Math.max(LOCAL_FALLBACK_FLOOR_MS, scaled, FALLBACK_TIMEOUT_MS)
  )
}

/**
 * What to tell the user WHILE they wait, rather than only when it fails.
 *
 * A local model that is going to take four minutes should say so at the start. The old
 * behaviour said nothing for ninety seconds and then produced an error, which reads as a
 * broken app rather than a slow one.
 */
export function waitNotice(i: FallbackTimeoutInputs, ms: number): string | null {
  if (!i.isLocal) return null
  const mins = Math.max(1, Math.round(ms / 60000))
  return `Writing on this PC with the local AI. No internet needed, but it is slow — this can take up to ${mins} minute${mins === 1 ? '' : 's'}.`
}

/**
 * Was this failure the timeout doing its job, or the timeout being the problem?
 *
 * Used to decide whether the error shown to the user should suggest a shorter script (a
 * real limit) or admit the app cut it short too early (our fault). Saying "try a shorter
 * length" when the app allowed ninety seconds for a ten-minute job is advice that blames
 * the user for a number we chose.
 */
export function timeoutWasOurFault(i: FallbackTimeoutInputs, allowedMs: number): boolean {
  return i.isLocal && allowedMs <= FALLBACK_TIMEOUT_MS
}
