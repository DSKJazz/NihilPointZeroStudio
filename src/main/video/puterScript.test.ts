import { describe, expect, it } from 'vitest'
import { buildHarnessScript, clampSceneCap, classifyPuterError, DEFAULT_PUTER_MODEL } from './puterScript'

describe('classifyPuterError', () => {
  it('recognises an exhausted allowance', () => {
    expect(classifyPuterError('Insufficient funds')).toContain('allowance is used up')
    expect(classifyPuterError('error 402: usage-limited-chat')).toContain('allowance is used up')
  })

  it('recognises a missing/cancelled sign-in', () => {
    expect(classifyPuterError('auth_token missing')).toContain('sign-in')
    expect(classifyPuterError('User cancelled the sign in')).toContain('sign-in')
  })

  it('recognises a dead service and a timeout', () => {
    expect(classifyPuterError('SDK not loaded')).toContain('could not be reached')
    expect(classifyPuterError('Failed to fetch')).toContain('could not be reached')
    expect(classifyPuterError('timeout')).toContain('took too long')
  })

  it('passes unknown errors through, attributed to Puter', () => {
    const v = classifyPuterError('something odd happened')
    expect(v).toContain('Puter reported')
    expect(v).toContain('something odd happened')
  })
})

describe('clampSceneCap', () => {
  it('defaults to 5 for missing/garbage values', () => {
    expect(clampSceneCap(undefined)).toBe(5)
    expect(clampSceneCap(NaN)).toBe(5)
    expect(clampSceneCap('7')).toBe(5)
    expect(clampSceneCap(0)).toBe(5)
    expect(clampSceneCap(-3)).toBe(5)
  })

  it('floors and clamps real values to 1..30', () => {
    expect(clampSceneCap(3.9)).toBe(3)
    expect(clampSceneCap(1)).toBe(1)
    expect(clampSceneCap(99)).toBe(30)
  })
})

describe('buildHarnessScript', () => {
  it('embeds the prompt and model safely via JSON.stringify', () => {
    const script = buildHarnessScript(`a "quoted" prompt\nwith newline`, DEFAULT_PUTER_MODEL)
    expect(script).toContain('\\"quoted\\"')
    expect(script).toContain('\\n')
    expect(script).toContain(DEFAULT_PUTER_MODEL)
    // The raw newline must never appear inside the txt2vid argument string literal.
    expect(script).toContain('puter.ai.txt2vid("a \\"quoted\\" prompt\\nwith newline"')
  })

  it('cannot be broken out of by a malicious scene direction', () => {
    const script = buildHarnessScript(`"); alert('pwned'); ("`, 'm')
    // The injection attempt stays inside the JSON string literal.
    expect(script).not.toContain(`"); alert('pwned'); ("`)
    expect(script).toContain(`\\"); alert('pwned'); (\\"`)
  })

  it('returns chunked-base64 machinery and an error path', () => {
    const script = buildHarnessScript('p', 'm')
    expect(script).toContain('String.fromCharCode.apply')
    expect(script).toContain("ok: false, error: 'SDK not loaded'")
  })
})
