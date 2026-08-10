/**
 * The failure mode here is a video with words chopped off — and you only discover it
 * by watching the whole thing back. So the tests assert the two structural guarantees
 * hardest: keeps never overlap, and keeps never run backwards.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEEP_PAUSE_SEC,
  DEFAULT_MIN_SILENCE_SEC,
  buildCutArgs,
  detectArgs,
  parseSilences,
  planKeeps,
  summarise
} from './silence'

/** Real ffmpeg silencedetect output, interleaved as it actually arrives. */
const FFMPEG_OUT = `
[Parsed_silencedetect_0 @ 0x55] silence_start: 12.3456
frame=  300 fps=0.0 q=-1.0 size=N/A time=00:00:10.00 bitrate=N/A speed=  20x
[Parsed_silencedetect_0 @ 0x55] silence_end: 15.6789 | silence_duration: 3.3333
[Parsed_silencedetect_0 @ 0x55] silence_start: 40
[Parsed_silencedetect_0 @ 0x55] silence_end: 42.5 | silence_duration: 2.5
`

const total = (keeps: { startSec: number; endSec: number }[]): number =>
  keeps.reduce((n, k) => n + (k.endSec - k.startSec), 0)

describe('reading ffmpeg’s measurements', () => {
  it('pairs each start with its end and ignores the noise between them', () => {
    expect(parseSilences(FFMPEG_OUT)).toEqual([
      { startSec: 12.3456, endSec: 15.6789 },
      { startSec: 40, endSec: 42.5 }
    ])
  })

  it('drops a silence that starts and never ends rather than inventing one', () => {
    // A trailing silence running to the end of the file gets no end line. Guessing a
    // duration here would guess wrong; the caller knows the real length.
    expect(parseSilences('silence_start: 50')).toEqual([])
  })

  it('copes with empty, junk and undefined output', () => {
    expect(parseSilences('')).toEqual([])
    expect(parseSilences('nothing useful here at all')).toEqual([])
    expect(() => parseSilences(undefined as unknown as string)).not.toThrow()
  })

  it('asks ffmpeg for a measurement, not a file', () => {
    const args = detectArgs('/in.mp4')
    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
    expect(args.join(' ')).toContain(`d=${DEFAULT_MIN_SILENCE_SEC}`)
  })
})

describe('the two things that must never happen', () => {
  const messy = [
    { startSec: 40, endSec: 42.5 },
    { startSec: 12, endSec: 15 },
    { startSec: 12.5, endSec: 14 }, // overlaps the one before it
    { startSec: 60, endSec: 59 } // backwards
  ]

  it('never produces overlapping keeps, even from overlapping input', () => {
    const keeps = planKeeps(messy, { durationSec: 90 })
    for (let i = 1; i < keeps.length; i++) {
      expect(keeps[i].startSec).toBeGreaterThanOrEqual(keeps[i - 1].endSec)
    }
  })

  it('never produces a keep that runs backwards', () => {
    for (const k of planKeeps(messy, { durationSec: 90 })) {
      expect(k.endSec).toBeGreaterThan(k.startSec)
    }
  })

  it('never keeps more than the video contains', () => {
    expect(total(planKeeps(messy, { durationSec: 90 }))).toBeLessThanOrEqual(90)
  })
})

