import { describe, it, expect } from 'vitest'
import { extractCards, computeLayout, dimensionsFor, buildAudioFilter, buildFfmpegArgs, planSlideshowShots, framesForShots } from './render'
import { buildAutoZoomFilter, planShots } from './autoZoom'

describe('computeLayout', () => {
  it('1080p is 1920x1080 with base sizes', () => {
    const l = computeLayout('1080p')
    expect([l.w, l.h]).toEqual([1920, 1080])
    expect(l.titleFont).toBe(56)
    expect(l.cardFont).toBe(72)
  })
  it('4k is exactly double 1080p (same layout, sharper)', () => {
    const l = computeLayout('4k')
    expect([l.w, l.h]).toEqual([3840, 2160])
    expect(l.titleFont).toBe(112)
    expect(l.waveW).toBe(3840)
  })
  it('8k is 7680x4320 (4x)', () => {
    const l = computeLayout('8k')
    expect([l.w, l.h]).toEqual([7680, 4320])
    expect(l.titleFont).toBe(224)
  })
  it('1440p is 2560x1440', () => {
    expect(computeLayout('1440p').w).toBe(2560)
  })
  it('defaults to 1080p', () => {
    expect(computeLayout().w).toBe(1920)
  })
})

describe('dimensionsFor (aspect ratios)', () => {
  it('16:9 is unchanged (landscape) across tiers', () => {
    expect(dimensionsFor('1080p', '16:9')).toEqual([1920, 1080])
    expect(dimensionsFor('4k', '16:9')).toEqual([3840, 2160])
    expect(dimensionsFor('8k', '16:9')).toEqual([7680, 4320])
  })
  it('9:16 is vertical (Shorts/Reels): tall, short side = tier', () => {
    expect(dimensionsFor('1080p', '9:16')).toEqual([1080, 1920])
    expect(dimensionsFor('4k', '9:16')).toEqual([2160, 3840])
  })
  it('1:1 is square', () => {
    expect(dimensionsFor('1080p', '1:1')).toEqual([1080, 1080])
    expect(dimensionsFor('4k', '1:1')).toEqual([2160, 2160])
  })
  it('font scaling is consistent (short side) across shapes at the same tier', () => {
    // Vertical 1080p and landscape 1080p share the short side (1080) → same font sizes.
    expect(computeLayout('1080p', '9:16').titleFont).toBe(computeLayout('1080p', '16:9').titleFont)
    expect(computeLayout('1080p', '1:1').titleFont).toBe(56)
  })
})

describe('buildAudioFilter', () => {
  const layout = computeLayout('1080p')
  it('narration only: waveform plus the YouTube level, no mixing', () => {
    const a = buildAudioFilter({ hasMusic: false, sfxTimesSec: [], dur: 10, layout })
    expect(a.audioMap).toBe('[aout]')
    const f = a.chains.join(';')
    expect(f).toContain('showwaves')
    expect(f).toContain('asplit=2[awave][anarr]') // the audio feeds the waveform AND the output
    expect(f).not.toContain('amix')
    expect(a.extraInputs).toEqual([])
  })

  it('levels every video to what YouTube actually wants', () => {
    // YouTube normalises every upload to about -14 LUFS. Delivering louder does not make
    // the video louder — it makes YouTube turn it down, which costs the dynamics that
    // were mixed in and gains nothing. This must hold on BOTH paths, because most videos
    // on this channel are narration-only.
    for (const opts of [
      { hasMusic: false, sfxTimesSec: [] as number[] },
      { hasMusic: true, sfxTimesSec: [] as number[] },
      { hasMusic: true, sfxTimesSec: [5, 10] }
    ]) {
      const f = buildAudioFilter({ ...opts, dur: 30, layout }).chains.join(';')
      expect(f, JSON.stringify(opts)).toContain('loudnorm=I=-14:TP=-1.5:LRA=11')
    }
  })

  it('levels LAST, after the limiter — order is the whole point', () => {
    // loudnorm's TP=-1.5 caps the true peak, so it has to be the final word on level.
    // Putting it before the limiter would let the limiter pull peaks back down and undo it.
    const f = buildAudioFilter({ hasMusic: true, sfxTimesSec: [5], dur: 30, layout }).chains.join(';')
    expect(f.indexOf('alimiter')).toBeLessThan(f.indexOf('loudnorm'))
  })

  it('never levels the waveform branch — that is a picture, not sound', () => {
    const a = buildAudioFilter({ hasMusic: false, sfxTimesSec: [], dur: 10, layout })
    const waveChain = a.chains.find((c) => c.includes('showwaves'))!
    expect(waveChain).not.toContain('loudnorm')
  })
  it('with music: splits narration, lowers + fades music, mixes with normalize=0', () => {
    const a = buildAudioFilter({ hasMusic: true, sfxTimesSec: [], dur: 30, layout })
    expect(a.audioMap).toBe('[aout]')
    const f = a.chains.join(';')
    expect(f).toContain('asplit=2[awave][anarr]') // narration used twice → must split
    expect(f).toContain('volume=0.18') // music ducked under narration
    expect(f).toContain('afade=t=in') // smart placement: fades in…
    expect(f).toContain('afade=t=out') // …and out
    expect(f).toContain('amix=inputs=2:duration=first:normalize=0') // narration stays full
    expect(a.extraInputs).toEqual(['music'])
  })
  it('with SFX: one delayed whoosh per transition, mixed in order', () => {
    const a = buildAudioFilter({ hasMusic: true, sfxTimesSec: [5, 10, 15], dur: 20, layout })
    const f = a.chains.join(';')
    expect(f).toContain('adelay=5000:all=1') // first transition at 5s
    expect(f).toContain('adelay=15000:all=1') // third at 15s
    expect(f).toContain('amix=inputs=5') // narration + music + 3 sfx
    expect(a.extraInputs).toEqual(['music', 'sfx', 'sfx', 'sfx'])
  })
})

