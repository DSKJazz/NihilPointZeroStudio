/**
 * The failure this module prevents is SILENT. A wrongly re-encoded stream still plays
 * perfectly — it just looks or sounds slightly worse, permanently, and nobody can point
 * at the moment it happened. So the tests assert the copies as hard as the encodes.
 */
import { describe, expect, it } from 'vitest'
import { YOUTUBE_LOUDNESS, passesSaved, planOnePass, touchesAudio, touchesVideo } from './onePass'

const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
const plan = (ops: Parameters<typeof planOnePass>[2]) => planOnePass('/in.mp4', '/out.mp4', ops, ENC)
const flag = (args: string[], name: string): string => args[args.indexOf(name) + 1]

describe('an untouched stream is COPIED, never re-compressed', () => {
  it('burning captions leaves the sound alone', () => {
    const p = plan({ subtitlePath: '/s.srt' })
    expect(p.reencodesVideo).toBe(true)
    expect(p.reencodesAudio).toBe(false)
    expect(flag(p.args, '-c:a')).toBe('copy')
  })

  it('cleaning the voice leaves the picture alone', () => {
    const p = plan({ enhanceAudio: true })
    expect(p.reencodesVideo).toBe(false)
    expect(flag(p.args, '-c:v')).toBe('copy')
    expect(p.args).not.toContain('libx264')
  })

  it('a trim on its own is a pure copy — instant and lossless', () => {
    // Trimming SELECTS; it does not alter either stream. Re-encoding for a trim is
    // pure waste, and it was happening.
    const p = plan({ trim: { startSec: 10, endSec: 40 } })
    expect(p.reencodesVideo).toBe(false)
    expect(p.reencodesAudio).toBe(false)
    expect(flag(p.args, '-c:v')).toBe('copy')
    expect(flag(p.args, '-c:a')).toBe('copy')
  })

  it('no operations at all is still a valid, lossless command', () => {
    const p = plan({})
    expect(p.args).toContain('copy')
    expect(p.summary).toMatch(/copied as it is/)
  })

  it('says in plain English which stream was spared', () => {
    expect(plan({ subtitlePath: '/s.srt' }).summary).toMatch(/sound was copied untouched/)
    expect(plan({ enhanceAudio: true }).summary).toMatch(/picture was copied untouched/)
  })
})

describe('everything happens in ONE encode', () => {
  it('captions, colour and logo become a single filter chain', () => {
    const p = plan({
      enhanceVideo: true,
      subtitlePath: '/s.srt',
      watermark: { logoPath: '/logo.png', widthPx: 200 }
    })
    // One filter_complex, one encode — not three separate runs.
    expect(p.args.filter((a) => a === '-filter_complex')).toHaveLength(1)
    expect(p.args.filter((a) => a === '-vf')).toHaveLength(0)
    const fc = flag(p.args, '-filter_complex')
    expect(fc).toContain('eq=')
    expect(fc).toContain('subtitles=')
    expect(fc).toContain('overlay=')
  })

  it('polishes and captions BEFORE overlaying the logo', () => {
    // A logo scaled and placed, then run through a sharpen, gets artefacts on its
    // edges. Order in one chain is a real decision, not incidental.
    const fc = flag(
      plan({ enhanceVideo: true, subtitlePath: '/s.srt', watermark: { logoPath: '/l.png', widthPx: 100 } }).args,
      '-filter_complex'
    )
    expect(fc.indexOf('eq=')).toBeLessThan(fc.indexOf('overlay='))
    expect(fc.indexOf('subtitles=')).toBeLessThan(fc.indexOf('overlay='))
  })

  it('combines voice cleanup and loudness into one audio chain', () => {
    const af = flag(plan({ enhanceAudio: true, normaliseLoudness: true }).args, '-af')
    expect(af.split(',').length).toBeGreaterThan(1)
    // Loudness LAST: normalise then compress and the measurement is undone.
    expect(af.indexOf('loudnorm')).toBeGreaterThan(af.indexOf('acompressor'))
  })

  it('counts the passes it saved, so the gain is visible not theoretical', () => {
    expect(passesSaved({ enhanceVideo: true, subtitlePath: '/s.srt', watermark: { logoPath: '/l', widthPx: 1 } })).toBe(2)
    expect(passesSaved({ subtitlePath: '/s.srt' })).toBe(0)
    expect(passesSaved({})).toBe(0)
  })
})

describe('loudness matches what YouTube will do anyway', () => {
  it('targets -14 LUFS', () => {
    // Deliver louder and YouTube turns you down, taking the punch you mixed for.
    expect(YOUTUBE_LOUDNESS).toContain('I=-14')
    expect(flag(plan({ normaliseLoudness: true }).args, '-af')).toContain('I=-14')
  })

  it('keeps a true-peak ceiling, so nothing clips after conversion', () => {
    expect(YOUTUBE_LOUDNESS).toContain('TP=-1.5')
  })
})

describe('trimming', () => {
  it('seeks before the input, not after', () => {
    // After -i, ffmpeg decodes from the start of the file to reach the mark.
    const args = plan({ trim: { startSec: 90 } }).args
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
  })

  it('leaves the end open when only a start was given', () => {
    expect(plan({ trim: { startSec: 5 } }).args).not.toContain('-to')
  })
})

describe('the encoder is the one that was detected', () => {
  it('uses the hardware args when the picture must be re-encoded', () => {
    const p = planOnePass('/i.mp4', '/o.mp4', { subtitlePath: '/s.srt' }, ['-c:v', 'h264_nvenc', '-cq', '19'])
    expect(flag(p.args, '-c:v')).toBe('h264_nvenc')
  })

  it('ignores the encoder entirely when nothing touches the picture', () => {
    const p = planOnePass('/i.mp4', '/o.mp4', { enhanceAudio: true }, ['-c:v', 'h264_nvenc'])
    expect(flag(p.args, '-c:v')).toBe('copy')
    expect(p.args).not.toContain('h264_nvenc')
  })
})

describe('the shape of the command', () => {
  it('overwrites, and puts the output last', () => {
    const args = plan({ subtitlePath: '/s.srt' }).args
    expect(args[0]).toBe('-y')
    expect(args.at(-1)).toBe('/out.mp4')
  })

  it('starts playing before the file has fully downloaded', () => {
    expect(plan({}).args).toContain('+faststart')
  })

  it('keeps the audio when a logo forces stream mapping', () => {
    // With filter_complex, ffmpeg stops picking streams automatically. Forget the
    // audio map and the video comes out SILENT — which is exactly the kind of thing
    // nobody notices until it is published.
    const args = plan({ watermark: { logoPath: '/l.png', widthPx: 120 } }).args
    expect(args).toContain('0:a?')
  })
})

describe('the touch predicates', () => {
  it('agree with what the plan actually does', () => {
    const cases = [
      { enhanceVideo: true },
      { subtitlePath: '/s.srt' },
      { watermark: { logoPath: '/l', widthPx: 1 } },
      { enhanceAudio: true },
      { normaliseLoudness: true },
      { trim: { startSec: 1 } },
      {}
    ]
    for (const ops of cases) {
      const p = plan(ops)
      expect(touchesVideo(ops), JSON.stringify(ops)).toBe(p.reencodesVideo)
      expect(touchesAudio(ops), JSON.stringify(ops)).toBe(p.reencodesAudio)
    }
  })
})
