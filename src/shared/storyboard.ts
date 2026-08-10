/**
 * Storyboard Director — the PURE, unit-tested core that turns a plain-English
 * screenplay ("0–15s: I arrive in a Ferrari, VO: '…' → helicopter over the hills,
 * slow fade → UN council, VO: '…'") into a structured storyboard, and compiles that
 * storyboard onto the Timeline engine (see ./timeline).
 *
 * The AI only decides WHAT (a validated list of beats); this tested code decides the
 * HOW (timing, placement, transitions). A hallucinated field can never reach ffmpeg.
 *
 * Two authoring modes, both handled by the same validated pipeline:
 *   • guided  — the user writes the beats and the model structures them.
 *   • auto    — the user pastes a title + script and the model invents the whole
 *               storyboard (mood/genre/shots), which is then validated the same way.
 */
import { MOODS, SFX_KINDS, VIDEO_STYLES } from './types'
import type {
  BeatSound,
  Mood,
  ShotMotion,
  ShotSubject,
  ShotSubjectKind,
  SfxKind,
  StoryboardBeat,
  StoryboardDoc,
  TimelineDoc,
  VideoStyle
} from './types'

const SUBJECT_KINDS: ShotSubjectKind[] = ['none', 'photo', 'clip', 'ai-person']
const MOTIONS: ShotMotion[] = ['still', 'in', 'out', 'left', 'right', 'up', 'down']

/** Minimum sensible beat length; anything shorter reads as a glitch, not a shot. */
const MIN_BEAT = 0.5
/** Hard ceiling per beat so one malformed number can't produce a 9-hour render. */
const MAX_BEAT = 600

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

/** Validates a raw beat sound. Returns null for anything unusable (dropped). */
function sanitizeSound(raw: unknown, i: number, beatDur: number): BeatSound | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = o.kind === 'music' || o.kind === 'sfx' || o.kind === 'file' ? o.kind : null
  if (!kind) return null
  let ref: string | undefined
  let src: string | undefined
  if (kind === 'music') {
    if (!MOODS.includes(o.ref as Mood)) return null
    ref = o.ref as string
  } else if (kind === 'sfx') {
    if (!SFX_KINDS.includes(o.ref as SfxKind)) return null
    ref = o.ref as string
  } else {
    src = str(o.src)
    if (!src) return null
  }
  return {
    id: str(o.id) ?? `snd-${i + 1}`,
    kind,
    ref,
    src,
    gain: typeof o.gain === 'number' && Number.isFinite(o.gain) ? clamp(o.gain, 0, 4) : undefined,
    fadeInSec: clamp(num(o.fadeInSec, 0), 0, beatDur),
    fadeOutSec: clamp(num(o.fadeOutSec, 0), 0, beatDur),
    atSec: clamp(num(o.atSec, 0), 0, beatDur),
    name: str(o.name)
  }
}

function sanitizeSubject(raw: unknown): ShotSubject {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = SUBJECT_KINDS.includes(o.kind as ShotSubjectKind) ? (o.kind as ShotSubjectKind) : 'none'
  return {
    kind,
    description: str(o.description),
    src: str(o.src),
    beautify: typeof o.beautify === 'boolean' ? o.beautify : undefined
  }
}

/**
 * Validates a raw parsed object into a safe StoryboardDoc. Beat durations are clamped,
 * unknown enums defaulted, empty beats dropped. A beat with no visual AND no narration
 * carries nothing to render, so it is dropped. Pure + unit-tested.
 */