describe('buildFfmpegArgs', () => {
  const layout8k = computeLayout('8k')
  const base = { layout: layout8k, dur: 5, audioPath: 'n.wav', sfxCount: 0, filter: '[x]null[y]', videoMap: '[y]', outPath: 'out.mp4' }
  it('encodes the requested resolution (8K) into the color source', () => {
    const args = buildFfmpegArgs({ ...base, audioMap: '1:a' })
    expect(args.join(' ')).toContain('s=7680x4320')
    expect(args).toContain('+faststart') // YouTube-friendly
  })
  it('adds a looped music input only when musicPath is given', () => {
    const without = buildFfmpegArgs({ ...base, audioMap: '1:a' })
    expect(without).not.toContain('-stream_loop')
    const withMusic = buildFfmpegArgs({ ...base, musicPath: 'song.mp3', audioMap: '[aout]' })
    expect(withMusic.join(' ')).toContain('-stream_loop -1 -i song.mp3')
  })
  it('adds one whoosh input per SFX cue', () => {
    const args = buildFfmpegArgs({ ...base, sfxCount: 3, whooshPath: 'wh.wav', audioMap: '[aout]' })
    const inputCount = args.filter((a, i) => a === '-i' && args[i + 1] === 'wh.wav').length
    expect(inputCount).toBe(3)
  })
  // Regression: -shortest governs the output, so a file background even slightly
  // shorter than the narration used to silently cut off the end of the video.
  it('loops a file background so -shortest is governed by the narration', () => {
    const args = buildFfmpegArgs({ ...base, background: { kind: 'file', path: 'bg.mp4' }, audioMap: '1:a' })
    expect(args.join(' ')).toContain('-stream_loop -1 -i bg.mp4')
    expect(args).toContain('-shortest')
  })
})

describe('extractCards', () => {
  it('pulls bracketed stage directions / section titles from the script', () => {
    const body = '[PATTERN INTERRUPT]\nHook line\n[BLUF]\nBottom line\n[TAKEAWAY]\nWrap'
    expect(extractCards(body, 'My Title')).toEqual(['PATTERN INTERRUPT', 'BLUF', 'TAKEAWAY'])
  })
  it('dedupes repeated labels', () => {
    const body = '[EVIDENCE]\na\n[EVIDENCE]\nb\n[COUNTERPOINT]\nc'
    expect(extractCards(body, 'T')).toEqual(['EVIDENCE', 'COUNTERPOINT'])
  })
  it('falls back to generic cards for very short prose', () => {
    const cards = extractCards('just prose with no headers', 'Rupee Devaluation')
    expect(cards.length).toBeGreaterThanOrEqual(2)
    expect(cards[0]).toContain('Rupee')
  })
  it('derives MANY scenes from a normal (bracket-less) script so videos are not static', () => {
    const body = Array.from({ length: 9 }, (_, i) =>
      `Sentence number ${i} explains an important point about the economy in detail here.`
    ).join(' ')
    const cards = extractCards(body, 'Economy')
    expect(cards.length).toBeGreaterThanOrEqual(4) // no longer just 3 static cards
  })
  it('scales scene count UP for a long script (a 25-min-style script gets many sections)', () => {
    // ~80 sentences of real prose → should yield far more than the old cap of 10.
    const body = Array.from({ length: 80 }, (_, i) =>
      `Point number ${i} discusses copper gold and molybdenum demand across the mineral supercycle in real detail.`
    ).join(' ')
    const cards = extractCards(body, 'Supercycle')
    expect(cards.length).toBeGreaterThan(20)
    expect(cards.length).toBeLessThanOrEqual(40)
  })
})

