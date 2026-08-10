import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'

export interface LLMProvider {
  generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]>
  generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]>
  generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }>
  generateThumbnailBrief(topic: string, title: string): Promise<string>
  /** Generic single-prompt completion, used to orchestrate multi-part feature-length scripts. */
  generateText(prompt: string, maxTokens?: number): Promise<string>
}

export class LLMConfigError extends Error {}

export class LLMRequestError extends Error {
  /**
   * True when retrying this same provider cannot possibly help — a rejected key,
   * a removed model, a service demanding payment. Retrying those only makes the
   * user wait twice as long for an identical failure, which is exactly what made
   * the app look frozen. Transient trouble (busy, timeout, network) stays false.
   */
  readonly permanent: boolean
  readonly status?: number

  constructor(message: string, opts?: { permanent?: boolean; status?: number }) {
    super(message)
    this.permanent = opts?.permanent ?? false
    this.status = opts?.status
  }
}
