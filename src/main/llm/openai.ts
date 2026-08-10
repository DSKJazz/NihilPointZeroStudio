import OpenAI from 'openai'
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'
import { logAiError } from './errorLog'
import { CHOSEN_TIMEOUT_MS, SDK_MAX_RETRIES } from './limits'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  /**
   * `timeout` and `maxRetries` are not optional polish. Left to the SDK's defaults
   * (10 minutes, 2 retries) a hung service held one request for half an hour in
   * silence, which is exactly the "the panel never responds" fault. See llm/limits.ts.
   */
  constructor(apiKey: string, private model: string, timeoutMs = CHOSEN_TIMEOUT_MS) {
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: SDK_MAX_RETRIES })
  }

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
      const text = res.choices[0]?.message?.content
      if (!text) throw new LLMRequestError('OpenAI returned no text content')
      return text
    } catch (err) {
      const status = (err as { status?: number })?.status
      const message = err instanceof Error ? err.message : 'OpenAI request failed'
      logAiError({ at: new Date().toISOString(), provider: 'openai', feature: 'text', status, message })
      if (err instanceof LLMRequestError) throw err
      throw new LLMRequestError(message, { status, permanent: status === 401 || status === 403 })
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