export function sanitizeStoryboard(raw: unknown, defaults: { width: number; height: number; fps: number }): StoryboardDoc {
  const o = (raw ?? {}) as Record<string, unknown>
  const style: VideoStyle = VIDEO_STYLES.includes(o.style as VideoStyle) ? (o.style as VideoStyle) : 'cinematic'
  const rawBeats = Array.isArray(o.beats) ? o.beats : []
  const beats: StoryboardBeat[] = []
  rawBeats.forEach((b, i) => {
    const beat = (b ?? {}) as Record<string, unknown>
    const visual = str(beat.visual)
    const narration = str(beat.narration)
    const caption = str(beat.caption)
    // A beat needs SOMETHING to show or say.
    if (!visual && !narration && !caption) return
    const durationSec = clamp(num(beat.durationSec, 5), MIN_BEAT, MAX_BEAT)
    const transitionSec = clamp(num(beat.transitionSec, 0), 0, durationSec)
    beats.push({
      id: str(beat.id) ?? `beat-${i + 1}`,
      durationSec,
      visual: visual ?? (narration ? `A fitting scene for: ${narration.slice(0, 80)}` : 'A cinematic establishing shot'),
      narration,
      caption,
      subject: sanitizeSubject(beat.subject),
      transitionSec,
      motion: MOTIONS.includes(beat.motion as ShotMotion) ? (beat.motion as ShotMotion) : 'in',
      mood: str(beat.mood),
      sounds: (Array.isArray(beat.sounds) ? beat.sounds : [])
        .map((s, si) => sanitizeSound(s, si, durationSec))
        .filter((s): s is BeatSound => s !== null)
    })
  })
  return {
    title: str(o.title) ?? 'Untitled',
    style,
    width: defaults.width,
    height: defaults.height,
    fps: defaults.fps,
    language: str(o.language),
    beats
  }
}

/** Total run length of the storyboard = Σ durations − Σ crossfades (they overlap). */
export function storyboardDuration(doc: StoryboardDoc): number {
  if (!doc.beats.length) return 0
  // Derive from beatStartTimes so it stays consistent with the (crossfade-clamped) starts.
  const starts = beatStartTimes(doc)
  const last = doc.beats.length - 1
  return Math.max(0, starts[last] + doc.beats[last].durationSec)
}

/**
 * The master-timeline start time of each beat. Beat i begins where the previous beat's
 * run ends, pulled back by its own crossfade (which overlaps the previous beat) — this
 * is exactly the xfade offset the timeline engine uses, so captions and narration line
 * up frame-accurately with the picture. Pure + unit-tested.
 */
export function beatStartTimes(doc: StoryboardDoc): number[] {
  const starts: number[] = []
  let acc = 0
  doc.beats.forEach((b, i) => {
    // Clamp the crossfade to the incoming clip AND the length available so far, so a
    // beat can never start before 0 (a short predecessor would otherwise pull it negative).
    const t = i > 0 ? Math.min(clamp(b.transitionSec ?? 0, 0, b.durationSec), acc) : 0
    const start = i === 0 ? 0 : acc - t
    starts.push(start)
    acc = start + b.durationSec
  })
  return starts
}

/** A resolved (generated/located) beat sound, ready to place on the timeline. */
export interface ResolvedBeatSound {
  path: string
  /** Offset within the beat, seconds (added to the beat start on the master timeline). */
  atSec: number
  /** Playable length of the sound, seconds. */
  outSec: number
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
}

/** A resolved asset for one beat: the rendered clip and (optionally) its narration + sounds. */
export interface ResolvedBeatAsset {
  /** Path to the beat's rendered video clip (background + subject composite + motion). */
  clipPath: string
  /** Path to the beat's narration audio, if any. */
  narrationPath?: string
  /** Actual length of the narration audio in seconds (to place/trim it), if known. */
  narrationDurationSec?: number
  /** Per-beat sounds (music/SFX/file), already resolved to files. */
  sounds?: ResolvedBeatSound[]
}

/**
 * Compiles a validated storyboard + its resolved per-beat assets into a TimelineDoc the
 * timeline engine can render. Every beat becomes a video clip (with its crossfade); each
 * caption becomes a text overlay anchored to the beat's start; each narration becomes an
 * audio clip placed at the beat's start. All timing comes from beatStartTimes, so it is
 * consistent with the picture. Pure + unit-tested.
 */