describe('what it leaves alone', () => {
  it('leaves a real pause at every cut, not a hard splice', () => {
    // Zero-gap speech is exhausting and obviously machine-cut. Worse than the pauses.
    const keeps = planKeeps([{ startSec: 10, endSec: 14 }], { durationSec: 30 })
    expect(keeps[0].endSec).toBeCloseTo(10 + DEFAULT_KEEP_PAUSE_SEC, 5)
  })

  it('protects the opening — a jolt in the hook is the worst place for one', () => {
    const keeps = planKeeps([{ startSec: 0.2, endSec: 1.1 }], { durationSec: 30 })
    expect(keeps).toHaveLength(1)
    expect(keeps[0].startSec).toBe(0)
  })

  it('protects the sign-off at the end', () => {
    const keeps = planKeeps([{ startSec: 29.2, endSec: 29.9 }], { durationSec: 30 })
    expect(keeps[keeps.length - 1].endSec).toBe(30)
  })

  it('leaves natural speech rhythm alone entirely', () => {
    // Comma and sentence pauses are 0.2-0.8s. ffmpeg is asked for >= 0.9s, so these
    // never even reach the planner — but if the threshold is ever loosened, the
    // planner must still not shred the take.
    expect(planKeeps([], { durationSec: 60 })).toEqual([{ startSec: 0, endSec: 60 }])
  })

  it('discards fragments too short to be a shot', () => {
    // Two silences 50ms apart would leave a flicker between them. Stitching hundreds
    // of those is how this feature goes wrong.
    const keeps = planKeeps(
      [
        { startSec: 10, endSec: 12 },
        { startSec: 12.05, endSec: 14 }
      ],
      { durationSec: 30, keepPauseSec: 0 }
    )
    for (const k of keeps) expect(k.endSec - k.startSec).toBeGreaterThanOrEqual(0.12)
  })
})

describe('the arithmetic', () => {
  it('removes the silence and keeps the rest', () => {
    // 60s with two gaps of 4s and 3s; a 0.25s pause is kept at each.
    const keeps = planKeeps(
      [
        { startSec: 10, endSec: 14 },
        { startSec: 30, endSec: 33 }
      ],
      { durationSec: 60 }
    )
    const s = summarise(keeps, 60)
    expect(s.cuts).toBe(2)
    expect(s.removedSec).toBeCloseTo(7 - 2 * 0.25, 5)
    expect(s.keptSec).toBeCloseTo(53.5, 5)
  })

  it('reports in minutes and seconds, as a person reads them', () => {
    const keeps = planKeeps([{ startSec: 10, endSec: 145 }], { durationSec: 600 })
    expect(summarise(keeps, 600).headline).toMatch(/Removed 2:1\d of dead air across 1 cut/)
  })

  it('says so plainly when there is nothing to cut', () => {
    expect(summarise(planKeeps([], { durationSec: 60 }), 60).headline).toMatch(/already tight/)
  })

  it('copes with a zero-length video', () => {
    expect(planKeeps([{ startSec: 1, endSec: 2 }], { durationSec: 0 })).toEqual([])
  })
})

describe('the cut command keeps lips on words', () => {
  const keeps = [
    { startSec: 0, endSec: 10.25 },
    { startSec: 14, endSec: 60 }
  ]
  const args = buildCutArgs('/in.mp4', '/out.mp4', keeps, ['-c:v', 'libx264', '-crf', '20'])

  it('filters BOTH streams by the same windows', () => {
    // Filtering audio alone is what ffmpeg's own silenceremove does, and it is why
    // lips stop matching words. The two expressions must be identical.
    const vf = args[args.indexOf('-vf') + 1]
    const af = args[args.indexOf('-af') + 1]
    const windows = (s: string): string[] => s.match(/between\(t,[\d.]+,[\d.]+\)/g) ?? []
    expect(windows(vf)).toEqual(windows(af))
    expect(windows(vf)).toHaveLength(2)
  })

  it('rebuilds the timestamps, or the output freezes over every cut', () => {
    expect(args[args.indexOf('-vf') + 1]).toContain('setpts=N/FRAME_RATE/TB')
    expect(args[args.indexOf('-af') + 1]).toContain('asetpts=N/SR/TB')
  })

  it('uses the detected encoder', () => {
    expect(buildCutArgs('/i', '/o', keeps, ['-c:v', 'h264_nvenc'])).toContain('h264_nvenc')
  })

  it('overwrites, streams early, and puts the output last', () => {
    expect(args[0]).toBe('-y')
    expect(args).toContain('+faststart')
    expect(args.at(-1)).toBe('/out.mp4')
  })
})
