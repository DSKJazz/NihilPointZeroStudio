/**
 * Storyboard executor — the IMPURE orchestration layer that turns a validated
 * StoryboardDoc into a rendered video, reusing only already-verified engine pieces:
 *   • free per-beat scene images (../image, keyless Pollinations)
 *   • free narration TTS (../voiceover Windows voice, or natural Piper when installed)
 *   • the Ken-Burns clip renderer (./render makeSlideshow)
 *   • the unit-tested timeline compiler + engine (./storyboard, ./timeline via ./index)
 *
 * Per-beat assets are written to a DURABLE folder under the videos dir (not a temp dir)
 * so the returned TimelineDoc can be reopened in the Timeline editor for further edits,
 * and only the user can delete them. Every step reports progress and fails soft: one
 * bad beat falls back to a plain scene rather than aborting the whole render.
 */
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { generateImage, sceneImagePrompt } from '../image'
import { removeBackgroundToPng } from '../image/segment'
import { renderMusic, renderSfx } from '../audio'
import { stripStageDirections, synthesizeSpeechToFile } from '../voiceover'
import { isPiperInstalled, synthesizeWithPiper } from '../voice/piper'
import { makeSlideshow, type Layout } from './render'
import { beautifyImage, compositeImage, ffprobeDuration, renderTimeline } from '.'
import { detectLocal, generateLocalClip } from './aiLocal'
import { generatePuterClip, puterSceneCap } from './puter'
import { generatePollinationsClip } from './pollinationsVideo'
import { getAiVideoConfig } from '../store'
import { cleanupClipTemp, normalizeClip } from './videoEngine'
import { beginRenderSession, endRenderSession, renderSessionSignal, throwIfCancelled } from './ffmpeg'
import { compileStoryboardToTimeline, type ResolvedBeatAsset, type ResolvedBeatSound } from './storyboard'
import { videosDir } from '../store'
import type { Mood, SfxKind, StoryboardDoc, TimelineDoc } from '../../shared/types'

/** Scene-image dimensions at the project's aspect (short side ~720), so a 9:16 or 1:1
 * project isn't hard-cropped from a hardcoded 16:9 generation. Rounded to even. */
function genDims(w: number, h: number): { width: number; height: number } {
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  if (w >= h) return { width: even((720 * w) / h), height: 720 }
  return { width: 720, height: even((720 * h) / w) }
}

/** Builds a full Layout (makeSlideshow needs w/h; the rest scale off the short side). */
function layoutFromDims(w: number, h: number): Layout {
  const k = Math.min(w, h) / 1080
  return {
    w,
    h,
    titleFont: Math.round(56 * k),
    cardFont: Math.round(72 * k),
    waveW: w,
    waveH: Math.round(220 * k),
    titleY: Math.round(90 * k),
    waveMargin: Math.round(50 * k)
  }
}

export interface StoryboardRenderOptions {
  /** The user's real photo, used for beats whose subject.kind === 'photo'. */
  photoPath?: string
  /** Signed beautify strength for the photo, [-1, 1] (0 = leave as-is). */
  beautifyStrength?: number
  /** Prefer the robotic Windows voice over natural Piper. */
  windowsVoice?: boolean
  /**
   * REAL generated motion for AI scene beats: 'ai-free-video' (free cloud via Puter)
   * or 'ai-local' (your ComfyUI server). Unset = the classic animated stills. Every
   * failure falls back to the still for that beat — a render never breaks over this.
   */
  motionEngine?: 'ai-free-video' | 'ai-local'
  onProgress?: (stage: string) => void
}

/** Synthesizes one beat's narration to `wav`, using the natural voice when available. */
async function narrateBeat(text: string, wav: string, windowsVoice?: boolean): Promise<void> {
  if (!windowsVoice && isPiperInstalled()) {
    await synthesizeWithPiper(stripStageDirections(text), wav)
  } else {
    await synthesizeSpeechToFile(text, wav)
  }
}

/**
 * Generates every beat's visual + narration, compiles the storyboard onto the timeline,
 * renders it, and returns both the finished video path and the TimelineDoc (so the UI can
 * open it in the Timeline editor). Assets live durably under videos/storyboard/<projectId>.
 */
export async function renderStoryboard(
  projectId: string,
  doc: StoryboardDoc,
  outPath: string,
  opts: StoryboardRenderOptions = {}
): Promise<{ timeline: TimelineDoc }> {
  try {
    return await renderStoryboardInner(projectId, doc, outPath, opts)
  } finally {
    endRenderSession() // a Stop must not outlive the render it stopped
  }
}

