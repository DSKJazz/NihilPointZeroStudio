import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPER_VOICE_ID,
  PIPER_VOICES,
  findPiperVoice,
  piperConfigUrl,
  piperModelFileName,
  piperModelUrl,
  resolvePiperVoiceId
} from './piperVoices'

describe('PIPER_VOICES catalogue', () => {
  it('includes at least one real Urdu (Pakistan) voice — the whole point of this feature', () => {
    const urdu = PIPER_VOICES.filter((v) => v.language.toLowerCase().includes('urdu'))
    expect(urdu.length).toBeGreaterThanOrEqual(1)
  })
  it('every voice id is unique (a duplicate would silently overwrite another voice on disk)', () => {
    const ids = PIPER_VOICES.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('the default voice id exists in the catalogue', () => {
    expect(findPiperVoice(DEFAULT_PIPER_VOICE_ID)).toBeDefined()
  })
})

describe('resolvePiperVoiceId', () => {
  it('passes through a known id unchanged', () => {
    expect(resolvePiperVoiceId('ur_PK-fasih-medium')).toBe('ur_PK-fasih-medium')
  })
  it('falls back to the default for an unknown/typo id — narration must never break', () => {
    expect(resolvePiperVoiceId('not-a-real-voice')).toBe(DEFAULT_PIPER_VOICE_ID)
    expect(resolvePiperVoiceId(undefined)).toBe(DEFAULT_PIPER_VOICE_ID)
    expect(resolvePiperVoiceId(null)).toBe(DEFAULT_PIPER_VOICE_ID)
    expect(resolvePiperVoiceId('')).toBe(DEFAULT_PIPER_VOICE_ID)
  })
})

describe('URL builders', () => {
  it('config URL is the model URL plus .json', () => {
    const v = findPiperVoice(DEFAULT_PIPER_VOICE_ID)!
    expect(piperConfigUrl(v)).toBe(`${piperModelUrl(v)}.json`)
  })
  it('model file name matches the voice id', () => {
    const v = findPiperVoice('ur_PK-aegis_female-medium')!
    expect(piperModelFileName(v)).toBe('ur_PK-aegis_female-medium.onnx')
  })
})
