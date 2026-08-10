import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { OllamaProvider } from './ollama'
import { PollinationsProvider } from './pollinations'
import { GeminiProvider } from './gemini'
import { ResilientProvider } from './resilient'
import { LLMConfigError, LLMRequestError, type LLMProvider } from './types'
import { logAiError } from './errorLog'
import { isProviderDead, recordProviderFailure, recordProviderSuccess } from './deadProviders'

import { CHOSEN_TIMEOUT_MS, FALLBACK_TIMEOUT_MS } from './limits'
import { fallbackTimeoutMs } from './timeouts'

import { getDecryptedKey, getModel, getProviderEnabled, getSettings, logActivity } from '../store'
import { broadcastAiFallback } from '../notify'

/** Builds the raw provider for the chosen id (throws for a paid provider with no key). */
function buildProvider(id: string, model: string, timeoutMs = CHOSEN_TIMEOUT_MS): LLMProvider {
  // Trim the saved model id — a stray leading/trailing space (e.g. " claude-fable-5")
  // otherwise causes a hard 404 on every paid call.
  const m = (model || '').trim()
  if (id === 'free') return new PollinationsProvider(m || 'openai')
  if (id === 'ollama') return new OllamaProvider(m)
  const key = getDecryptedKey(id as 'anthropic' | 'openai' | 'gemini')
  if (!key) throw new LLMConfigError(`No API key configured for ${id}. Add one in Settings before generating.`)
  if (id === 'gemini') return new GeminiProvider(key, m, timeoutMs)
  if (id === 'anthropic') return new AnthropicProvider(key, m, timeoutMs)
  return new OpenAIProvider(key, m, timeoutMs)
}

/**
 * The active provider, wrapped so a busy/down service auto-falls-back and never hard-
 * blocks. Chain: the chosen provider first, then the keyless free hosted model as a
 * safety net. The free hosted model is ALWAYS appended (even for the free default, as a
 * one-shot retry) so a single transient hiccup never surfaces as an error. If the chosen
 * provider can't even be constructed (paid provider with no/undecryptable key — common on
 * a portable USB copy), we skip it rather than hard-failing the whole chain, degrading to
 * free. Needs internet for the free fallback.
 */
