import { describe, expect, it } from 'vitest'
import { buildMusicRegionArgs } from './music'

const base = { videoPath: 'v.mp4', musicPath: 'm.mp3', outPath: 'o.mp4' }
const graph = (args: string[]): string => args[args.indexOf('-filter_complex') + 1]

describe('buildMusicRegionArgs', () => {
  it('delays the bed to the region start, in milliseconds', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 2, endSec: 6 }))).toContain('adelay=2000|2000')
  })

  it('trims the bed to the region length', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 2, endSec: 6 }))).toContain('atrim=0:4.000')
  })

  it('loops the music so a short track still covers a long region', () => {
    expect(buildMusicRegionArgs({ ...base, startSec: 0, endSec: 60 })).toContain('-stream_loop')
  })

  it('copies the video stream rather than re-encoding it', () => {
    const args = buildMusicRegionArgs({ ...base, startSec: 1, endSec: 5 })
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy')
  })

  // A 2-second bed with a 1.5s fade in AND out would be nothing but fade.
  it('shrinks the fades for a short region', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 0, endSec: 2 }))).toContain('afade=t=in:st=0:d=0.500')
  })

  it('caps the fades at 1.5s for a long region', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 0, endSec: 120 }))).toContain('afade=t=in:st=0:d=1.500')
  })

  it('ducks the music under the original audio', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 0, endSec: 10 }))).toContain('sidechaincompress')
  })

  it('refuses to build a backwards region, clamping to a minimum span', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: 5, endSec: 1 }))).toContain('atrim=0:0.500')
  })

  it('clamps a negative start to zero', () => {
    expect(graph(buildMusicRegionArgs({ ...base, startSec: -4, endSec: 3 }))).toContain('adelay=0|0')
  })

  // A silent source (screen recording, downloaded clip) has no [0:a] at all. Referencing
  // it makes ffmpeg abort with "Stream specifier ':a' ... matches no streams", so adding
  // music to a silent video used to fail outright.
  describe('when the video has no audio track', () => {
    const silent = { ...base, startSec: 1, endSec: 4, hasAudio: false }

    it('never references the missing source audio stream', () => {
      expect(graph(buildMusicRegionArgs(silent))).not.toContain('[0:a]')
    })

    it('does not try to duck against audio that is not there', () => {
      expect(graph(buildMusicRegionArgs(silent))).not.toContain('sidechaincompress')
    })

    it('still places the bed at the right moment', () => {
      expect(graph(buildMusicRegionArgs(silent))).toContain('adelay=1000|1000')
    })

    it('pads so the audio track spans the whole video', () => {
      expect(graph(buildMusicRegionArgs(silent))).toContain('apad')
    })

    it('lets the video length end the encode, so padding cannot run forever', () => {
      expect(buildMusicRegionArgs(silent)).toContain('-shortest')
    })

    it('keeps ducking and omits -shortest when the video DOES have audio', () => {
      const withAudio = buildMusicRegionArgs({ ...base, startSec: 1, endSec: 4, hasAudio: true })
      expect(graph(withAudio)).toContain('sidechaincompress')
      expect(withAudio).not.toContain('-shortest')
    })

    it('assumes audio is present when not told otherwise, preserving old behaviour', () => {
      expect(graph(buildMusicRegionArgs({ ...base, startSec: 1, endSec: 4 }))).toContain('[0:a]')
    })
  })
})
