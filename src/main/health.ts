/**
 * LIVE self-test of everything the studio depends on.
 *
 * Why live: the Settings page already had a "Setup health" panel, but it only asked
 * "is a key SAVED?" — so during the July 2026 incident it showed a cheerful green
 * light for an Anthropic key the API was rejecting with 401 on every single call.
 * These checks actually talk to each service, so a broken setup is visible in
 * seconds instead of looking like "the AI got dumb" for days.
 *
 * Rules: every check is bounded by a timeout, never throws, and never prints or
 * returns key material — only a verdict.
 */
import { existsSync } from 'fs'
import { getDecryptedKey, getGeminiApiKey, getModel, getSettings, getStockConfig, getYouTubeApiKey } from './store'
import { getOllamaStatus } from './llm/ollama'
import type { HealthCheck, HealthReport } from '../shared/types'

const ok = (name: string, detail: string): HealthCheck => ({ name, status: 'ok', detail })
const warn = (name: string, detail: string): HealthCheck => ({ name, status: 'warn', detail })
const fail = (name: string, detail: string): HealthCheck => ({ name, status: 'fail', detail })

/** HEAD/GET a URL with a hard timeout; returns the status code or null on network failure. */
async function ping(url: string, ms = 8000, headers?: Record<string, string>): Promise<number | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) })
    return res.status
  } catch {
    return null
  }
}

async function checkInternet(): Promise<HealthCheck> {
  const code = await ping('https://api.github.com/', 8000, { 'User-Agent': 'nihilpointzero-os' })
  return code === null
    ? fail('Internet', 'No connection — online features (free AI, images, music, live prices) will not work')
    : ok('Internet', 'connected')
}

/**
 * Sends a real (tiny) completion to the SAME endpoint the app generates with.
 * The old version GET-pinged /hello, a different URL — so when the real
 * chat endpoint began answering 402 "payment required" for everyone, this check
 * still showed a cheerful green light. A health check that doesn't exercise the
 * actual failing path is worse than none: it actively misleads.
 */
async function checkFreeText(): Promise<HealthCheck> {
  const label = 'Free AI (text)'
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        private: true,
        referrer: 'nihilpointzero-studio'
      }),
      signal: AbortSignal.timeout(15000)
    })
    if (res.status === 402) {
      return fail(label, 'no longer free — the service now demands a paid account. The local brain (Ollama) is the answer; nothing needs buying')
    }
    if (res.status === 404) {
      return fail(label, 'the free model was withdrawn from their service. The local brain (Ollama) covers it; nothing needs buying')
    }
    if (res.status === 429) return warn(label, 'busy right now (rate-limited) — answers may fail or be slow')
    if (res.status >= 400) return fail(label, `service returned ${res.status} — answers will fail`)
    return ok(label, 'working')
  } catch {
    return fail(label, 'unreachable or too slow to answer — check internet')
  }
}

async function checkFreeImages(): Promise<HealthCheck> {
  const code = await ping('https://image.pollinations.ai/', 12000)
  if (code === null) return fail('Free AI (images)', 'unreachable — scene images will fall back to the animated look')
  if (code === 429) return warn('Free AI (images)', 'busy (rate-limited) — scenes will be slow and retry')
  return ok('Free AI (images)', 'reachable')
}

/**
 * Validates a saved paid key with the cheapest possible authenticated request
 * (a model list, not a generation — no tokens billed). This is the check that
 * would have caught the 11-day invalid-key outage on day one.
 */
async function checkPaidKey(provider: 'anthropic' | 'openai'): Promise<HealthCheck> {
  const label = provider === 'anthropic' ? 'Anthropic key' : 'OpenAI key'
  let key: string | null
  try {
    key = getDecryptedKey(provider)
  } catch {
    return warn(label, 'saved key could not be read on this machine (copied portable copy?)')
  }
  if (!key) return warn(label, 'not set (only needed if you pick this provider)')

  /**
   * A PAID SERVICE YOU HAVE NOT CHOSEN IS NOT A PROBLEM WITH YOUR STUDIO.
   *
   * The user's standing rule: paid features exist, but they stay inert until he
   * deliberately selects one and supplies a key. "If it's a paid thing and I've not paid,
   * why is it even trying to run?"
   *
   * A key left over from an old experiment was being contacted on every health check and
   * reported as a red ✗ "1 problem — paste a fresh key". That reads as *your app is
   * broken, go and spend money*, when in fact the app is working exactly as chosen: the
   * free brain is active and writing everything. It also sends the key to a paid API when
   * the user never asked for anything paid to happen.
   *
   * So when this provider is not the active one, do not contact the service at all. Say
   * plainly that it is not in use, and leave it as a note rather than a fault.
   */
  if (getSettings().activeProvider !== provider) {
    return warn(label, 'saved but NOT in use — you are on a different AI brain, so nothing here costs money')
  }
  const code =
    provider === 'anthropic'
      ? await ping('https://api.anthropic.com/v1/models', 12000, {
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        })
      : await ping('https://api.openai.com/v1/models', 12000, { Authorization: `Bearer ${key}` })
  if (code === null) return warn(label, 'could not reach the service — check internet')
  if (code === 401 || code === 403) return fail(label, `REJECTED (${code}) — the saved key is wrong or revoked; paste a fresh key`)
  if (code === 429) return warn(label, 'key works but you are rate-limited / out of credit right now')
  if (code >= 400) return warn(label, `service returned ${code}`)
  return ok(label, 'valid')
}

