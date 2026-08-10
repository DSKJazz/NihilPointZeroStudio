import { beforeEach, describe, expect, it } from 'vitest'
import { clearDeadProviders, isProviderDead, recordProviderFailure, recordProviderSuccess } from './deadProviders'

beforeEach(() => clearDeadProviders())

describe('dead provider memory', () => {
  it('does not demote a provider for a single blip', () => {
    recordProviderFailure('free')
    expect(isProviderDead('free')).toBe(false)
  })

  it('demotes after two failures in a row', () => {
    recordProviderFailure('free')
    recordProviderFailure('free')
    expect(isProviderDead('free')).toBe(true)
  })

  // The free service was observed failing as 402, 404, 429, 520 and plain timeouts in one
  // afternoon. Demotion must not depend on recognising the status code.
  it('demotes on repeated failures whatever the reason', () => {
    recordProviderFailure('free', false)
    recordProviderFailure('free', false)
    expect(isProviderDead('free')).toBe(true)
  })

  it('demotes immediately when the refusal is permanent', () => {
    recordProviderFailure('anthropic', true)
    expect(isProviderDead('anthropic')).toBe(true)
  })

  it('a success clears an earlier failure streak', () => {
    recordProviderFailure('free')
    recordProviderSuccess('free')
    recordProviderFailure('free')
    expect(isProviderDead('free')).toBe(false)
  })

  it('a success revives a demoted provider', () => {
    recordProviderFailure('free', true)
    expect(isProviderDead('free')).toBe(true)
    recordProviderSuccess('free')
    expect(isProviderDead('free')).toBe(false)
  })

  it('tracks providers independently', () => {
    recordProviderFailure('free', true)
    expect(isProviderDead('free')).toBe(true)
    expect(isProviderDead('ollama')).toBe(false)
  })

  it('reports an unknown provider as alive', () => {
    expect(isProviderDead('never-seen')).toBe(false)
  })
})
