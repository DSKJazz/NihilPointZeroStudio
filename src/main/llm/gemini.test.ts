/**
 * The Gemini brain: what gets sent, where the key travels, and what a failure is
 * allowed to claim. Same discipline as the YouTube checker's tests — the key must
 * never appear in a URL, and a dead network must never become a verdict about the key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from './gemini'
import { LLMRequestError } from './types'

let calls: { url: string; headers: Record<string, string>; body: string }[] = []

function mockFetch(responder: () => { status: number; body: unknown } | 'network-error'): void {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, headers: init?.headers ?? {}, body: init?.body ?? '' })
      const r = responder()
      if (r === 'network-error') throw new Error('offline')
      return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as unknown as Response
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

const okBody = { candidates: [{ content: { parts: [{ text: 'salaam' }] } }] }

describe('GeminiProvider', () => {
  it('sends the key in a header, never in the URL', async () => {
    mockFetch(() => ({ status: 200, body: okBody }))
    const p = new GeminiProvider('AIzaSySecretKey')
    expect(await p.generateText('hi')).toBe('salaam')
    expect(calls[0].url).not.toContain('AIza')
    expect(calls[0].headers['x-goog-api-key']).toBe('AIzaSySecretKey')
  })

  it('marks a rejected key permanent so the chain moves on instead of retrying all day', async () => {
    mockFetch(() => ({ status: 403, body: { error: { message: 'API key not valid' } } }))
    const p = new GeminiProvider('AIzaSyBadKey')
    await expect(p.generateText('hi')).rejects.toMatchObject({ permanent: true })
  })

  it('treats a spent free allowance as transient — it resets by itself', async () => {
    mockFetch(() => ({ status: 429, body: {} }))
    const p = new GeminiProvider('AIzaSyKey')
    const err = await p.generateText('hi').catch((e) => e as LLMRequestError)
    expect(err).toBeInstanceOf(LLMRequestError)
    expect((err as LLMRequestError).permanent).toBeFalsy()
    expect((err as LLMRequestError).message).toMatch(/resets by itself/i)
  })

  it('reports a content refusal as this-request trouble, not a dead service', async () => {
    mockFetch(() => ({ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }))
    const p = new GeminiProvider('AIzaSyKey')
    const err = await p.generateText('hi').catch((e) => e as LLMRequestError)
    expect((err as LLMRequestError).permanent).toBeFalsy()
    expect((err as LLMRequestError).message).toMatch(/declined this request/i)
  })

  it('a dead network is a network message, never a verdict about the key', async () => {
    mockFetch(() => 'network-error')
    const p = new GeminiProvider('AIzaSyKey')
    const err = await p.generateText('hi').catch((e) => e as LLMRequestError)
    expect((err as LLMRequestError).message).toMatch(/internet/i)
    expect((err as LLMRequestError).permanent).toBeFalsy()
  })

  it('never advertises a paid provider in any failure message', async () => {
    // PAID FEATURES SLEEP: no Gemini error may point at Claude/OpenAI as the fix.
    for (const status of [400, 403, 404, 429, 500]) {
      mockFetch(() => ({ status, body: {} }))
      const p = new GeminiProvider('AIzaSyKey')
      const err = (await p.generateText('hi').then(
        () => new Error('should have failed'),
        (e) => e
      )) as Error
      expect(err.message).not.toMatch(/Claude|OpenAI|paid key/i)
    }
  })
})