async function renderStoryboardInner(
  projectId: string,
  doc: StoryboardDoc,
  outPath: string,
  opts: StoryboardRenderOptions = {}
): Promise<{ timeline: TimelineDoc }> {
  if (!doc.beats.length) throw new Error('The storyboard has no beats to render.')
  beginRenderSession() // clear a Stop from a previous build; the per-beat loop polls below
  const { onProgress } = opts
  const layout = layoutFromDims(doc.width, doc.height)
  const gen = genDims(doc.width, doc.height)
  const assetDir = join(videosDir(), 'storyboard', projectId)
  // Start clean so a re-render with fewer beats can't leave orphaned clip/beat files behind.
  rmSync(assetDir, { recursive: true, force: true })
  mkdirSync(assetDir, { recursive: true })

  const assets: Record<string, ResolvedBeatAsset> = {}
  // THE HONESTY GATE'S LEDGER. Every beat that could not show its real picture is
  // recorded here — the quiet dark-backdrop substitution stays (one bad beat must not
  // abort an evening's render), but a video that is MOSTLY substitutions is not that
  // video, and shipping it as though it were is how "8 or 9 empty black videos" ended
  // up in the user's folder with nothing anywhere saying why.
  const failedBeats: { tag: string; reason: string }[] = []
  // Effective per-beat duration (may grow to fit narration / match a user clip's real length).
  const effDur: Record<string, number> = {}

  // REAL motion for AI scene beats (optional). Shares the engine seam's reliability
  // contract: per-beat fallback to the still, stop trying after 2 consecutive hard
  // failures, and the free-cloud tier respects the scene cap (protects the allowance).
  let motionOn = !!opts.motionEngine
  const motionCap = opts.motionEngine === 'ai-free-video' ? puterSceneCap() : Infinity
  let motionUsed = 0
  let motionFailures = 0
  if (opts.motionEngine === 'ai-local' && !(await detectLocal())) {
    motionOn = false
    onProgress?.('⚠ Local AI video server not detected (Settings → AI Video) — beats use animated stills instead.')
  }
  const aiCfg = getAiVideoConfig()
  const generateMotion = (prompt: string, seconds: number, seed: number): Promise<string> =>
    opts.motionEngine === 'ai-free-video'
      ? aiCfg.freeCloudProvider === 'pollinations'
        ? generatePollinationsClip({
            key: aiCfg.pollinationsKey ?? '',
            model: aiCfg.pollinationsModel,
            prompt,
            seconds,
            width: gen.width,
            height: gen.height,
            seed,
            signal: renderSessionSignal(),
            onStatus: onProgress
          })
        : generatePuterClip({ prompt, signal: renderSessionSignal(), onStatus: onProgress })
      : generateLocalClip({ prompt, seconds, width: gen.width, height: gen.height, seed, signal: renderSessionSignal(), onStatus: onProgress })

  // Prepare the user's real subject ONCE (beautify + background cutout), reused across all
  // 'photo' beats. Cutout is best-effort; a null cutout falls back to a framed photo.
  let prepared: { basePhoto: string; cutout: string | null } | null | undefined
  async function prepareSubject(): Promise<{ basePhoto: string; cutout: string | null } | null> {
    if (prepared !== undefined) return prepared
    if (!opts.photoPath || !existsSync(opts.photoPath)) {
      prepared = null
      return null
    }
    let basePhoto = opts.photoPath
    const strength = opts.beautifyStrength ?? 0.6
    if (Math.abs(strength) > 0.001) {
      const beautified = join(assetDir, 'me-beautified.jpg')
      try {
        onProgress?.('Beautifying your photo…')
        await beautifyImage(opts.photoPath, beautified, { strength })
        if (existsSync(beautified)) basePhoto = beautified
      } catch {
        /* keep the original photo */
      }
    }
    onProgress?.('Removing photo background (on-device, free)…')
    const cutoutPath = join(assetDir, 'me-cutout.png')
    const ok = await removeBackgroundToPng(basePhoto, cutoutPath)
    if (!ok) onProgress?.('Background cutout unavailable — using your photo framed in the scene instead.')
    prepared = { basePhoto, cutout: ok ? cutoutPath : null }
    return prepared
  }

  for (let i = 0; i < doc.beats.length; i++) {
    throwIfCancelled() // Stop pressed while generating beats must halt here, before more work.
    const beat = doc.beats[i]
    const tag = `Beat ${i + 1}/${doc.beats.length}`
    const usingClip = beat.subject.kind === 'clip' && beat.subject.src && existsSync(beat.subject.src)

    // 1) Narration FIRST — its real length drives how long the shot must be, so speech
    //    never bleeds into the next beat and audio never outlasts the picture.
    let narrationPath: string | undefined
    let narrationDurationSec: number | undefined
    if (beat.narration) {
      onProgress?.(`${tag}: narrating…`)
      const wav = join(assetDir, `vo-${i}.wav`)
      try {
        await narrateBeat(beat.narration, wav, opts.windowsVoice)
        narrationPath = wav
        narrationDurationSec = await ffprobeDuration(wav).catch(() => beat.durationSec)
      } catch (err) {
        onProgress?.(`${tag}: narration failed (${err instanceof Error ? err.message : 'error'}) — this beat will be silent.`)
      }
    }

    // 2) Effective beat length: grow to fit the narration (+ a short tail); for a user clip,
    //    match the footage's real length so downstream crossfade offsets don't drift.
    let dur = beat.durationSec
    if (narrationDurationSec && narrationDurationSec + 0.3 > dur) dur = narrationDurationSec + 0.3
    if (usingClip) {
      const clipLen = await ffprobeDuration(beat.subject.src as string).catch(() => dur)
      if (clipLen > 0) dur = clipLen
    }
    effDur[beat.id] = dur

    // 3) The beat's video clip. ('' can only survive to the asset record if a code path
    // forgot to assign — the compile step drops beats with no real clip file.)
    let clipPath = ''
    let motionClip: string | undefined
    if (usingClip) {
      clipPath = beat.subject.src as string
    } else {
      const subjectNote = beat.subject.kind === 'ai-person' ? `, featuring ${beat.subject.description || 'a person'}` : ''
      let image: string | undefined

      // REAL generated motion first, when chosen — but never for 'photo' beats (those
      // composite the user's actual face; a generated video cannot guarantee it's them).
      if (motionOn && beat.subject.kind !== 'photo' && motionUsed < motionCap && motionFailures < 2) {
        try {
          onProgress?.(`${tag}: generating REAL AI video (${opts.motionEngine === 'ai-free-video' ? 'free cloud' : 'local GPU'})…`)
          const raw = await generateMotion(sceneImagePrompt(doc.style, `${beat.visual}${subjectNote}`, doc.title), dur, i + 1)
          const normalized = join(assetDir, `clip-${i}-motion.mp4`)
          await normalizeClip(raw, layout, dur, normalized)
          cleanupClipTemp(raw)
          motionClip = normalized
          motionUsed++
          motionFailures = 0
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg === 'stopped') {
            // A user Stop must surface as the friendly canonical cancel, not a failure.
            throwIfCancelled()
            throw err
          }
          motionFailures++
          onProgress?.(
            motionFailures >= 2
              ? `Real AI video unavailable — ${msg}. Remaining beats use animated stills.`
              : `${tag}: real video failed (${msg}) — using an animated still for this beat.`
          )
        }
      } else if (motionOn && motionUsed >= motionCap && motionCap !== Infinity && beat.subject.kind !== 'photo') {
        onProgress?.(`${tag}: motion cap reached (${motionCap} per build, adjustable in Settings → AI Video) — animated still.`)
      }

      if (motionClip) {
        clipPath = motionClip
      } else if (beat.subject.kind === 'photo' && opts.photoPath && existsSync(opts.photoPath)) {
        const subj = await prepareSubject()
        onProgress?.(`${tag}: generating your scene…`)
        const bg = join(assetDir, `beat-${i}-bg.jpg`)
        let haveBg = false
        try {
          // signal: Stop aborts this in-flight generation immediately (no retry-cycle wait).
          await generateImage(sceneImagePrompt(doc.style, beat.visual, doc.title), bg, {
            width: gen.width,
            height: gen.height,
            seed: i + 1,
            signal: renderSessionSignal()
          })
          haveBg = existsSync(bg)
        } catch {
          /* handled by fallback below */
        }
        if (subj?.cutout && haveBg) {
          onProgress?.(`${tag}: compositing you into the scene…`)
          const composed = join(assetDir, `beat-${i}.jpg`)
          try {
            await compositeImage(bg, subj.cutout, composed, { width: gen.width, height: gen.height, subjectScale: 0.92, x: 'center', y: 'bottom' })
            image = composed
          } catch {
            image = subj?.basePhoto ?? opts.photoPath
          }
        } else {
          image = subj?.basePhoto ?? opts.photoPath
        }
      } else {
        onProgress?.(`${tag}: generating scene…`)
        const prompt = sceneImagePrompt(doc.style, `${beat.visual}${subjectNote}`, doc.title)
        const imgPath = join(assetDir, `beat-${i}.jpg`)
        try {
          await generateImage(prompt, imgPath, {
            width: gen.width,
            height: gen.height,
            seed: i + 1,
            signal: renderSessionSignal()
          })
          image = imgPath
        } catch (err) {
          onProgress?.(`${tag}: image generation failed (${err instanceof Error ? err.message : 'error'}) — using a plain scene.`)
          failedBeats.push({ tag, reason: err instanceof Error ? err.message : 'image generation failed' })
          const slate = join(assetDir, `beat-${i}-slate.jpg`)
          await generateImage('a simple dark cinematic backdrop', slate, {
            width: gen.width,
            height: gen.height,
            seed: i + 1,
            signal: renderSessionSignal()
          }).catch(() => {})
          image = existsSync(slate) ? slate : imgPath
        }
      }

      if (!motionClip) {
        clipPath = join(assetDir, `clip-${i}.mp4`)
        onProgress?.(`${tag}: animating shot…`)
        // Soft-fail: if animating the chosen image fails, fall back to a plain slate clip so
        // one bad beat never aborts the whole render (the module's stated guarantee).
        try {
          await makeSlideshow([image as string], layout, dur, clipPath)
        } catch (err) {
          onProgress?.(`${tag}: shot render failed (${err instanceof Error ? err.message : 'error'}) — using a plain slate.`)
          const slate = join(assetDir, `beat-${i}-slate.jpg`)
          try {
            await generateImage('a simple dark cinematic backdrop', slate, {
              width: gen.width,
              height: gen.height,
              seed: i + 1,
              signal: renderSessionSignal()
            })
            await makeSlideshow([slate], layout, dur, clipPath)
          } catch {
            // Even the slate failed — skip this beat (compile drops a beat with no clip).
            failedBeats.push({ tag, reason: 'shot could not be rendered at all' })
            continue
          }
        }
      }
    }

    // 4) The beat's sounds (music beds / SFX / the user's own audio), sized to the shot.
    const sounds: ResolvedBeatSound[] = []
    for (let si = 0; si < (beat.sounds ?? []).length; si++) {
      const snd = beat.sounds![si]
      try {
        let path: string | undefined
        let outSec = dur
        if (snd.kind === 'music' && snd.ref) {
          onProgress?.(`${tag}: generating ${snd.ref} music…`)
          path = await renderMusic(snd.ref as Mood, Math.max(2, dur), i + 1)
          outSec = dur
        } else if (snd.kind === 'sfx' && snd.ref) {
          onProgress?.(`${tag}: generating ${snd.ref} sfx…`)
          path = await renderSfx(snd.ref as SfxKind)
          outSec = await ffprobeDuration(path).catch(() => 2)
        } else if (snd.kind === 'file' && snd.src && existsSync(snd.src)) {
          path = snd.src
          outSec = await ffprobeDuration(path).catch(() => dur)
        }
        if (path) sounds.push({ path, atSec: snd.atSec ?? 0, outSec, gain: snd.gain, fadeInSec: snd.fadeInSec, fadeOutSec: snd.fadeOutSec })
      } catch (err) {
        onProgress?.(`${tag}: a sound failed (${err instanceof Error ? err.message : 'error'}) — skipping it.`)
      }
    }

    assets[beat.id] = { clipPath, narrationPath, narrationDurationSec, sounds }
  }

  /**
   * THE HONESTY GATE. A video where more than half the scenes are dark substitute
   * slates is not the video that was asked for — it is a black void with a filename.
   * Building it anyway costs the machine an hour and tells the user nothing; refusing
   * names every failed scene and the real reason (almost always: the free image service
   * refusing everything that day). One or two failed beats still pass — that is the
   * soft-fail promise this module has always made.
   */
  const totalBeats = doc.beats.length
  if (totalBeats > 0 && failedBeats.length > totalBeats / 2) {
    const listed = failedBeats.slice(0, 5).map((f) => `${f.tag}: ${f.reason}`).join('; ')
    throw new Error(
      `Refusing to build: ${failedBeats.length} of ${totalBeats} scenes could not get their real image, ` +
        `so the result would be mostly empty dark frames. First failures — ${listed}` +
        (failedBeats.length > 5 ? '; …' : '') +
        '. Usually the free image service is refusing or unreachable right now: check Settings → Setup Health, then build again.'
    )
  }

  // Compile against the EFFECTIVE durations so beat starts / crossfades / captions all
  // line up with the shots we actually rendered.
  const effDoc: StoryboardDoc = {
    ...doc,
    beats: doc.beats.map((b) => ({ ...b, durationSec: effDur[b.id] ?? b.durationSec }))
  }
  const timeline = compileStoryboardToTimeline(effDoc, assets)
  // A Stop pressed after the last beat must stop HERE — renderTimeline opens a fresh
  // session, which would otherwise erase the pending cancel and render anyway.
  throwIfCancelled()
  onProgress?.('Assembling and rendering the final video…')
  await renderTimeline(timeline, outPath, (line) => onProgress?.(line))
  return { timeline }
}
