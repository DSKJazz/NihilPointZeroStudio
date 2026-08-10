/**
 * These numbers decide how the finished video looks, so they are checked against the
 * published figures they claim to come from rather than against themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIO_MIME_PREFERENCE,
  VIDEO_MIME_PREFERENCE,
  audioBitrate,
  describeActual,
  estimateBytes,
  extensionFor,
  frameRateFactor,
  humanSize,
  pickMime,
  videoBitrate,
  videoConstraints,
  widthFor
} from './recordingQuality'

const yt = (height: number, fps: number): number =>
  videoBitrate({ height, fps, tier: 'youtube', content: 'camera' })

describe('bitrate matches YouTube’s published upload table', () => {
  it('hits each 30 fps anchor exactly', () => {
    expect(yt(720, 30)).toBe(5_000_000)
    expect(yt(1080, 30)).toBe(8_000_000)
    expect(yt(1440, 30)).toBe(16_000_000)
    expect(yt(2160, 30)).toBe(45_000_000)
  })

  it('hits each 60 fps anchor exactly — 1.5x, not double', () => {
    expect(yt(720, 60)).toBe(7_500_000)
    expect(yt(1080, 60)).toBe(12_000_000)
    expect(yt(1440, 60)).toBe(24_000_000)
    expect(yt(2160, 60)).toBe(67_500_000)
  })

  it('rises with resolution and with frame rate, always', () => {
    const heights = [360, 480, 720, 900, 1080, 1200, 1440, 1800, 2160, 4320]
    for (let i = 1; i < heights.length; i++) {
      expect(yt(heights[i], 30), `${heights[i]}p`).toBeGreaterThan(yt(heights[i - 1], 30))
    }
    for (const h of heights) expect(yt(h, 60)).toBeGreaterThan(yt(h, 30))
  })

  it('extrapolates 8K by holding 4K’s bits-per-pixel, giving 180 Mbps at 30 fps', () => {
    // 8K is four times 4K's pixels, so four times its rate. The Recorder still offers
    // it because it always has; a camera that cannot manage it reports what it did.
    expect(yt(4320, 30)).toBe(180_000_000)
  })

  it('interpolates between anchors instead of jumping', () => {
    const mid = yt(1200, 30)
    expect(mid).toBeGreaterThan(8_000_000)
    expect(mid).toBeLessThan(16_000_000)
  })
})

describe('frame rate', () => {
  it('is 1.0 at 30 and 1.5 at 60, by definition', () => {
    expect(frameRateFactor(30)).toBe(1)
    expect(frameRateFactor(60)).toBe(1.5)
  })

  it('costs less below 30, not more', () => {
    expect(frameRateFactor(24)).toBeCloseTo(0.9, 10)
    expect(frameRateFactor(24)).toBeLessThan(1)
  })
})

describe('quality tiers', () => {
  it('order is balanced < youtube < master at the same settings', () => {
    const at = (tier: 'balanced' | 'youtube' | 'master'): number =>
      videoBitrate({ height: 1080, fps: 30, tier, content: 'camera' })
    expect(at('balanced')).toBeLessThan(at('youtube'))
    expect(at('youtube')).toBeLessThan(at('master'))
  })

  it('never drops below 1 Mbit, however the multipliers stack', () => {
    expect(videoBitrate({ height: 16, fps: 1, tier: 'balanced', content: 'camera' })).toBe(1_000_000)
  })

  it('gives screen capture more, because text goes mushy before a face does', () => {
    const face = videoBitrate({ height: 1080, fps: 30, tier: 'youtube', content: 'camera' })
    const screen = videoBitrate({ height: 1080, fps: 30, tier: 'youtube', content: 'screen' })
    expect(screen).toBe(Math.round(face * 1.25))
  })

  it('lifts audio with the tier and stays sane', () => {
    expect(audioBitrate('balanced')).toBe(128_000)
    expect(audioBitrate('youtube')).toBe(192_000)
    expect(audioBitrate('master')).toBe(256_000)
  })
})

describe('dimensions', () => {
  it('is 16:9 and always even, because encoders reject odd sides', () => {
    expect(widthFor(1080)).toBe(1920)
    expect(widthFor(720)).toBe(1280)
    expect(widthFor(2160)).toBe(3840)
    for (const h of [361, 719, 1081, 1441]) expect(widthFor(h) % 2, `${h}`).toBe(0)
  })

  it('asks with ideal, never exact, so a weaker camera still records', () => {
    const c = videoConstraints(2160, 60, { facing: 'user' })
    expect(c.height).toEqual({ ideal: 2160 })
    expect(c.width).toEqual({ ideal: 3840 })
    expect(c.frameRate).toEqual({ ideal: 60 })
    expect(c.facingMode).toEqual({ ideal: 'user' })
    expect(JSON.stringify(c)).not.toContain('exact')
  })

  it('pins the device only when one was chosen', () => {
    expect(videoConstraints(1080, 30, { deviceId: 'cam-1' }).deviceId).toEqual({ exact: 'cam-1' })
    expect(videoConstraints(1080, 30).deviceId).toBeUndefined()
  })
})

describe('file size estimate', () => {
  it('is bitrate over eight, times seconds', () => {
    // 8 Mbit video + 192 kbit audio for 60 s = 61.44 MB.
    expect(estimateBytes(8_000_000, 192_000, 60)).toBe(61_440_000)
  })

  it('never goes negative on a nonsense duration', () => {
    expect(estimateBytes(8_000_000, 192_000, -5)).toBe(0)
  })

  it('reads in units a person uses', () => {
    expect(humanSize(estimateBytes(8_000_000, 192_000, 60))).toBe('59 MB')
    expect(humanSize(estimateBytes(45_000_000, 256_000, 20 * 60))).toBe('6.3 GB')
  })
})

describe('codec choice', () => {
  it('prefers hardware H.264 in MP4, which is also the format the app saves', () => {
    expect(pickMime(VIDEO_MIME_PREFERENCE, () => true)).toBe('video/mp4;codecs=avc1.640033,mp4a.40.2')
  })

  it('falls back in order as support drops away', () => {
    const only = (allowed: string) => (t: string): boolean => t === allowed
    expect(pickMime(VIDEO_MIME_PREFERENCE, only('video/webm;codecs=vp9,opus'))).toBe('video/webm;codecs=vp9,opus')
    expect(pickMime(VIDEO_MIME_PREFERENCE, only('video/webm'))).toBe('video/webm')
    expect(pickMime(AUDIO_MIME_PREFERENCE, only('audio/mp4'))).toBe('audio/mp4')
  })

  it('returns nothing when the browser supports none of them, rather than a bad guess', () => {
    expect(pickMime(VIDEO_MIME_PREFERENCE, () => false)).toBeUndefined()
  })

  it('treats a browser that throws on a codec string as a no', () => {
    const throwy = (t: string): boolean => {
      if (t.includes('avc1')) throw new TypeError('bad codec')
      return t === 'video/webm;codecs=vp9,opus'
    }
    expect(pickMime(VIDEO_MIME_PREFERENCE, throwy)).toBe('video/webm;codecs=vp9,opus')
  })

  it('names the file after what was actually recorded', () => {
    expect(extensionFor('video/mp4;codecs=avc1.640033,mp4a.40.2')).toBe('mp4')
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm')
    expect(extensionFor('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extensionFor(undefined)).toBe('webm')
  })
})

describe('telling the user what really happened', () => {
  it('reports the size the camera actually gave, not the one that was asked for', () => {
    expect(describeActual({ width: 1920, height: 1080, frameRate: 29.97 })).toBe(
      'Recording at 1920x1080 (1080p), 30 fps.'
    )
  })

  it('copes with a camera that reports nothing', () => {
    expect(describeActual({})).toBe('Camera started.')
  })
})
