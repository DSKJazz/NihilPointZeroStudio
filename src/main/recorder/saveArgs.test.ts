/**
 * The Recorder now captures at YouTube's bitrates. These tests exist to make sure the
 * save step does not immediately hand that back through a needless re-encode.
 */
import { describe, expect, it } from 'vitest'
import { recordingAudioArgs, recordingVideoArgs } from './saveArgs'
import { AUDIO_ENHANCE_FILTER } from '../video/enhance'

const flag = (args: string[], name: string): string | undefined => args[args.indexOf(name) + 1]

describe('saving a video recording', () => {
  it('copies the streams when the browser already recorded H.264 — no quality lost at all', () => {
    const args = recordingVideoArgs('/tmp/rec.mp4', '/out/rec.mp4', { sourceIsH264: true })
    expect(flag(args, '-c:v')).toBe('copy')
    expect(flag(args, '-c:a')).toBe('copy')
    expect(args).not.toContain('libx264')
    // Still playable before it has fully downloaded, which matters over the phone link.
    expect(args).toContain('+faststart')
  })

  it('converts VP9/webm at CRF 18, not at the old veryfast default', () => {
    const args = recordingVideoArgs('/tmp/rec.webm', '/out/rec.mp4')
    expect(flag(args, '-c:v')).toBe('libx264')
    expect(flag(args, '-crf')).toBe('18')
    expect(flag(args, '-preset')).toBe('medium')
    expect(flag(args, '-pix_fmt')).toBe('yuv420p')
    expect(flag(args, '-b:a')).toBe('192k')
  })

  it('uses the enhance pass when asked, whatever the source was', () => {
    for (const h264 of [true, false]) {
      const args = recordingVideoArgs('/tmp/rec', '/out/rec.mp4', { enhance: true, sourceIsH264: h264 })
      expect(args, `h264=${h264}`).toContain('-vf')
      expect(args).toContain('-af')
    }
  })

  it('always overwrites rather than stalling on a prompt', () => {
    expect(recordingVideoArgs('/a', '/b.mp4')[0]).toBe('-y')
    expect(recordingVideoArgs('/a', '/b.mp4', { sourceIsH264: true })[0]).toBe('-y')
  })

  it('puts the output last, where ffmpeg expects it', () => {
    for (const opts of [{}, { sourceIsH264: true }, { enhance: true }]) {
      expect(recordingVideoArgs('/a', '/out.mp4', opts).at(-1)).toBe('/out.mp4')
    }
  })
})

describe('saving a voice-only recording', () => {
  it('drops any picture, so cover art cannot become a video', () => {
    expect(recordingAudioArgs('/tmp/v.webm', '/out/n.m4a')).toContain('-vn')
  })

  it('encodes AAC at a rate that does justice to narration', () => {
    const args = recordingAudioArgs('/tmp/v.webm', '/out/n.m4a')
    expect(flag(args, '-c:a')).toBe('aac')
    expect(flag(args, '-b:a')).toBe('192k')
  })

  it('cleans the voice with the SAME chain the video enhancer uses', () => {
    // If these ever diverge, the user's voice changes depending on whether they were
    // on camera — which is exactly the kind of thing nobody would think to check.
    const args = recordingAudioArgs('/tmp/v.webm', '/out/n.m4a', { enhance: true })
    expect(flag(args, '-af')).toBe(AUDIO_ENHANCE_FILTER)
  })

  it('leaves the voice untouched when cleanup is off', () => {
    expect(recordingAudioArgs('/tmp/v.webm', '/out/n.m4a')).not.toContain('-af')
  })

  it('puts the output last', () => {
    expect(recordingAudioArgs('/a', '/out.m4a', { enhance: true }).at(-1)).toBe('/out.m4a')
  })
})
