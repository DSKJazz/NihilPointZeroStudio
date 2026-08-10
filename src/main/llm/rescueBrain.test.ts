import { describe, expect, it } from 'vitest'
import { rescueMessage, rescueTarget, type RescueInputs } from './rescueBrain'

const dead: RescueInputs = {
  activeProvider: 'free',
  activeIsPermanentlyDead: true,
  ollamaAvailable: true,
  freeAvailable: false
}

describe('rescueTarget', () => {
  it('THE INCIDENT: moves off the free service once it demands payment', () => {
    // He never opened Settings, stayed pointed at a service returning HTTP 402, and
    // accumulated 50 silent failures.
    expect(rescueTarget(dead)).toBe('ollama')
  })

  it('stays put while the current brain still works', () => {
    expect(rescueTarget({ ...dead, activeIsPermanentlyDead: false })).toBeNull()
  })

  it('NEVER switches to a paid provider, whatever has died', () => {
    // "Your AI broke so I enabled a paid one" is the worst thing this code could do, and
    // it would break the PAID FEATURES SLEEP rule outright.
    for (const active of ['free', 'ollama', 'anthropic', 'openai']) {
      const t = rescueTarget({ ...dead, activeProvider: active, ollamaAvailable: false, freeAvailable: false })
      expect(t).toBeNull()
    }
    // And even with everything dead, the only targets it will ever name are free/local.
    const t = rescueTarget({ ...dead, activeProvider: 'anthropic', ollamaAvailable: true })
    expect(t).toBe('ollama')
  })

  it('rescues a dead PAID brain to the free local one', () => {
    expect(rescueTarget({ ...dead, activeProvider: 'anthropic' })).toBe('ollama')
  })

  it('prefers the local brain over the hosted one', () => {
    // Local cannot be rate-limited, cannot start charging, and works offline.
    expect(rescueTarget({ ...dead, ollamaAvailable: true, freeAvailable: true })).toBe('ollama')
  })

  it('falls back to the hosted free service when Ollama is not installed', () => {
    expect(rescueTarget({ ...dead, activeProvider: 'anthropic', ollamaAvailable: false, freeAvailable: true })).toBe(
      'free'
    )
  })

  it('never switches to the provider that just died', () => {
    expect(rescueTarget({ ...dead, activeProvider: 'ollama', ollamaAvailable: true, freeAvailable: false })).toBeNull()
  })

  it('stays put when nothing better is available', () => {
    // Staying is always recoverable; the fallback chain still answers this request.
    expect(rescueTarget({ ...dead, ollamaAvailable: false, freeAvailable: false })).toBeNull()
  })
})

describe('rescueMessage', () => {
  it('names what changed, why, and what it gained', () => {
    const m = rescueMessage('free', 'ollama')
    expect(m).toMatch(/free online AI/)
    expect(m).toMatch(/Ollama/)
    expect(m).toMatch(/demands a paid account/)
    expect(m).toMatch(/costs nothing/)
  })

  it('reassures that nothing was lost and it is reversible', () => {
    // A switch the user cannot see or undo is just a different kind of mystery.
    const m = rescueMessage('anthropic', 'ollama')
    expect(m).toMatch(/Nothing was lost/)
    expect(m).toMatch(/change it back/)
  })

  it('gives a sensible reason for a revoked paid key', () => {
    expect(rescueMessage('anthropic', 'ollama')).toMatch(/revoked|refused permanently/)
  })

  it('does not fall over on an unknown provider name', () => {
    expect(() => rescueMessage('something-new', 'ollama')).not.toThrow()
    expect(rescueMessage('something-new', 'ollama')).toContain('something-new')
  })
})
