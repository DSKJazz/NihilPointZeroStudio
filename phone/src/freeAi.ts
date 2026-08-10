/**
 * Transport to the free, keyless AI service — used only when the phone has a cached
 * prompt pack and can therefore work with the PC switched off.
 *
 * This file is pure plumbing on purpose. It contains no prompt wording of its own:
 * the text it sends is assembled from the pack the user copied onto their handset,
 * so nothing sensitive is ever bundled into the public page. Same endpoint and
 * options the desktop app uses, so behaviour matches.
 */
import { getKey, getProvider } from './store'

const POLLINATIONS = 'https://text.pollinations.ai/openai'
const OPENAI = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC = 'https://api.anthropic.com/v1/messages'

/** Generous: a long script legitimately takes a while on a phone connection. */
const TIMEOUT_MS = 120_000

export class FreeAiError extends Error {}

function friendly(status: number, provider: string): string {
  if (status === 401 || status === 403) return 'That AI key was rejected. Check it in Settings, or switch to Free.'
  if (status === 402) return 'That AI account needs credit. Switch to Free to keep working.'
  if (status === 429) return 'The AI service is busy right now. Wait a minute and try again.'
  if (status >= 500) return `The ${provider} AI service is having trouble. Try again shortly.`
  return `The ${provider} AI service returned an error (${status}).`
}

async function post(url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new FreeAiError(
      timedOut
        ? `The AI took longer than ${Math.round(TIMEOUT_MS / 1000)} seconds. Try a shorter length.`
        : 'Could not reach the AI. Check your phone has internet.'
    )
  }
  if (!res.ok) throw new FreeAiError(friendly(res.status, provider))
  return res
}

/** One prompt in, the finished text out. */
export async function complete(prompt: string, maxTokens: number, system?: string): Promise<string> {
  const provider = getProvider()
  const key = getKey()

  if (provider === 'anthropic' && key) {
    const res = await post(
      ANTHROPIC,
      {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Required for calls made straight from a browser rather than a server.
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      {
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }]
      },
      'Claude'
    )
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data.content?.map((c) => c.text ?? '').join('')
    if (!text?.trim()) throw new FreeAiError('Claude returned no text. Try again.')
    return text
  }

  if (provider === 'openai' && key) {
    const res = await post(
      OPENAI,
      { Authorization: `Bearer ${key}` },
      {
        model: 'gpt-4o',
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
      },
      'OpenAI'
    )
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content
    if (!text?.trim()) throw new FreeAiError('OpenAI returned no text. Try again.')
    return text
  }

  const res = await post(
    POLLINATIONS,
    {},
    {
      model: 'openai',
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      max_tokens: maxTokens,
      // Keep generations out of the provider's public feed.
      private: true,
      referrer: 'nihilpointzero-phone'
    },
    'free'
  )
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (!text?.trim()) throw new FreeAiError('The free AI service returned nothing. Try again in a moment.')
  return text
}
