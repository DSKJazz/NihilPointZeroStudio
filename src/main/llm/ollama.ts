import { request as httpRequest } from 'http'
import type { IdeaGenRequest, OllamaStatus, ScriptGenRequest, TrendTopic, VideoIdea, YouTubeSignal } from '../../shared/types'
import { buildIdeaPrompt, buildScriptPrompt, buildThumbnailPrompt, buildTrendPrompt } from '../prompts'
import { LLMRequestError, type LLMProvider } from './types'
import { extractJson, parseScriptResponse } from './parse'
import { logAiError } from './errorLog'

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const OLLAMA_HOST = '127.0.0.1'
const OLLAMA_PORT = 11434
// CPU-only generation of a long script can take many minutes. Node's built-in
// fetch() enforces a hidden ~5-min headers timeout and reports the abort as a
// generic network error ("could not connect"), so we use a raw http request with
// an explicit, generous inactivity timeout instead.
const SOCKET_IDLE_TIMEOUT_MS = 20 * 60 * 1000

export async function getOllamaStatus(): Promise<OllamaStatus> {
  try {
    // Local server — either it answers instantly or it isn't running.
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { connected: false, models: [] }
    const data = await res.json()
    const models = Array.isArray(data?.models) ? data.models.map((m: { name: string }) => m.name) : []
    return { connected: true, models }
  } catch {
    return { connected: false, models: [] }
  }
}

function ollamaChat(model: string, prompt: string, numPredict: number, timeoutMs = SOCKET_IDLE_TIMEOUT_MS): Promise<string> {
  const payload = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    // Ollama defaults to a 2048-token context regardless of the model's real
    // capacity, which silently truncates long scripts mid-generation.
    options: { num_ctx: 8192, num_predict: numPredict }
  })

  return new Promise<string>((resolve, reject) => {
    const req = httpRequest(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          if ((res.statusCode ?? 500) >= 400) {
            reject(new LLMRequestError(`Ollama request failed (${res.statusCode}): ${body.slice(0, 300)}`))
            return
          }
          try {
            const content = JSON.parse(body)?.message?.content
            if (!content) reject(new LLMRequestError('Ollama returned no content'))
            else resolve(content)
          } catch {
            reject(new LLMRequestError('Ollama returned a malformed response'))
          }
        })
      }
    )

    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(
        new LLMRequestError(
          `Ollama did not respond within ${Math.round(timeoutMs / 60000)} minute(s). On a CPU-only machine long scripts are slow — try a shorter length, or switch on Gemini (free, Settings → Connect Gemini) for cloud speed at no cost.`
        )
      )
    })

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new LLMRequestError(
            `Could not reach Ollama at ${OLLAMA_BASE_URL}. Open the Ollama app so it is running, then try again.`
          )
        )
      } else {
        reject(new LLMRequestError(`Ollama request error: ${err.message}`))
      }
    })

    req.write(payload)
    req.end()
  })
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Streaming chat against Ollama. Emits each token via onToken as it arrives
 * (Ollama returns newline-delimited JSON when stream:true) and resolves with the
 * full concatenated text. Used by the Advisor so replies appear live.
 */
export function ollamaChatStream(
  model: string,
  messages: ChatTurn[],
  onToken: (delta: string) => void,
  numPredict = 2048
): Promise<string> {
  const payload = JSON.stringify({
    model,
    messages,
    stream: true,
    options: { num_ctx: 8192, num_predict: numPredict }
  })

  return new Promise<string>((resolve, reject) => {
    let full = ''
    let buffer = ''
    const req = httpRequest(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new LLMRequestError(`Ollama request failed (${res.statusCode})`))
          res.resume()
          return
        }
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => {
          buffer += chunk
          let nl: number
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line) continue
            try {
              const token = JSON.parse(line)?.message?.content
              if (typeof token === 'string' && token) {
                full += token
                onToken(token)
              }
            } catch {
              // Ignore a partial/non-JSON line; the next chunk completes it.
            }
          }
        })
        res.on('end', () => resolve(full))
      }
    )

    req.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      req.destroy()
      reject(new LLMRequestError('Ollama did not respond in time. Try again or switch providers in Settings.'))
    })
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new LLMRequestError(`Could not reach Ollama at ${OLLAMA_BASE_URL}. Open the Ollama app, then try again.`))
      } else {
        reject(new LLMRequestError(`Ollama request error: ${err.message}`))
      }
    })
    req.write(payload)
    req.end()
  })
}

export class OllamaProvider implements LLMProvider {
  /**
   * timeoutMs defaults to the generous 20-minute allowance the user's CHOSEN provider
   * deserves. When Ollama is only a fallback the caller passes something far shorter —
   * waiting 20 minutes on a backup brain is indistinguishable from a frozen app.
   */
  constructor(private model: string, private timeoutMs = SOCKET_IDLE_TIMEOUT_MS) {}

  private async complete(prompt: string, numPredict = 2048): Promise<string> {
    const started = Date.now()
    try {
      return await ollamaChat(this.model, prompt, numPredict, this.timeoutMs)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ollama request failed'
      logAiError({
        at: new Date().toISOString(),
        provider: `ollama/${this.model}`,
        feature: 'text',
        ms: Date.now() - started,
        message
      })
      throw err
    }
  }

  async generateTrendTopics(focusArea: string, count: number): Promise<TrendTopic[]> {
    const text = await this.complete(buildTrendPrompt(focusArea, count))
    return extractJson<TrendTopic[]>(text)
  }

  async generateIdeas(
    req: IdeaGenRequest,
    trends: TrendTopic[],
    ytSignals: YouTubeSignal[]
  ): Promise<Omit<VideoIdea, 'id' | 'createdAt'>[]> {
    const text = await this.complete(buildIdeaPrompt(req, trends, ytSignals))
    return extractJson<Omit<VideoIdea, 'id' | 'createdAt'>[]>(text)
  }

  async generateScriptBody(req: ScriptGenRequest): Promise<{ title: string; body: string }> {
    const text = await this.complete(buildScriptPrompt(req), 6000)
    return parseScriptResponse(text)
  }

  async generateThumbnailBrief(topic: string, title: string): Promise<string> {
    return (await this.complete(buildThumbnailPrompt(topic, title), 1000)).trim()
  }

  async generateText(prompt: string, maxTokens = 2500): Promise<string> {
    return (await this.complete(prompt, maxTokens)).trim()
  }
}
