/**
 * Resilience wrapper: a busy/flaky free AI service should never hard-block the user.
 * This wraps the chosen provider and, on any failure, transparently retries with the
 * next provider in the chain (e.g. the keyless free Pollinations model). It implements
 * the same LLMProvider interface, so callers don't change.
 */
import type { IdeaGenRequest, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { LLMRequestError, type LLMProvider } from './types'

export class ResilientProvider implements LLMProvider {
  /**
   * Providers to try in order; the first that succeeds wins. At least one required.
   * onFallback fires when provider [i] fails and a later one will be tried — so callers
   * can tell the user which AI actually answered instead of silently degrading.
   */
  constructor(
    private chain: LLMProvider[],
    private onFallback?: (failedIndex: number, err: unknown) => void,
    /** Parallel to chain; lets a permanent failure skip identical later entries. */
    private labels: string[] = [],
    /** Fires with the index of whichever provider actually produced the answer. */
    private onSuccess?: (index: number) => void,
    /**
     * Fires when the LAST provider fails. onFallback deliberately stays silent there
     * (nothing is being fallen back TO), but that failure still needs recording —
     * otherwise the one that finally broke the chain is the one nothing logs.
     */
    private onFinalFailure?: (failedIndex: number, err: unknown) => void
  ) {
    if (!chain.length) throw new Error('ResilientProvider needs at least one provider')
  }

  private async attempt<T>(run: (p: LLMProvider) => Promise<T>): Promise<T> {
    let lastErr: unknown
    const dead = new Set<string>()
    for (let i = 0; i < this.chain.length; i++) {
      const label = this.labels[i]
      // A provider that already failed permanently this call (rejected key, removed
      // model, payment required) cannot succeed a second time — trying it again just
      // doubles the user's wait for an identical error.
      if (label && dead.has(label)) continue
      try {
        const out = await run(this.chain[i])
        try {
          this.onSuccess?.(i)
        } catch {
          // reporting must never turn a good answer into a failure
        }
        return out
      } catch (err) {
        lastErr = err
        if (label && err instanceof LLMRequestError && err.permanent) dead.add(label)
        if (i < this.chain.length - 1) {
          try {
            this.onFallback?.(i, err)
          } catch {
            // a broken fallback reporter must never take the whole chain down with it
          }
        } else {
          // The last provider's failure still needs recording — nothing else will.
          try {
            this.onFinalFailure?.(i, err)
          } catch {
            // same rule as above
          }
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed. Check your internet connection.')
  }

  generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]> {
    return this.attempt((p) => p.generateIdeas(req, trends, ytSignals))
  }
  generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]> {
    return this.attempt((p) => p.generateTrendTopics(focusArea, count))
  }
  generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
    return this.attempt((p) => p.generateScriptBody(req))
  }
  generateThumbnailBrief(topic: string, title: string): Promise<string> {
    return this.attempt((p) => p.generateThumbnailBrief(topic, title))
  }
  generateText(prompt: string, maxTokens?: number): Promise<string> {
    return this.attempt((p) => p.generateText(prompt, maxTokens))
  }
}
