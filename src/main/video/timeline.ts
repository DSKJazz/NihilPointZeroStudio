/**
 * Timeline NLE engine — the PURE, unit-tested core of the non-linear editor.
 *
 * It turns a declarative timeline (a video track of trimmed clips with optional
 * crossfade transitions, a separate audio track of placed/gained/faded clips, and
 * text overlays with fades) into a single ffmpeg `filter_complex` command. No fs,
 * no Electron, no network — so every timing decision (source trim windows, xfade
 * offsets, audio placement, overlay enable ranges) is verifiable in tests. The
 * running/encoding wrapper lives in ./index (`renderTimeline`).
 *
 * Model note: video and audio are SEPARATE tracks (a standard NLE model). Video
 * clips are visual-only; all sound comes from the audio track. This keeps the
 * offset math exact when crossfades shorten the video timeline.
 */
import type { TimelineDoc, TimelineTextOverlay } from '../../shared/types'

const f3 = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3)

/** A font present on every Windows install, escaped for the filtergraph (drawtext needs one). */
function defaultFontFile(): string {
  return `${process.env.WINDIR ?? 'C:\\Windows'}\\Fonts\\arial.ttf`.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** Effective duration of a clip given its source in/out points. Never negative. */
export function clipDuration(inSec: number, outSec: number): number {
  return Math.max(0, outSec - inSec)
}

/**
 * Total video-track duration. Each crossfade transition OVERLAPS the previous and
 * current clip, so it shortens the timeline by its own length:
 *   total = Σ durations − Σ transitions(clips 2..N)
 */
export function videoTrackDuration(doc: TimelineDoc): number {
  let total = 0
  doc.video.forEach((clip, i) => {
    const dur = clipDuration(clip.inSec, clip.outSec)
    total += dur
    if (i > 0) total -= transitionFor(doc.video[i], dur, i)
  })
  return Math.max(0, total)
}

/**
 * A clip's transition INTO it from the previous clip, clamped so it can never be
 * longer than the shorter neighbouring clip (an over-long xfade would read past a
 * clip and desync everything).
 */
function transitionFor(clip: { transitionSec?: number }, thisDur: number, i: number): number {
  const t = typeof clip.transitionSec === 'number' && Number.isFinite(clip.transitionSec) ? Math.max(0, clip.transitionSec) : 0
  return i > 0 ? Math.min(t, thisDur) : 0
}

/** Escapes text for a single-quoted drawtext `text=` token without brittle quote juggling. */
export function sanitizeOverlayText(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '')
    .replace(/'/g, '’') // curly apostrophe → no quote to escape
    .replace(/%/g, ' percent')
    .replace(/:/g, '\\:')
    .trim()
}

/** drawtext x/y expressions for the 9 anchor positions (with a small margin). */
function overlayXExpr(x: TimelineTextOverlay['x']): string {
  if (x === 'left') return '40'
  if (x === 'right') return 'w-tw-40'
  return '(w-tw)/2'
}
function overlayYExpr(y: TimelineTextOverlay['y']): string {
  if (y === 'top') return '60'
  if (y === 'bottom') return 'h-th-80'
  return '(h-th)/2'
}

/**
 * Builds the drawtext chain for the text overlays, applied to `inLabel`, producing
 * `outLabel`. Each overlay renders only within [start,end] (`enable`) and, when a
 * fade is set, ramps alpha 0→1 over the first `fade` s and 1→0 over the last `fade` s.
 */
function buildOverlayChain(overlays: TimelineTextOverlay[], inLabel: string, outLabel: string, fontSizeDefault: number, fontFile: string): string[] {
  if (!overlays.length) return []
  const chains: string[] = []
  let prev = inLabel
  overlays.forEach((ov, i) => {
    const start = Math.max(0, ov.startSec)
    const end = Math.max(start, ov.endSec)
    const size = ov.fontSize && ov.fontSize > 0 ? Math.round(ov.fontSize) : fontSizeDefault
    const x = overlayXExpr(ov.x)
    const y = overlayYExpr(ov.y)
    const fade = ov.fadeSec && ov.fadeSec > 0 ? ov.fadeSec : 0
    const alpha = fade
      ? `:alpha='clip(min((t-${f3(start)})/${f3(fade)}\\,(${f3(end)}-t)/${f3(fade)})\\,0\\,1)'`
      : ''
    const next = i === overlays.length - 1 ? outLabel : `ov${i}`
    // fontfile is REQUIRED: the bundled Windows ffmpeg has no fontconfig, so drawtext
    // without an explicit font aborts the whole render.
    chains.push(
      `[${prev}]drawtext=fontfile='${fontFile}':text='${sanitizeOverlayText(ov.text)}':fontcolor=white:fontsize=${size}:` +
      `box=1:boxcolor=black@0.4:boxborderw=12:x=${x}:y=${y}${alpha}:enable='between(t,${f3(start)},${f3(end)})'[${next}]`
    )
    prev = next
  })
  return chains
}

export interface TimelinePlan {
  /** All `-i` source paths in input order: video clips first, then audio clips. */
  inputs: string[]
  /** filter_complex chains (join with ';'). */
  chains: string[]
  /** Final video pad label to map. */
  videoMap: string
  /** Final audio pad label to map, or null when there is no audio track. */
  audioMap: string | null
}

/**
 * Core builder: timeline → { inputs, filter_complex chains, maps }. Pure.
 * Video clips are trimmed, normalised to WxH@fps, then joined left-to-right —
 * crossfading where a transition is set, hard-cutting (pairwise concat) otherwise.
 * Text overlays are drawn on the joined video. Audio clips are trimmed, gained,
 * faded, delayed to their timeline position and mixed.
 */
export function buildTimelinePlan(doc: TimelineDoc, fontFile: string = defaultFontFile()): TimelinePlan {
  const { width: W, height: H, fps } = doc
  if (!doc.video.length) throw new Error('The timeline has no video clips.')

  const inputs: string[] = []
  const chains: string[] = []

  // 1) Normalise each video clip to a trimmed WxH@fps stream.
  doc.video.forEach((clip, i) => {
    inputs.push(clip.src)
    const inSec = Math.max(0, clip.inSec)
    const outSec = Math.max(inSec, clip.outSec)
    chains.push(
      `[${i}:v]trim=start=${f3(inSec)}:end=${f3(outSec)},setpts=PTS-STARTPTS,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${i}]`
    )
  })

  // 2) Join clips left-to-right, reducing to a single stream.
  let cur = 'v0'
  let acc = clipDuration(doc.video[0].inSec, doc.video[0].outSec)
  for (let i = 1; i < doc.video.length; i++) {
    const dur = clipDuration(doc.video[i].inSec, doc.video[i].outSec)
    // Clamp the crossfade to BOTH the incoming clip AND the composited length so far,
    // so it can never run past a short predecessor (which would make offset underflow).
    const t = Math.min(transitionFor(doc.video[i], dur, i), acc)
    const next = `j${i}`
    if (t > 0) {
      // xfade offset = point in the running timeline where the incoming clip starts
      // to blend = (accumulated length so far) − (transition length).
      const offset = Math.max(0, acc - t)
      chains.push(`[${cur}][v${i}]xfade=transition=fade:duration=${f3(t)}:offset=${f3(offset)}[${next}]`)
      acc = acc + dur - t
    } else {
      chains.push(`[${cur}][v${i}]concat=n=2:v=1:a=0[${next}]`)
      acc = acc + dur
    }
    cur = next
  }

  // 3) Text overlays on the joined video.
  const overlayChains = buildOverlayChain(doc.text ?? [], cur, 'vout', Math.round(H / 18), fontFile)
  if (overlayChains.length) {
    chains.push(...overlayChains)
    cur = 'vout'
  }
  const videoMap = `[${cur}]`

  // 4) Audio track: trim → gain → fades → delay to position → mix.
  let audioMap: string | null = null
  const audio = doc.audio ?? []
  if (audio.length) {
    const mixLabels: string[] = []
    audio.forEach((clip, k) => {
      const idx = doc.video.length + k
      inputs.push(clip.src)
      const inSec = Math.max(0, clip.inSec)
      const outSec = Math.max(inSec, clip.outSec)
      const segLen = outSec - inSec
      const parts = [`atrim=${f3(inSec)}:${f3(outSec)}`, 'asetpts=PTS-STARTPTS', 'aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo']
      const gain = Number.isFinite(clip.gain) && (clip.gain as number) >= 0 ? (clip.gain as number) : 1
      if (gain !== 1) parts.push(`volume=${f3(gain)}`)
      if (clip.fadeInSec && clip.fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${f3(clip.fadeInSec)}`)
      if (clip.fadeOutSec && clip.fadeOutSec > 0) {
        const st = Math.max(0, segLen - clip.fadeOutSec)
        parts.push(`afade=t=out:st=${f3(st)}:d=${f3(clip.fadeOutSec)}`)
      }
      const ms = Math.max(0, Math.round((clip.atSec ?? 0) * 1000))
      if (ms > 0) parts.push(`adelay=${ms}:all=1`)
      chains.push(`[${idx}:a]${parts.join(',')}[a${k}]`)
      mixLabels.push(`[a${k}]`)
    })
    // duration=longest so a trailing music/sfx clip is never cut; normalize=0 keeps levels.
    // alimiter guards against summed narration+music+SFX clipping past 0 dBFS.
    chains.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[amx];[amx]alimiter=limit=0.95:level=disabled[aout]`)
    audioMap = '[aout]'
  }

  return { inputs, chains, videoMap, audioMap }
}

/**
 * Assembles the full ffmpeg argument list for a timeline render, given encoder args
 * (from encoder.ts). Mirrors stitch.ts' output conventions. Pure.
 */
export function buildTimelineArgs(doc: TimelineDoc, encoderArgs: string[], outPath: string, fontFile: string = defaultFontFile()): string[] {
  const plan = buildTimelinePlan(doc, fontFile)
  const args = ['-y']
  for (const src of plan.inputs) args.push('-i', src)
  args.push('-filter_complex', plan.chains.join(';'), '-map', plan.videoMap)
  if (plan.audioMap) args.push('-map', plan.audioMap)
  args.push(...encoderArgs, '-r', String(doc.fps))
  if (plan.audioMap) {
    args.push('-c:a', 'aac', '-b:a', '192k')
    // The narration can be shorter than the picture. Bound the muxed output to the
    // video track so a short voice recording cannot truncate the last shot.
    args.push('-t', f3(videoTrackDuration(doc)))
  }
  args.push('-movflags', '+faststart', outPath)
  return args
}
