/**
 * Proving a Gemini key works before trusting it — same philosophy as the YouTube
 * walkthrough: a key that has been saved but never used is an assumption, not a setup.
 *
 * The check lists models (free, no tokens generated, no content sent) and turns the
 * reply into the same three-state verdict the YouTube checker uses: working / broken /
 * could-not-tell — never a boolean, because "I could not reach Google" must not render
 * as either a pass or a bad key.
 */
import { classifyKeyResponse, cleanPastedKey, inspectKeyShape, offlineVerdict, type KeyVerdict } from '../../shared/youtubeKeySetup'
import { getGeminiApiKey } from '../store'

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'

/**
 * One real request with the pasted key. Gemini AI-Studio keys are Google keys — the
 * same AIza shape, the same error grammar — so the shape inspector and the response
 * classifier are shared with the YouTube checker rather than re-invented. The one
 * difference is the fix text: a broken Gemini key is fixed at AI Studio, not the Cloud
 * Console, so the fixUrl is rewritten to point there.
 */
export async function verifyGeminiKey(rawKey: string): Promise<KeyVerdict> {
  const key = cleanPastedKey(rawKey)
  const shape = inspectKeyShape(key)
  if (!shape.ok) {
    return {
      state: 'broken',
      title: shape.problem ?? 'That does not look like a Google API key',
      message: 'Checked before contacting Google, because this one can be spotted from the key itself.',
      fix: shape.fix ?? 'Copy the key again from AI Studio — it starts with AIza.'
    }
  }
  try {
    const res = await fetch(MODELS_URL, {
      // Key in the header, never the URL — URLs get logged by proxies; headers don't.
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15_000)
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const verdict = classifyKeyResponse(res.status, body)
    if (verdict.state === 'working') {
      return { state: 'working', message: 'This key works. Gemini is ready to use.' }
    }
    if (verdict.state === 'broken') {
      // Same diagnosis, Gemini's front door: keys are made and fixed at AI Studio.
      return { ...verdict, fixUrl: 'https://aistudio.google.com/apikey' }
    }
    return verdict
  } catch {
    return offlineVerdict()
  }
}

/** Re-checks the key already saved in Settings, for the "check it again" button. */
export async function verifySavedGeminiKey(): Promise<KeyVerdict> {
  const saved = getGeminiApiKey()
  if (!saved) {
    return {
      state: 'broken',
      title: 'No Gemini key is saved yet',
      message: 'Gemini stays off until there is one. The key is free — Google never asks for a card for it.',
      fix: 'Follow the numbered steps above — it takes about two minutes.'
    }
  }
  return verifyGeminiKey(saved)
}