export function getActiveProvider(): LLMProvider {
  const settings = getSettings()
  // THE SWITCHBOARD IS LAW. A brain the user switched off is never contacted — not as
  // a fallback, not as a safety net, not "just this once". An off switch that still
  // answers is not an off switch. The active provider is always allowed (choosing it
  // was the clearest possible ON), which getProviderEnabled() guarantees.
  const enabled = getProviderEnabled()
  const chain: LLMProvider[] = []
  const labels: string[] = []
  // A provider that recently refused permanently (revoked key, service now demanding
  // payment) is demoted to the back of the chain instead of being tried first, so the
  // user stops paying that refusal's delay before every single answer. It stays IN the
  // chain, so if nothing else works they still get its real error rather than a bare
  // "no AI available".
  const demoted = isProviderDead(settings.activeProvider)
  let demotedPrimary: LLMProvider | null = null
  try {
    // A demoted provider is tried LAST, after everything else has already failed. It is
    // a fallback in all but name, so it gets the short leash — the user has been waiting
    // through the whole chain by the time it is reached.
    const primary = buildProvider(
      settings.activeProvider,
      getModel(settings.activeProvider),
      demoted ? FALLBACK_TIMEOUT_MS : CHOSEN_TIMEOUT_MS
    )
    if (demoted) {
      // Held back, NOT dropped. Dropping it meant a paid key that hit two transient 429s
      // became unreachable for a full 30 minutes — and, being absent from the chain, it
      // could never report a success to clear its own demotion. Kept at the back it stays
      // self-healing, and remains the source of the real error if nothing else works.
      demotedPrimary = primary
    } else {
      chain.push(primary)
      labels.push(settings.activeProvider)
    }
  } catch (err) {
    // No usable primary (missing/undecryptable key) — degrade to a fallback below, but
    // SAY SO (activity log + banner): a silent downgrade looks like "the AI got dumb".
    // Reporting must never itself break the request, hence the inner guard.
    const detail = err instanceof Error ? err.message : String(err)
    try {
      logActivity('ai', `Your ${settings.activeProvider} AI could not be used — answers will come from another AI`, detail)
      broadcastAiFallback({ provider: settings.activeProvider, detail })
    } catch {
      /* a full disk must not turn a recoverable fallback into a hard failure */
    }
  }
  // Local Ollama is a genuinely different brain, needs no key and no internet, and is the
  // only thing that still works when the hosted free service refuses everyone. An absent
  // Ollama costs milliseconds (localhost refuses instantly).
  //
  // ITS ALLOWANCE IS NOT THE CLOUD ONE. It used to get the flat 90-second fallback leash,
  // which was chosen for cloud backups that answer in seconds when healthy. On a CPU-only
  // machine an 8B model cannot finish a long script in 90 seconds — not sometimes, ever —
  // so the app reliably killed the only working brain it had left and then apologised for
  // it. (Reported from a real machine: "Ollama did not respond within 2 minute(s)", with
  // the answer then coming from the free AI.) See llm/timeouts.ts.
  //
  // Being generous here is close to free: the underlying deadline is a socket INACTIVITY
  // timeout, so a fast answer still returns immediately. It only bites when nothing is
  // coming back at all, which is exactly when it should.
  if (!labels.includes('ollama') && enabled.ollama) {
    // Not the last resort at this point: the keyless free service is appended below.
    const ollamaMs = fallbackTimeoutMs({ isLocal: true, isLastResort: false })
    chain.push(new OllamaProvider(getModel('ollama'), ollamaMs))
    labels.push('ollama')
  }
  // Gemini as a fallback when it is switched on and has its (free) key: a genuinely
  // different brain that costs nothing, tried after the local one, before the free net.
  if (!labels.includes('gemini') && enabled.gemini && !isProviderDead('gemini')) {
    try {
      chain.push(buildProvider('gemini', getModel('gemini'), FALLBACK_TIMEOUT_MS))
      labels.push('gemini')
    } catch {
      /* no key saved — nothing to add, and nothing to report: it is simply not set up */
    }
  }
  // Keyless safety net, so the chain is never empty. Added only ONCE: it used to be pushed
  // twice, so a failing free service was asked the identical question a second time and the
  // user simply waited twice as long for the same error.
  //
  // BUT NOT WHEN IT IS KNOWN-DEAD. The hosted service began demanding payment (HTTP 402,
  // permanent), which makes it a paid service in all but name — and the standing rule is
  // that paid things are never contacted unless the user chose them. Appending it anyway
  // meant every failed Ollama answer ended with ITS error on screen: "requires a paid
  // account", which reads as *go and pay*. Skipped while dead (unless it is the active,
  // deliberately-chosen provider); it re-enters the chain by itself if it ever recovers,
  // because deadProviders re-probes and clears the mark on success.
  if (!labels.includes('free') && enabled.free && (settings.activeProvider === 'free' || !isProviderDead('free'))) {
    chain.push(new PollinationsProvider(getModel('free') || 'openai'))
    labels.push('free')
  }
  // Only if a fallback above hasn't already covered it. When the demoted provider IS
  // 'free' or 'ollama', the fallback entry is the same service, and appending it again
  // would recreate the very "ask the dead service twice" delay this all exists to remove.
  if (demotedPrimary && !labels.includes(settings.activeProvider)) {
    chain.push(demotedPrimary)
    labels.push(settings.activeProvider)
  }
  const record = (i: number, err: unknown): void => {
    const detail = err instanceof Error ? err.message : String(err)
    logAiError({
      at: new Date().toISOString(),
      provider: labels[i],
      feature: 'chain',
      status: err instanceof LLMRequestError ? err.status : undefined,
      message: detail
    })
    recordProviderFailure(labels[i], err instanceof LLMRequestError && err.permanent)
  }
  return new ResilientProvider(
    chain,
    (i, err) => {
      record(i, err)
      // A routine free retry isn't worth a banner, but a paid/local provider degrading
      // to something else is — a silent downgrade looks like "the AI got dumb".
      if (labels[i] === 'free') return
      const detail = err instanceof Error ? err.message : String(err)
      logActivity('ai', `Your ${labels[i]} AI failed — this answer came from another AI instead`, detail)
      broadcastAiFallback({ provider: labels[i], detail })
    },
    labels,
    (i) => recordProviderSuccess(labels[i]),
    record
  )
}

export { LLMConfigError, LLMRequestError } from './types'