export function compileStoryboardToTimeline(
  doc: StoryboardDoc,
  assets: Record<string, ResolvedBeatAsset>
): TimelineDoc {
  const starts = beatStartTimes(doc)
  const video = doc.beats.map((b, i) => ({
    id: b.id,
    src: assets[b.id]?.clipPath ?? '',
    name: b.mood ? `${i + 1}. ${b.mood}` : `Shot ${i + 1}`,
    inSec: 0,
    outSec: b.durationSec,
    transitionSec: i > 0 ? clamp(b.transitionSec ?? 0, 0, b.durationSec) : 0
  }))

  const text = doc.beats
    .map((b, i) => ({ b, start: starts[i] }))
    .filter(({ b }) => !!b.caption)
    .map(({ b, start }) => ({
      id: `cap-${b.id}`,
      text: b.caption as string,
      startSec: start,
      endSec: start + b.durationSec,
      x: 'center' as const,
      y: 'bottom' as const,
      fadeSec: Math.min(0.4, b.durationSec / 4)
    }))

  const audio: TimelineDoc['audio'] = []
  doc.beats.forEach((b, i) => {
    const start = starts[i]
    const asset = assets[b.id]
    // Narration.
    if (b.narration && asset?.narrationPath) {
      const dur = asset.narrationDurationSec && asset.narrationDurationSec > 0 ? asset.narrationDurationSec : b.durationSec
      audio.push({
        id: `vo-${b.id}`,
        src: asset.narrationPath,
        name: `VO ${b.id}`,
        inSec: 0,
        outSec: dur,
        atSec: start,
        gain: 1,
        fadeInSec: 0,
        fadeOutSec: Math.min(0.3, dur / 4)
      })
    }
    // Per-beat sounds (music / SFX / user file), placed at beat start + their own offset.
    ;(asset?.sounds ?? []).forEach((snd, si) => {
      audio.push({
        id: `snd-${b.id}-${si}`,
        src: snd.path,
        name: `SFX ${b.id}.${si}`,
        inSec: 0,
        outSec: snd.outSec,
        atSec: start + snd.atSec,
        gain: snd.gain ?? 1,
        fadeInSec: snd.fadeInSec ?? 0,
        fadeOutSec: snd.fadeOutSec ?? 0
      })
    })
  })

  return { width: doc.width, height: doc.height, fps: doc.fps, video, audio, text }
}

/**
 * No-AI DIRECTOR FALLBACK: turns a script or shot-pointers into a raw storyboard object
 * (feed it through sanitizeStoryboard) without any model call — so "Direct storyboard"
 * ALWAYS produces an editable board, even when the AI is down, weak, or returns garbage.
 *
 * Understands, in order of preference:
 *  1) Timed pointer lines — "0-15s: …", "0:00 to 0:15 …", "15 – 40 sec …" (forgiving
 *     about format); a `VO: "…"` part inside a line becomes that beat's narration.
 *  2) [Bracketed visual directions] of the kind pro scripts use (each becomes a shot).
 *  3) Plain prose — split into ~2-sentence beats; the text is both narration and the
 *     basis of the visual. Durations follow speech pace (~2.5 words/sec).
 * If totalSeconds is given, beat durations are scaled to roughly match it. Pure.
 */
