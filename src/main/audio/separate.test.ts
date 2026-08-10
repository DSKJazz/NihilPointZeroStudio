import { describe, expect, it } from 'vitest'
import { parseCommandLine, pickStem } from './separate'

describe('pickStem — picking the right side of a vocals/instrumental split', () => {
  const files = [
    { url: 'https://x/no_vocals.wav', type: '' },
    { url: 'https://x/vocals.wav', type: '' }
  ]

  it("'vocals' is never fooled by a no_vocals file listed first", () => {
    expect(pickStem(files, 'vocals')?.url).toBe('https://x/vocals.wav')
  })

  it("'instrumental' finds no_vocals / instrumental / accompaniment names", () => {
    expect(pickStem(files, 'instrumental')?.url).toBe('https://x/no_vocals.wav')
    expect(pickStem([{ url: 'https://x/instrum.wav' }, { url: 'https://x/vocals.wav' }], 'instrumental')?.url).toBe(
      'https://x/instrum.wav'
    )
    expect(pickStem([{ type: 'accompaniment', url: 'https://x/a.wav' }], 'instrumental')?.url).toBe('https://x/a.wav')
  })

  it("'vocals' falls back to the first file when nothing matches; 'instrumental' refuses to guess", () => {
    const odd = [{ url: 'https://x/track1.wav' }, { url: 'https://x/track2.wav' }]
    expect(pickStem(odd, 'vocals')?.url).toBe('https://x/track1.wav')
    expect(pickStem(odd, 'instrumental')).toBeUndefined()
  })
})

describe('parseCommandLine', () => {
  it('splits a plain multi-word command', () => {
    expect(parseCommandLine('python -m demucs')).toEqual(['python', '-m', 'demucs'])
  })

  it('keeps a double-quoted executable path with spaces as one argument', () => {
    expect(parseCommandLine('"C:\\Program Files\\demucs\\demucs.exe" -v')).toEqual([
      'C:\\Program Files\\demucs\\demucs.exe',
      '-v'
    ])
  })

  it('supports single quotes', () => {
    expect(parseCommandLine("'/opt/my tools/demucs' --fast")).toEqual(['/opt/my tools/demucs', '--fast'])
  })

  it('returns [] for empty/whitespace input', () => {
    expect(parseCommandLine('')).toEqual([])
    expect(parseCommandLine('   ')).toEqual([])
  })

  it('treats shell metacharacters as literal text, not operators', () => {
    // Without a shell these can never chain commands — they are just (invalid) args.
    expect(parseCommandLine('demucs && evil.exe')).toEqual(['demucs', '&&', 'evil.exe'])
  })
})