describe('the slow camera move that renderVideo puts on footage', () => {
  // renderVideo itself needs ffmpeg and a disk, so what is asserted here is the CONTRACT
  // it relies on. The wiring bug this catches was real and silent: the call passed
  // `totalSeconds` where planShots wants `durationSec`, so it planned ZERO shots and the
  // filter came out as `zoompan=z='1'` — a filter that costs a full re-encode of every
  // frame and moves nothing. Nothing failed. The video just looked exactly as flat as
  // before, which is the hardest kind of bug to notice.
  it('plans real shots for the durations a video actually is', () => {
    for (const durationSec of [12, 45, 120, 600]) {
      const shots = planShots({ durationSec })
      expect(shots.length, `${durationSec}s planned nothing`).toBeGreaterThan(0)
    }
  })

  it('never plans a shot that does not move', () => {
    // fromScale === toScale is a frozen frame, which is the thing this replaces.
    for (const durationSec of [12, 30, 45, 90, 600]) {
      for (const s of planShots({ durationSec })) {
        expect(s.fromScale, `${durationSec}s: ${JSON.stringify(s)}`).not.toBe(s.toScale)
      }
    }
  })

  it('the filter it builds names the exact output size, so the frame never changes shape', () => {
    // A crop-based move changes the frame size at each cut and the encoder rejects the
    // stream. zoompan scales back to a fixed size; the size must be the project's.
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [3840, 2160]
    ]) {
      const f = buildAutoZoomFilter(planShots({ durationSec: 45 }), w, h, 25)
      expect(f).toContain(`s=${w}x${h}`)
      expect(f).toContain('d=1') // every frame processed — the footage, not-a-still setting
    }
  })

  it('stays well inside the command-line length a filter has to fit in', () => {
    // A ten-minute video is 45 shots, and the whole filter_complex shares one command
    // line (Windows caps that at 32767 characters).
    expect(buildAutoZoomFilter(planShots({ durationSec: 600 }), 1920, 1080, 25).length).toBeLessThan(8000)
  })
})

describe('slideshow shot lengths: tightening pace, exact total', () => {
  // The bug this guards is the one that made the pacing module pointless for months of
  // renders: planSlideshowShots computed the lengths, and makeSlideshow threw them away
  // by using one `slot = dur / n` for every shot. Nothing failed; every video just paced
  // identically from first frame to last.
  it('gives later shots less time than earlier ones', () => {
    const shots = planSlideshowShots(4, 120)
    const secs = shots.map((s) => s.seconds!)
    expect(secs.every((s) => typeof s === 'number')).toBe(true)
    expect(secs[secs.length - 1]).toBeLessThan(secs[0])
  })

  it('still adds up to the narration length exactly — this is the sync guarantee', () => {
    for (const dur of [30, 60, 120, 600, 1500]) {
      const total = planSlideshowShots(5, dur).reduce((n, s) => n + (s.seconds ?? 0), 0)
      expect(total, `${dur}s`).toBeCloseTo(dur, 1)
    }
  })

  it('the FRAME counts also add up exactly, so the video is never short', () => {
    for (const dur of [30, 60, 120, 600, 1500]) {
      const shots = planSlideshowShots(5, dur)
      const frames = framesForShots(shots.map((s) => s.seconds), dur, 25)
      expect(frames.reduce((a, b) => a + b, 0), `${dur}s`).toBe(Math.round(dur * 25))
      expect(frames.every((f) => f >= 1), `${dur}s has an empty shot`).toBe(true)
    }
  })

  it('the frame counts still tighten, not just the seconds', () => {
    const shots = planSlideshowShots(4, 120)
    const frames = framesForShots(shots.map((s) => s.seconds), 120, 25)
    expect(frames[frames.length - 1]).toBeLessThan(frames[0])
  })

  it('falls back to an equal split rather than throwing on missing lengths', () => {
    const frames = framesForShots([undefined, undefined, undefined], 30, 25)
    expect(frames.reduce((a, b) => a + b, 0)).toBe(750)
    expect(new Set(frames).size).toBe(1)
    expect(framesForShots([], 30, 25)).toEqual([])
    expect(framesForShots([NaN, -5, 0], 30, 25).reduce((a, b) => a + b, 0)).toBe(750)
  })

  it('survives more shots than there are frames', () => {
    // A pathological case, but it must not return a zero-frame shot.
    const frames = framesForShots(Array.from({ length: 100 }, () => 0.01), 1, 25)
    expect(frames.every((f) => f >= 1)).toBe(true)
  })
})

describe('drawtext never re-enables % expansion', () => {
  // THE INCIDENT: a headline containing "40%" killed the whole build — ffmpeg's drawtext
  // expands %-sequences even when the text comes from a textfile, and a stray % is a
  // hard filtergraph error ("Stray % near ..."), reported to the user as "ffmpeg exited
  // with code null". Finance titles are FULL of percent signs, so this was not an edge
  // case, it was the main case. Every drawtext that renders user text must therefore
  // carry expansion=none. The chain is built inline inside renderVideo, so this pins the
  // source itself — crude, but it fails the moment someone adds a drawtext without it.
  it('every textfile drawtext in render.ts and thumbnail.ts carries expansion=none', async () => {
    const { readFileSync } = await import('fs')
    for (const file of ['src/main/video/render.ts', 'src/main/video/thumbnail.ts']) {
      const src = readFileSync(file, 'utf-8')
      for (const line of src.split('\n')) {
        if (line.includes('drawtext=') && line.includes('textfile=')) {
          expect(line, `${file}: ${line.trim().slice(0, 80)}`).toContain('drawtext=expansion=none')
        }
      }
    }
  })
})