export function storyboardFromScript(input: {
  title: string
  brief: string
  totalSeconds?: number
  language?: string
}): unknown {
  const brief = (input.brief || '').trim()
  const beats: Record<string, unknown>[] = []

  const toSec = (t: string): number => {
    const mm = /^(\d{1,3})[:.](\d{2})$/.exec(t)
    return mm ? Number(mm[1]) * 60 + Number(mm[2]) : Number(t)
  }
  const voSplit = (text: string): { visual: string; narration?: string } => {
    const m = /\bVO\s*:\s*/i.exec(text)
    if (!m) return { visual: text }
    const visual = text.slice(0, m.index).replace(/[,;.\s]+$/, '').trim()
    const narration = text.slice(m.index + m[0].length).replace(/^["'“]|["'”]$/g, '').trim()
    return { visual: visual || narration, narration: narration || undefined }
  }

  // 1) Timed pointer lines (forgiving: "0-15s", "0:00 to 0:15", "15 – 40 seconds").
  const timeRe =
    /^(?:from\s+)?(\d{1,3}[:.]\d{2}|\d{1,4})\s*(?:s|sec|secs|seconds?)?\s*(?:-|–|—|to)\s*(\d{1,3}[:.]\d{2}|\d{1,4})\s*(?:s|sec|secs|seconds?)?\s*[:.\-–—)]?\s*(.+)$/i
  const lines = brief.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const timed = lines
    .map((l) => timeRe.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !!m[3]?.trim())
  if (timed.length >= 2) {
    for (const m of timed) {
      const from = toSec(m[1])
      const to = toSec(m[2])
      const { visual, narration } = voSplit(m[3].trim())
      // Forgive swapped/typo'd times: use the absolute span, minimum 2s.
      const span = Math.abs(to - from)
      beats.push({
        durationSec: clamp(span >= 1 ? span : 5, 2, 120),
        visual,
        narration,
        motion: 'in',
        transitionSec: 0.8
      })
    }
  }

  // 2) Descriptive [bracketed visual directions] (≥20 chars so [HOOK] tags don't count).
  if (!beats.length) {
    const blocks = [...brief.matchAll(/\[([^\]]{20,600})\]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
    if (blocks.length >= 3) {
      for (const visual of blocks) {
        beats.push({ durationSec: 8, visual, motion: 'in', transitionSec: 0.8 })
      }
    }
  }

  // 3) Plain prose → beats sized to fit. THE 493-SHOT INCIDENT: a long Roman-Urdu
  // script of short sentences, paired two-per-beat, produced 493 beats against a
  // 606-second target; the scaler squeezed each ~7s beat to 1s, the 2s floor pushed
  // every one back up, and the "606s" film was 493 flashes totalling 986s. The number
  // of beats has to be decided BY the target first (a shot needs ~6s to register and
  // to carry its narration), and only then are the sentences dealt into that many
  // groups. With no target, beat count follows the narration itself as before.
  if (!beats.length) {
    const clean = brief
      .replace(/^\s*#{1,6}.*$/gm, ' ')
      .replace(/\*\*/g, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/^\s*\d+\.\s+/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const sentences = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 3)
    if (sentences.length) {
      const TARGET_SHOT_SEC = 6
      // How many beats this video can actually hold. Without a target: the old pace,
      // two sentences per beat.
      const maxByTarget = input.totalSeconds && input.totalSeconds > 0
        ? Math.max(1, Math.round(input.totalSeconds / TARGET_SHOT_SEC))
        : Math.ceil(sentences.length / 2)
      const beatCount = Math.min(Math.ceil(sentences.length / 2), maxByTarget)
      const per = Math.ceil(sentences.length / beatCount)
      for (let i = 0; i < sentences.length; i += per) {
        const text = sentences.slice(i, i + per).join(' ')
        const words = text.split(/\s+/).length
        const beatIndex = beats.length
        beats.push({
          durationSec: clamp(Math.round(words / 2.5), 4, 120),
          visual: text,
          narration: text,
          motion: beatIndex % 4 === 0 ? 'in' : beatIndex % 4 === 2 ? 'left' : 'right',
          transitionSec: 0.8
        })
      }
    }
  }

  // Last resort: even a bare title yields ONE editable establishing shot — the button
  // must never come back empty-handed.
  if (!beats.length) {
    beats.push({
      durationSec: 10,
      visual: `Cinematic establishing shot for: ${input.title || brief || 'the video'}`,
      motion: 'in',
      transitionSec: 0
    })
  }

  // Scale to the requested total length EXACTLY. The old version multiplied each beat
  // by a factor, rounded, then clamped to a 2s floor — three separate places for the
  // sum to drift away from the target, and with many beats the floor made the target
  // mathematically unreachable (493 beats x 2s floor = 986s "for" a 606s film). The
  // largest-remainder method distributes the seconds proportionally to each beat's
  // share and hands the leftover whole seconds to the largest fractions, so the sum
  // equals the target to the second, always: the floors give away exactly
  // total - sum(floor) seconds, each remainder gets at most one, and nothing rounds.
  if (input.totalSeconds && input.totalSeconds > 0 && beats.length) {
    const total = Math.round(input.totalSeconds)
    const weights = beats.map((b) => Math.max(1, b.durationSec as number))
    const weightSum = weights.reduce((a, w) => a + w, 0)
    const exact = weights.map((w) => (total * w) / weightSum)
    const floors = exact.map((x) => Math.floor(x))
    let leftover = total - floors.reduce((a, x) => a + x, 0)
    // Hand the leftover seconds to the beats that lost the most in flooring.
    const order = exact
      .map((x, i) => ({ i, frac: x - floors[i] }))
      .sort((a, b) => b.frac - a.frac)
    for (const { i } of order) {
      if (leftover <= 0) break
      floors[i] += 1
      leftover -= 1
    }
    for (let i = 0; i < beats.length; i++) beats[i].durationSec = Math.max(1, floors[i])
    // Beat-count capping above keeps every share >= ~4s in the prose path, so the
    // 1s guard here is a corner-case backstop (e.g. 3 timed beats asked to fit 2s),
    // not a working range. It can overshoot the target only in that degenerate case.
  }

  return { title: input.title || 'Untitled', language: input.language, beats }
}

/**
 * Builds the strict prompt that asks the model for a JSON storyboard. In AUTO mode the
 * model invents the whole thing from a title + script; in GUIDED mode it structures the
 * beats the user described. Either way the output is validated by sanitizeStoryboard.
 */
export function buildStoryboardPrompt(input: {
  mode: 'auto' | 'guided'
  title: string
  brief: string
  totalSeconds?: number
  language?: string
}): string {
  const lines = [
    'You are the DIRECTOR of a video studio. Turn the request into a JSON STORYBOARD of timed beats.',
    'Output ONLY a JSON object of this exact shape (no prose, no markdown fence):',
    '{',
    '  "title": "…",',
    `  "style": "one of: ${VIDEO_STYLES.join(', ')}",`,
    '  "language": "English | Roman Urdu | Urdu",',
    '  "beats": [',
    '    {',
    '      "durationSec": 15,',
    '      "visual": "what the camera SHOWS — a vivid scene description for image generation",',
    '      "narration": "what is spoken during this beat (or omit for silence)",',
    '      "caption": "short on-screen text (optional)",',
    '      "subject": {"kind":"none|photo|clip|ai-person","description":"for ai-person","beautify":true},',
    '      "transitionSec": 1.0,',
    '      "motion": "still|in|out|left|right|up|down",',
    '      "mood": "one-word mood"',
    '    }',
    '  ]',
    '}',
    '',
    'RULES:',
    '- subject.kind "photo" = composite the user\'s real photo into the scene; "clip" = the user\'s own footage;',
    '  "ai-person" = a generated character (NOT the user\'s real face); "none" = scene/B-roll only.',
    '- Make durationSec match the narration length (roughly 2.5 words/second). Keep beats 1–120s.',
    '- Use transitionSec 0 for hard cuts, 0.5–2 for crossfades between moods/locations.',
    '- Choose style, mood and motion to fit the topic. Make it cinematic and retention-optimised.',
    '- Use "caption" only on a few emphasis beats (not every one), and keep it under ~6 words.',
    input.language ? `- Write ALL narration AND captions in ${input.language}.` : '',
    ''
  ]
  if (input.mode === 'auto') {
    lines.push(
      'MODE: AUTO — the user pasted a title and script and wants YOU to decide everything (topic,',
      'mood, genre, style, shot breakdown). Split the script into natural beats with fitting visuals.',
      input.totalSeconds ? `Aim for about ${input.totalSeconds}s total.` : ''
    )
  } else {
    lines.push(
      'MODE: GUIDED — the user described the shots themselves. Faithfully structure THEIR beats,',
      'timings and actions; only fill gaps (visual detail, transitions) where they left them open.'
    )
  }
  lines.push('', `TITLE: ${input.title}`, '', `REQUEST / SCRIPT:`, input.brief, '', 'JSON:')
  return lines.filter((l) => l !== '').join('\n')
}
