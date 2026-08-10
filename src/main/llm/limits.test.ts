/**
 * These numbers are the difference between "the AI is slow" and "the panel is dead".
 *
 * The fault they exist to prevent: both paid SDKs were built with nothing but a key,
 * so they used their own defaults — a ten-minute timeout AND two retries. One hung
 * service meant thirty minutes of silence, and the fallback chain never got a turn
 * because nothing had failed yet.
 */
import { describe, expect, it, vi } from 'vitest'

const anthropicCtor = vi.fn()
const openaiCtor = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts: unknown) {
      anthropicCtor(opts)
    }
  }
}))
vi.mock('openai', () => ({
  default: class {
    constructor(opts: unknown) {
      openaiCtor(opts)
    }
  }
}))

import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import {
  CHOSEN_TIMEOUT_MS,
  FALLBACK_TIMEOUT_MS,
  OLLAMA_CHOSEN_TIMEOUT_MS,
  SDK_MAX_RETRIES,
  describeWait
} from './limits'

describe('the waits themselves', () => {
  it('bounds every one of them — an unbounded wait is the actual bug', () => {
    for (const ms of [CHOSEN_TIMEOUT_MS, FALLBACK_TIMEOUT_MS, OLLAMA_CHOSEN_TIMEOUT_MS]) {
      expect(Number.isFinite(ms)).toBe(true)
      expect(ms).toBeGreaterThan(0)
    }
  })

  it('gives a backup a SHORTER leash than the chosen provider', () => {
    // The user has already waited through one failure by the time a backup is tried.
    expect(FALLBACK_TIMEOUT_MS).toBeLessThan(CHOSEN_TIMEOUT_MS)
  })

  it('never lets the chosen provider wait longer than a person will', () => {
    // Four minutes is already a long stare at a spinner; ten was indefensible.
    expect(CHOSEN_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('turns SDK retries off, because the chain is the better retry', () => {
    // An SDK retry re-asks the SAME broken service. The chain moves to a different one.
    // Leaving both on meant every failure was paid for three times over.
    expect(SDK_MAX_RETRIES).toBe(0)
  })

  it('describes a wait in words a person uses', () => {
    expect(describeWait(45_000)).toBe('45 seconds')
    expect(describeWait(60_000)).toBe('1 minute')
    expect(describeWait(4 * 60_000)).toBe('4 minutes')
  })
})

describe('the paid SDKs are actually constructed with them', () => {
  it('Anthropic gets a timeout and no retries', () => {
    anthropicCtor.mockClear()
    new AnthropicProvider('k', 'claude-x')
    expect(anthropicCtor).toHaveBeenCalledWith({
      apiKey: 'k',
      timeout: CHOSEN_TIMEOUT_MS,
      maxRetries: SDK_MAX_RETRIES
    })
  })

  it('OpenAI gets a timeout and no retries', () => {
    openaiCtor.mockClear()
    new OpenAIProvider('k', 'gpt-x')
    expect(openaiCtor).toHaveBeenCalledWith({
      apiKey: 'k',
      timeout: CHOSEN_TIMEOUT_MS,
      maxRetries: SDK_MAX_RETRIES
    })
  })

  it('accepts the short leash when used as a fallback', () => {
    anthropicCtor.mockClear()
    openaiCtor.mockClear()
    new AnthropicProvider('k', 'm', FALLBACK_TIMEOUT_MS)
    new OpenAIProvider('k', 'm', FALLBACK_TIMEOUT_MS)
    expect(anthropicCtor.mock.calls[0][0]).toMatchObject({ timeout: FALLBACK_TIMEOUT_MS })
    expect(openaiCtor.mock.calls[0][0]).toMatchObject({ timeout: FALLBACK_TIMEOUT_MS })
  })
})
