/**
 * Google Gemini as an AI brain, through the key that is GENUINELY free.
 *
 * WHY THIS ONE AND NOT THE OTHERS. The user asked for Gemini, ChatGPT and Grok, because
 * their chat websites are free to use. Of the three, only Google offers that same
 * generosity through an API a desktop app can call: an AI Studio key costs nothing, needs
 * no card, and its free tier is renewed daily. OpenAI and xAI offer no free API at all —
 * wiring their chat WEBSITES into an app would mean storing the user's passwords and
 * screen-scraping pages that change weekly, so those two get open-in-browser buttons
 * instead, and this file is the real integration.
 *
 * FREE-KEYED, NOT PAID. This provider is keyed like YouTube, not like Anthropic: the key
 * unlocks a free allowance rather than a bill. It still follows the sleep rules — never
 * contacted unless selected, never a red mark while unused, never recommended as a fix —
 * because a rule with exceptions stops being a rule.
 *
 * Same LLMProvider contract + prompt builders as every other brain, so behaviour is
 * identical — only the backend differs.
 */
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'
import { logAiError } from './errorLog'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
/** The default model: the fast free-tier workhorse. Overridable in Settings. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const TIMEOUT_MS = 60_000

export class GeminiProvider implements LLMProvider {
  constructor(
    private key: string,
    private model: string = DEFAULT_GEMINI_MODEL,
    private timeoutMs: number = TIMEOUT_MS
  ) {}

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    const started = Date.now()
    const model = (this.model || DEFAULT_GEMINI_MODEL).trim()
    const fail = (message: string, o: { permanent?: boolean; status?: number; body?: string } = {}): never => {
      logAiError({
        at: new Date().toISOString(),
        provider: `gemini/${model}`,
        feature: 'text',
        status: o.status,
        ms: Date.now() - started,
        message,
        body: o.body
      })
      throw new LLMRequestError(message, { permanent: o.permanent, status: o.status })
    }
    try {
      const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Key in the HEADER, never the URL — URLs get logged by proxies; headers don't.
          'x-goog-api-key': this.key
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          // A rejected key will still be rejected in an hour — permanent, so the
          // fallback chain moves on instead of retrying it all day.
          fail(
            `Google rejected the Gemini key (${res.status}). Settings → Connect Gemini → "Check the saved key" will say exactly what is wrong.`,
            { permanent: true, status: res.status, body }
          )
        }
        if (res.status === 404) {
          fail(
            `Gemini no longer offers the "${model}" model. Pick another model in Settings → Connect Gemini.`,
            { permanent: true, status: 404, body }
          )
        }
        if (res.status === 429) {
          fail("Gemini's free daily allowance is used up or busy right now. It resets by itself — try again later.", {
            status: 429,
            body
          })
        }
        fail(`Gemini returned ${res.status}.`, { status: res.status, body })
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
        promptFeedback?: { blockReason?: string }
      }
      if (data.promptFeedback?.blockReason) {
        // Gemini refused the CONTENT, not the key: a real answer about this request, not
        // a service fault — so it is not marked permanent and the chain may still help.
        fail(`Gemini declined this request (${data.promptFeedback.blockReason}). Rephrase and try again.`)
      }
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim()
      if (!text) fail('Gemini returned no text. Try again in a moment.')
      return text
    } catch (err) {
      if (err instanceof LLMRequestError) throw err
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      return fail(
        timedOut
          ? `Gemini did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`
          : `Gemini request failed (${err instanceof Error ? err.message : String(err)}). Check your internet connection.`
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
