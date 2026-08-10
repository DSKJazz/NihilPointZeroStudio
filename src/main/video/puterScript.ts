/**
 * The PURE parts of the free-cloud (Puter) video engine: the script that runs inside
 * the harness page, and the error-to-plain-English classifier. Kept electron-free so
 * they are unit-testable (see puterScript.test.ts); the BrowserWindow wiring lives in
 * ./puter.ts.
 */

export const DEFAULT_PUTER_MODEL = 'google/veo-3.1-fast'

/** Clamps the "how many scenes get real motion" cap to a sane 1..30 (default 5). */
export function clampSceneCap(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(30, Math.floor(n)) : 5
}

/**
 * Classifies a raw harness error into the plain-English reason shown in the build log.
 */
export function classifyPuterError(raw: string): string {
  const m = (raw || '').toLowerCase()
  if (
    m.includes('insufficient') ||
    m.includes('funds') ||
    m.includes('credit') ||
    m.includes('allowance') ||
    m.includes('usage-limited') ||
    m.includes('limit')
  )
    return 'your free Puter allowance is used up for now'
  if (m.includes('auth') || m.includes('sign') || m.includes('login') || m.includes('permission') || m.includes('token'))
    return 'Puter sign-in is needed (or was cancelled)'
  if (m.includes('timeout') || m.includes('timed out')) return 'the generation took too long'
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('sdk not loaded'))
    return 'the Puter service could not be reached'
  return `Puter reported: ${raw || 'unknown error'}`
}

/**
 * The script run inside the harness page. Resolves to {ok,b64} or {ok:false,error}.
 * Base64 is built in chunks — String.fromCharCode on a whole clip would blow the
 * argument limit. The prompt/model are embedded via JSON.stringify so quotes,
 * newlines and Urdu text can never break out of the string literal.
 */
export function buildHarnessScript(prompt: string, model: string): string {
  return `(async () => {
    try {
      if (typeof puter === 'undefined' || !puter.ai || !puter.ai.txt2vid) return { ok: false, error: 'SDK not loaded' }
      const out = await puter.ai.txt2vid(${JSON.stringify(prompt)}, { model: ${JSON.stringify(model)} })
      const src = out && (out.src || out.currentSrc) ? (out.src || out.currentSrc) : (typeof out === 'string' ? out : null)
      if (!src) return { ok: false, error: 'no video in response' }
      const res = await fetch(src)
      if (!res.ok) return { ok: false, error: 'video download failed (HTTP ' + res.status + ')' }
      const buf = new Uint8Array(await res.arrayBuffer())
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK))
      return { ok: true, b64: btoa(bin) }
    } catch (e) {
      return { ok: false, error: String((e && (e.message || e.error || e.code)) || e) }
    }
  })()`
}
