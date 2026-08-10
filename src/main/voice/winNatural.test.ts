import { describe, expect, it } from 'vitest'
import { voicesForLanguage, type WinNaturalVoice } from './winNatural'

const VOICES: WinNaturalVoice[] = [
  { id: '1', name: 'Microsoft David', language: 'en-US' },
  { id: '2', name: 'Microsoft Zira', language: 'en-US' },
  { id: '3', name: 'Microsoft Asad', language: 'ur-PK' },
  { id: '4', name: 'Microsoft Uzma', language: 'ur-PK' }
]

describe('voicesForLanguage', () => {
  it('finds the Urdu (Pakistan) voices by prefix', () => {
    const urdu = voicesForLanguage(VOICES, 'ur')
    expect(urdu.map((v) => v.name).sort()).toEqual(['Microsoft Asad', 'Microsoft Uzma'])
  })
  it('is case-insensitive', () => {
    expect(voicesForLanguage(VOICES, 'UR')).toHaveLength(2)
  })
  it('returns an empty list when nothing matches', () => {
    expect(voicesForLanguage(VOICES, 'fr')).toEqual([])
  })
  it('handles an empty voice list', () => {
    expect(voicesForLanguage([], 'ur')).toEqual([])
  })
})