/**
 * Gemini is FREE-keyed, so its rules sit between YouTube's and the paid pair's: a
 * missing key is a note (not a fault — nothing needs it unless chosen), a saved key on
 * a switched-off provider is never contacted, and only an enabled/active Gemini gets a
 * live test. The test lists models: free, nothing generated, nothing sent.
 */
async function checkGemini(): Promise<HealthCheck> {
  const label = 'Gemini (free key)'
  let key: string | null
  try {
    key = getGeminiApiKey()
  } catch {
    return warn(label, 'saved key could not be read on this machine (copied portable copy?)')
  }
  if (!key) return warn(label, 'not set (optional — a free key from AI Studio switches it on)')
  const s = getSettings()
  if (s.activeProvider !== 'gemini' && !s.providerEnabled.gemini) {
    return warn(label, 'saved but switched OFF — nothing is contacted while the switch is off')
  }
  const code = await ping('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', 12000, {
    'x-goog-api-key': key
  })
  if (code === null) return warn(label, 'could not reach Google — check internet')
  if (code === 400 || code === 401 || code === 403)
    return fail(label, `REJECTED (${code}) — Settings → Connect Gemini → "Check the saved key" says exactly what is wrong`)
  if (code === 429) return warn(label, "key works but the free daily allowance is used up right now — it resets by itself")
  if (code >= 400) return warn(label, `service returned ${code}`)
  return ok(label, 'valid')
}

async function checkOllama(): Promise<HealthCheck> {
  const s = await getOllamaStatus()
  if (!s.connected) return warn('Ollama (local AI)', 'not running (only needed if you pick Ollama)')
  if (!s.models.length) return warn('Ollama (local AI)', 'running but no models installed — run: ollama pull llama3.2:3b')
  const chosen = getModel('ollama').trim()
  return s.models.includes(chosen)
    ? ok('Ollama (local AI)', `running · ${s.models.length} model(s) · using ${chosen}`)
    : warn('Ollama (local AI)', `running, but your chosen model "${chosen}" is not installed (have: ${s.models.join(', ')})`)
}

/** The provider actually in use must be usable — this is the headline check. */
function checkActiveProvider(checks: HealthCheck[]): HealthCheck {
  const p = getSettings().activeProvider
  const nameFor: Record<string, string> = {
    free: 'Free AI (text)',
    ollama: 'Ollama (local AI)',
    gemini: 'Gemini (free key)',
    anthropic: 'Anthropic key',
    openai: 'OpenAI key'
  }
  const dep = checks.find((c) => c.name === nameFor[p])
  const label = `Active AI brain (${p})`
  if (!dep) return warn(label, 'could not determine')
  if (dep.status === 'ok') return ok(label, 'ready')
  // Mirror the dependency's severity: a merely-busy service is a warning, not a
  // failure, and must not be described with fail-only wording.
  if (dep.status === 'warn') return warn(label, `${dep.detail} — answers may be slow or fall back to the free AI`)
  return fail(label, `${dep.detail} — until fixed, answers come from the free AI (weaker)`)
}

function checkVoices(): HealthCheck {
  // resourcesPath only exists in a packaged app; in dev the models live in the repo.
  const base = process.resourcesPath ? `${process.resourcesPath}/models` : 'resources/models'
  return existsSync(base)
    ? ok('Offline voice/transcribe files', 'present')
    : warn('Offline voice/transcribe files', 'not found — voiceover/Make Shorts may fall back')
}

function checkStockFootage(): HealthCheck {
  try {
    const cfg = getStockConfig()
    const has = Boolean(cfg.pixabayKey || cfg.pexelsKey)
    return has
      ? ok('Stock footage key', 'set')
      : warn('Stock footage key', 'not set — real B-roll is skipped (animated visuals still work)')
  } catch {
    return warn('Stock footage key', 'could not read the saved config')
  }
}

function checkYouTubeKey(): HealthCheck {
  let key: string | null
  try {
    key = getYouTubeApiKey()
  } catch {
    return warn('YouTube key', 'saved key could not be read')
  }
  // Free, so a missing one is worth naming as a thing to switch on rather than a bare
  // "not set" — three whole tabs read nothing without it.
  return key
    ? ok('YouTube key', 'set')
    : warn(
        'YouTube key',
        'not set — Your Channel, the comment questions and the competitor gaps all read nothing. Free to fix: Settings → Connect YouTube (about 3 minutes)'
      )
}

/** Runs every check (network ones in parallel) and summarises. Never throws. */
export async function runHealthCheck(): Promise<HealthReport> {
  const [internet, freeText, freeImg, anthropic, openai, ollama, gemini] = await Promise.all([
    checkInternet(),
    checkFreeText(),
    checkFreeImages(),
    checkPaidKey('anthropic'),
    checkPaidKey('openai'),
    checkOllama(),
    checkGemini()
  ])
  const checks: HealthCheck[] = [internet, freeText, freeImg, anthropic, openai, ollama, gemini, checkVoices(), checkStockFootage(), checkYouTubeKey()]
  // Prepend the headline verdict about the provider actually selected.
  checks.unshift(checkActiveProvider(checks))
  return {
    checkedAt: new Date().toISOString(),
    checks,
    failCount: checks.filter((c) => c.status === 'fail').length,
    warnCount: checks.filter((c) => c.status === 'warn').length
  }
}
