/**
 * A FREE, keyless, no-install AI brain: Pollinations' OpenAI-compatible hosted text
 * endpoint. No API key, no signup, no local model download — it just needs internet.
 * This is the app's default provider so every AI feature works out of the box for
 * free. Users can still switch to local Ollama (free/offline) or a paid Claude/OpenAI
 * key for higher quality in Settings.
 *
 * Same LLMProvider contract + prompt builders as the paid providers, so behaviour is
 * identical — only the (free) backend differs.
 */
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'
import { logAiError } from './errorLog'

const ENDPOINT = 'https://text.pollinations.ai/openai'
/**
 * Was 120s. A stalled free service then held the UI for up to four minutes across
 * the retry chain, which users reasonably read as "the app froze". Real successful
 * answers arrive in seconds; anything past this is not coming.
 */
const TIMEOUT_MS = 45_000

export class PollinationsProvider implements LLMProvider {
  constructor(private model: string = 'openai') {}

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    const started = Date.now()
    const model = this.model || 'openai'
    const fail = (message: string, o: { permanent?: boolean; status?: number; body?: string } = {}): never => {
      logAiError({
        at: new Date().toISOString(),
        provider: `free/${model}`,
        feature: 'text',
        status: o.status,
        ms: Date.now() - started,
        message,
        body: o.body
      })
      throw new LLMRequestError(message, { permanent: o.permanent, status: o.status })
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          // Keep generations out of the public feed and identify the app politely.
          private: true,
          referrer: 'nihilpointzero-studio'
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) {
        // The body is the whole diagnosis — a bare status code is what made the
        // July 2026 outage impossible to explain. Read it, log it, act on it.
        const body = await res.text().catch(() => '')
        if (res.status === 402) {
          // No paid recommendation here, ever — PAID FEATURES SLEEP. The answer to a
          // free service dying is the local free brain, not a credit card.
          fail(
            'The free online AI now demands payment, so it can no longer answer. ' +
              'Your local brain (Ollama) takes over automatically — if you are reading this, Ollama did not answer either. ' +
              'Settings → Setup Health will say why (it usually just needs Ollama started).',
            { permanent: true, status: 402, body }
          )
        }
        if (res.status === 404) {
          fail(
            `The free online AI no longer offers the "${model}" model — it was withdrawn. ` +
              'Your local brain (Ollama) takes over automatically — if you are reading this, Ollama did not answer either. ' +
              'Settings → Setup Health will say why.',
            { permanent: true, status: 404, body }
          )
        }
        if (res.status === 429) {
          fail('The free AI service is rate-limiting this computer right now. Wait a minute and try again.', {
            status: 429,
            body
          })
        }
        fail(`The free AI service returned ${res.status}.`, { status: res.status, body })
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const text = data.choices?.[0]?.message?.content
      if (!text || !text.trim()) fail('The free AI service returned no text. Try again in a moment.')
      return text as string
    } catch (err) {
      if (err instanceof LLMRequestError) throw err
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      return fail(
        timedOut
          ? `The free AI service did not answer within ${Math.round(TIMEOUT_MS / 1000)} seconds.`
          : `Free AI request failed (${err instanceof Error ? err.message : String(err)}). Check your internet connection.`
      )
    }
  }

  async generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]> {
    const text = await this.complete(buildTrendPrompt(focusArea, count), 2000)
    return extractJson<TrendTopic[]>(text)
  }

  async generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]> {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals), 3000)
    return extractJson<Omit<VideoIdea, 'id' | 'createdAt'>[]>(text)
  }

  async generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
    const text = await this.complete(buildScriptPrompt(req), 8000)
    return parseScriptResponse(text)
  }

  async generateThumbnailBrief(topic: string, title: string): Promise<string> {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1000)).trim()
  }

  async generateText(prompt: string, maxTokens = 4000): Promise<string> {
    return (await this.complete(prompt, maxTokens)).trim()
  }
}
