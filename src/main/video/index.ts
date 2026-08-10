import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { stripStageDirections, synthesizeSpeechToFile } from '../voiceover'
import { isPiperInstalled, synthesizeWithPiper } from '../voice/piper'
import { synthesizeWithWinNatural } from '../voice/winNatural'
import {
  beginRenderSession,
  CANCELLED_MESSAGE,
  endRenderSession,
  ffprobeDuration,
  makeFfmpegProgressLogger,
  renderSessionSignal,
  runFfmpeg,
  throwIfCancelled
} from './ffmpeg'
import { attachVoiceover, computeLayout, renderVideo, type VideoResolution } from './render'
import { buildStockBackground } from './stockBackground'
import { buildExportArgs, type ExportFormat } from './export'
import { buildTrimArgs, clampRange, type TrimMode } from './trim'
import { buildStitchArgs } from './stitch'
import { buildSetMusicArgs, type MusicMode } from './music'
import { buildTimelineArgs, videoTrackDuration } from './timeline'
import { buildBeautifyArgs, type BeautifyOptions } from './beautify'
import { buildCompositeArgs, type CompositeOptions } from './composite'
import { chooseEncoderForJob, probeBestH264Encoder, runEncodeWithFallback } from './encoder'
import { runPreflight } from '../preflight'
import { discardCheckpoint, isReusable, openCheckpoint, sweepOldCheckpoints } from './checkpoint'
import type { TimelineDoc } from '../../shared/types'
import { ffmpegVersionText, ffprobeVideoSize } from './ffmpeg'
import { generateCloudFootage } from './aiCloud'
import { estimateReadingSeconds, writeSilentTrack } from './silentTrack'
import { detectLocal, generateLocalClip } from './aiLocal'
import { generatePuterClip, puterSceneCap } from './puter'
import { generatePollinationsClip } from './pollinationsVideo'
import { getAiVideoConfig } from '../store'
import { assembleSceneBackground, generateMotionSceneAssets, type MotionClipGenerator } from './videoEngine'
import { extractCards, extractScenePrompts } from './render'
import { generateImage, sceneImagePrompt } from '../image'
import type { LookEngine, VideoStyle } from '../../shared/types'

export { ffprobeDuration } from './ffmpeg'
export type { VideoResolution } from './render'
export { EXPORT_FORMATS, formatExtension, type ExportFormat } from './export'
export type { TrimMode } from './trim'
export { renderThumbnail } from './thumbnail'

export interface BuildVideoOptions {
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: import('./render').VideoAspect
  /** Graphics v2 finishing template (clean/news/cinematic/bold). */
  template?: import('./templates').VideoTemplate
  /** Optional background music file, mixed (volume-lowered, faded) under the narration. */
  musicPath?: string
  /** Add a soft transition sound at each section change. */
  soundEffects?: boolean
  /** Look engine (default 'presets'). */
  engine?: LookEngine
  /** Visual style for the preset engine (default 'cinematic'). */
  style?: VideoStyle
  /** Optional user image paths for a Ken-Burns slideshow background. */
  images?: string[]
  /** Per-image pacing + visual transitions (Scene Studio) — wins over `images`. */
  imageShots?: import('../../shared/types').ImageShot[]
  /** false = clean build: no title overlay, no section cards drawn over the picture. */
  textOverlays?: boolean
  /** Use real stock footage (online) matched to the script. */
  useStock?: boolean
  /** Pixabay API key for stock footage (required when useStock). */
  stockApiKey?: string
  /** Called once with a small opening-frame preview PNG, so the UI can show the look early. */
  onPreview?: (pngPath: string) => void
  /** If set, the narration WAV is copied here (persisted) so music can later be removed/replaced. */
  narrationOutPath?: string
  /** Which computer voice to narrate with. See NarrationVoice in shared/types.ts. */
  narrationVoice?: 'windows' | 'piper' | 'winnatural' | 'silent'
  /** WinRT voice id when narrationVoice is 'winnatural'. */
  winVoiceId?: string
}

/**
 * Full pipeline: script → free Windows-TTS narration → measured duration →
 * rendered MP4 (1080p or 4K, optional background music) at outPath. Reports
 * coarse progress stages.
 */
export async function buildVideoFromScript(
  title: string,
  body: string,
  outPath: string,
  onProgress?: (stage: string) => void,
  options: BuildVideoOptions = {}
): Promise<void> {
  // Clear any leftover Stop from a previous build so this fresh one isn't aborted.
  beginRenderSession()

  // PREFLIGHT. Fail in one second rather than twenty minutes: the things checked here
  // (ffmpeg refusing to execute, a work folder that cannot be written to, no disk space)
  // all let the render start happily and then kill it at the end, with nothing to show
  // and no clear reason. Warnings do NOT stop the render — this app is built to run
  // offline on free tiers with software encoding, and a preflight that blocks that takes
  // away more than it protects.
  const pre = await runPreflight({
    workDir: dirname(outPath),
    runFfmpegVersion: async () => ffmpegVersionText(),
    detectEncoder: () => probeBestH264Encoder()
  })
  for (const w of pre.warnings) onProgress?.(`⚠ ${w.name}: ${w.detail}`)
  if (!pre.ok) throw new Error(pre.headline)

  // RESUME. A twenty-minute render that dies at minute eighteen used to throw away all
  // eighteen, because the scratch folder was a random temp directory deleted in the
  // `finally`. The narration is the expensive part and it is COMPLETE before anything that
  // commonly fails has even started — Piper reading a long script is minutes of CPU.
  //
  // The checkpoint folder is named after a fingerprint of the inputs that produced its
  // contents, so a changed script cannot see the old narration at all. That safety is
  // structural rather than a check somebody has to remember: a different script means a
  // different folder. See checkpoint.ts for why that matters more than the time saved.
  sweepOldCheckpoints(tmpdir())
  const resume = openCheckpoint(tmpdir(), {
    title,
    body,
    narrationVoice: options.narrationVoice,
    winVoiceId: options.winVoiceId,
    engine: options.engine,
    style: options.style
  })
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-vid-'))
  const wav = resume.narrationPath
  let finished = false
  // Stock B-roll downloads land in their own temp dir (possibly hundreds of MB).
  // Tracked out here so the finally can remove it on EVERY exit — the old cleanup
  // ran only after a successful render, so Stop/failure leaked the whole folder.
  let stockTempDir: string | undefined
  try {
    // Voice priority: use the NATURAL (Piper) voice whenever it's installed, unless the
    // user explicitly picked the robotic Windows voice. This makes "natural" the default
    // for every entry point (Video Studio, Scene Studio, AI Command, batch) instead of
    // silently defaulting to the robotic voice when narrationVoice is left unset.
    // Already spoken by a previous attempt, for THESE words in THIS voice. A zero-length
    // or tiny file is what a process killed mid-write leaves behind, and reusing that
    // would produce a SILENT video — a failure that looks like success — so size is
    // checked, not just existence.
    const narrationReady = isReusable(wav)
    if (narrationReady) {
      onProgress?.('Picking up where the last attempt left off — the narration is already recorded.')
    }
    const wantNatural = options.narrationVoice !== 'windows'
    // Windows NATURAL voice first when explicitly chosen — it's the only engine that can
    // speak Urdu (Asad/Uzma), and it beats both other options on quality. Each step falls
    // through to the next so narration NEVER fails outright.
    let narrated = narrationReady
    if (!narrated && options.narrationVoice === 'silent') {
      // No computer voice at all: lay down silence as long as the script would take to
      // read, so the visuals still have the right pacing for the user to record over.
      onProgress?.('Preparing a silent track (no narration)…')
      await writeSilentTrack(estimateReadingSeconds(body), wav)
      narrated = true
    }
    if (!narrated && options.narrationVoice === 'winnatural') {
      try {
        onProgress?.('Generating narration (Windows natural voice)…')
        await synthesizeWithWinNatural(stripStageDirections(body), wav, options.winVoiceId)
        narrated = true
      } catch {
        /* fall through to Piper / Windows below */
      }
    }
    if (!narrated && wantNatural && isPiperInstalled()) {
      try {
        onProgress?.('Generating narration (natural voice)…')
        await synthesizeWithPiper(stripStageDirections(body), wav)
        narrated = true
      } catch (err) {
        // A user Stop must abort the build; anything else falls through to the
        // Windows voice — this was the ONLY voice branch without a net, so a
        // Piper hiccup used to kill the whole render mid-build.
        if (err instanceof Error && err.message === CANCELLED_MESSAGE) throw err
        onProgress?.('Natural voice failed — using the Windows voice instead…')
      }
    }
    if (!narrated) {
      onProgress?.('Generating narration (Windows voice)…')
      await synthesizeSpeechToFile(body, wav)
    }
    throwIfCancelled()
    onProgress?.('Measuring narration length…')
    const durationSec = await ffprobeDuration(wav)
    // Persist the narration-only track so background music can later be removed/replaced exactly.
    if (options.narrationOutPath) {
      try {
        writeFileSync(options.narrationOutPath, readFileSync(wav))
      } catch {
        /* non-fatal: music editing just won't be available for this video */
      }
    }
    const label = (options.resolution ?? '1080p').toUpperCase()

    const engine = options.engine ?? 'presets'
    // AI engines generate footage from a prompt, then we lay the narration over it.
    // The REAL-motion tiers (ai-free-video, ai-local) degrade gracefully per scene to
    // AI stills and never fail the build; the paid ai-cloud tier keeps its original
    // contract (throws instructive setup errors). The free preset engine (default)
    // always works offline.
    let aiFootage: string | undefined
    // FREE per-scene AI visuals: generate a unique image per script section and animate
    // them. Keyless/no-install; needs internet. Any failure falls back to the animated
    // look below so the build never breaks.
    let aiImages: string[] | undefined

    // Scene prompts shared by every per-scene engine: prefer the writer's OWN
    // [bracketed cinematic directions] so visuals FOLLOW the script shot-for-shot;
    // only when the script has none are scenes derived from the prose. Explicit shots
    // are honoured up to 30; prose-derived scenes scale to length (~1 per 45s, 4–16).
    const deriveScenes = (): string[] => {
      const bracketed = extractScenePrompts(body)
      return bracketed.length
        ? bracketed.slice(0, 30)
        : extractCards(body, title).slice(0, Math.min(16, Math.max(4, Math.round(durationSec / 45))))
    }

    if (engine === 'ai-cloud') {
      onProgress?.('Generating AI footage (cloud)…')
      // scratchDir: the footage lands in this build's scratch, so the finally-cleanup
      // covers it — it used to leak a %TEMP%\ai-cloud-* dir per run.
      aiFootage = await generateCloudFootage({ title, body, durationSec, style: options.style, resolution: options.resolution, scratchDir: scratch })
    } else if (engine === 'ai-free-video' || engine === 'ai-local') {
      const style = options.style ?? 'cinematic'
      const scenes = deriveScenes()
      const layout = computeLayout(options.resolution, options.aspect)
      const isCloudFree = engine === 'ai-free-video'
      const secondsPerScene = Math.max(2, durationSec / Math.max(1, scenes.length))
      // Generation size: models generate best around 720p-class frames; the final
      // render upscales to the chosen resolution. Long side 1280, short side scaled
      // by the project aspect (16:9 → 1280×720, 9:16 → 720×1280), snapped to /32.
      const snap32 = (n: number): number => Math.max(256, Math.round(n / 32) * 32)
      const genW = snap32(layout.w >= layout.h ? 1280 : (1280 * layout.w) / layout.h)
      const genH = snap32(layout.w >= layout.h ? (1280 * layout.h) / layout.w : 1280)

      // Local tier: check the server ONCE up front so the user gets one clear reason
      // instead of N per-scene failures. (The free-cloud tier is checked per scene —
      // its failure modes, like the allowance running out, only appear when generating.)
      let motionCap = isCloudFree ? puterSceneCap() : Infinity
      if (!isCloudFree && !(await detectLocal())) {
        motionCap = 0
        onProgress?.(
          '⚠ Local AI video server not detected (Settings → AI Video explains the ComfyUI setup) — this build uses AI stills instead.'
        )
      }
      if (motionCap > 0) {
        onProgress?.(
          isCloudFree
            ? `REAL AI video (free cloud): ${scenes.length} scenes — real motion for up to ${Math.min(motionCap, scenes.length)} of them…`
            : `REAL AI video (local GPU): generating ${scenes.length} scene clips…`
        )
      }
      // Free-cloud route by config: Puter (no key, account sign-in) or Pollinations
      // (free developer key + daily Pollen — the route that needs NO phone number).
      const aiCfg = getAiVideoConfig()
      const usePollinations = aiCfg.freeCloudProvider === 'pollinations'
      const generator: MotionClipGenerator = isCloudFree
        ? usePollinations
          ? (s) =>
              generatePollinationsClip({
                key: aiCfg.pollinationsKey ?? '',
                model: aiCfg.pollinationsModel,
                ...s,
                signal: renderSessionSignal(),
                onStatus: onProgress
              })
          : (s) => generatePuterClip({ prompt: s.prompt, signal: renderSessionSignal(), onStatus: onProgress })
        : (s) => generateLocalClip({ ...s, signal: renderSessionSignal(), onStatus: onProgress })
      let seam: Awaited<ReturnType<typeof generateMotionSceneAssets>>
      try {
        seam = await generateMotionSceneAssets(generator, {
          scenes,
          title,
          style,
          secondsPerScene,
          width: genW,
          height: genH,
          scratch,
          motionCap,
          // The caller's own images (e.g. Scene Studio's curated stills) are the
          // preferred per-scene fallback — never silently discarded for fresh ones.
          fallbackImages: options.images,
          engineLabel: isCloudFree ? 'free cloud' : 'local GPU',
          signal: renderSessionSignal(),
          onProgress
        })
      } catch (err) {
        // A user Stop must surface as the friendly canonical cancel, not a failure.
        if (err instanceof Error && err.message === 'stopped') throwIfCancelled()
        throw err
      }
      const { assets, motionCount, stoppedReason } = seam
      /**
       * THE HONESTY GATE. If most scenes produced nothing, the "video" would be a black
       * void with a filename — the user found 8 or 9 of those in his folder before
       * anything admitted a problem. One or two lost scenes still pass (the soft-fail
       * promise); a majority lost does not.
       */
      if (scenes.length > 1 && assets.length < scenes.length / 2) {
        throw new Error(
          `Refusing to build: only ${assets.length} of ${scenes.length} scenes could be generated` +
            `${stoppedReason ? ` (${stoppedReason})` : ''}, so the result would be mostly empty. ` +
            'Usually the image/video service is refusing or unreachable right now — check Settings → Setup Health, then build again.'
        )
      }
      const firstStill = assets.find((a) => a.kind === 'image')
      if (firstStill) options.onPreview?.(firstStill.path)
      if (motionCount > 0) {
        // totalSeconds (not secondsPerScene × count): even if a scene was dropped,
        // the assembled background must cover the whole narration — render.ts uses
        // -shortest, so a short background would truncate the video.
        aiFootage = await assembleSceneBackground({ assets, layout, totalSeconds: durationSec, scratch, onProgress })
        onProgress?.(
          motionCount === scenes.length
            ? `✓ All ${scenes.length} scenes are REAL generated motion (${isCloudFree ? 'free cloud' : 'local GPU'}).`
            : `✓ ${motionCount}/${scenes.length} scenes got REAL generated motion; the rest are AI stills.`
        )
      }
      if (!aiFootage) {
        const stills = assets.filter((a) => a.kind === 'image').map((a) => a.path)
        if (stills.length) {
          aiImages = stills
          onProgress?.(
            `⚠ No real AI motion this time${stoppedReason ? ` — ${stoppedReason}` : ''} — built as a photo slideshow instead.`
          )
        } else {
          onProgress?.('⚠ Real AI video and AI stills both unavailable — using the animated look instead.')
        }
      }
    } else if (engine === 'ai-free') {
      const style = options.style ?? 'cinematic'
      const scenes = deriveScenes()
      if (extractScenePrompts(body).length) {
        onProgress?.(`Found ${scenes.length} scene directions in your script — generating one image each…`)
      }
      const made: string[] = []
      for (let i = 0; i < scenes.length; i++) {
        throwIfCancelled() // Stop pressed mid-download must halt the loop, not finish all scenes.
        onProgress?.(`Generating AI visual ${i + 1}/${scenes.length} (free)…`)
        try {
          const imgPath = join(scratch, `ai-scene-${i}.jpg`)
          // signal: a Stop aborts the in-flight generation/download immediately instead of
          // letting the full retry/backoff/timeout cycle run before the next cancel poll.
          await generateImage(sceneImagePrompt(style, scenes[i], title), imgPath, {
            width: 1280,
            height: 720,
            seed: i + 1,
            signal: renderSessionSignal()
          })
          made.push(imgPath)
          if (made.length === 1) options.onPreview?.(imgPath) // show the first one right away
        } catch (err) {
          onProgress?.(`AI visual ${i + 1} failed (${err instanceof Error ? err.message : 'error'}) — continuing…`)
        }
      }
      // Same honesty gate as the motion path: a slideshow missing MOST of its scenes is
      // not the video that was asked for. Zero images keeps the old graceful fallback to
      // the animated look (that is a different, honest product); a majority-failed set
      // refuses with the reason instead of shipping the gaps.
      if (made.length && scenes.length > 1 && made.length < scenes.length / 2) {
        throw new Error(
          `Refusing to build: only ${made.length} of ${scenes.length} scene images could be generated, ` +
            'so the result would be missing most of its scenes. Usually the free image service is refusing or ' +
            'unreachable right now — check Settings → Setup Health, then build again.'
        )
      }
      if (made.length) aiImages = made
      else onProgress?.('Free AI visuals unavailable — using the animated look instead.')
    }

    // Free stock-footage background (online): try to assemble real B-roll matched to
    // the script; on ANY failure (offline, bad key, no matches) fall back silently to
    // the animated visualizer so the build never breaks. This is the "use the internet
    // when it helps, otherwise be creative offline" behaviour.
    let stockBg: string | undefined
    if (!aiFootage && options.useStock && options.stockApiKey && engine === 'presets') {
      try {
        stockBg = await buildStockBackground({
          title,
          body,
          layout: computeLayout(options.resolution, options.aspect),
          durationSec,
          apiKey: options.stockApiKey,
          onProgress
        })
        stockTempDir = dirname(stockBg)
      } catch (err) {
        onProgress?.(`Stock footage unavailable (${err instanceof Error ? err.message : 'error'}) — using the animated look instead.`)
      }
    }

    throwIfCancelled()
    onProgress?.(
      `Rendering ${label} video (~${Math.round(durationSec)}s${options.musicPath ? ', with music' : ''}${options.soundEffects ? ', with SFX' : ''})…`
    )
    await renderVideo({
      title,
      body,
      audioPath: wav,
      durationSec,
      outPath,
      resolution: options.resolution,
      aspect: options.aspect,
      template: options.template,
      musicPath: options.musicPath,
      soundEffects: options.soundEffects,
      style: options.style,
      // Real footage IS the background video (AI cloud/local clip or the assembled
      // per-scene motion background); stock B-roll applies only to presets. It must
      // NEVER ride through `images` — that path is the Ken-Burns zoompan built for
      // stills, and feeding it an MP4 explodes every video frame into d more frames
      // (the same class of frame-explosion bug documented in makeSlideshow).
      backgroundVideo: aiFootage ?? stockBg,
      // Still images: free per-scene AI images → the user's own images.
      images: aiImages ?? options.images,
      // User pacing only applies to the user's OWN stills (Scene Studio) — AI-derived
      // scenes have their own count/order, so per-image seconds wouldn't line up.
      imageShots: aiImages || aiFootage || stockBg ? undefined : options.imageShots,
      textOverlays: options.textOverlays,
      onProgress,
      onPreview: options.onPreview
    })
    onProgress?.('Finalizing…')
    finished = true
  } finally {
    endRenderSession() // a Stop must not outlive the build it stopped
    rmSync(scratch, { recursive: true, force: true })
    // KEPT on failure, discarded on success. A finished render has no use for it, and
    // leaving them behind would quietly fill the disk with narration nobody will hear
    // again. Anything a user never retried is swept after a week, at the top of the next
    // build.
    if (finished) discardCheckpoint(resume.dir)
    if (stockTempDir) {
      try {
        rmSync(stockTempDir, { recursive: true, force: true })
      } catch {
        /* temp cleanup best-effort */
      }
    }
    onProgress?.('Finalizing…')
    finished = true
  } finally {
    endRenderSession() // a Stop must not outlive the build it stopped
    rmSync(scratch, { recursive: true, force: true })
    // KEPT on failure, discarded on success. A finished render has no use for it, and
    // leaving them behind would quietly fill the disk with narration nobody will hear
    // again. Anything a user never retried is swept after a week, at the top of the next
    // build.
    if (finished) discardCheckpoint(resume.dir)
  }
}

/**
 * Transcodes a finished video into a chosen delivery format at `outPath`. Pure arg
 * construction lives in ./export (unit-tested); this just runs ffmpeg.
 */
export async function exportVideo(
  srcPath: string,
  format: ExportFormat,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  await runFfmpeg(buildExportArgs(format, srcPath, outPath), onLog)
}

/**
 * Cuts a finished video: keep only [start, end] or remove that range. Measures the
 * real duration via ffprobe, clamps the requested range, and re-encodes at `outPath`.
 * Non-destructive — the caller keeps the original.
 */
export async function trimVideo(
  srcPath: string,
  mode: TrimMode,
  start: number,
  end: number,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  const duration = await ffprobeDuration(srcPath)
  const range = clampRange(start, end, duration)
  await runFfmpeg(buildTrimArgs(mode, srcPath, range, duration, outPath), onLog)
}

/**
 * Stitches multiple built videos into one at `outPath`. Uses the first video's
 * resolution as the target, scales/pads the rest to match, and picks the fast
 * encoder. Non-destructive.
 */
export async function stitchVideos(
  inputs: string[],
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  if (inputs.length < 2) throw new Error('Pick at least two videos to stitch.')
  const [width, height] = await ffprobeVideoSize(inputs[0])
  // Rough total duration for the encoder heuristic: sum of durations.
  let total = 0
  for (const p of inputs) total += await ffprobeDuration(p).catch(() => 0)
  const encoder = await chooseEncoderForJob(width, height, total)
  await runEncodeWithFallback(
    encoder,
    (encoderArgs) => buildStitchArgs({ inputs, width, height, encoderArgs, outPath }),
    // Real percentage while stitching (total = summed input durations).
    { onLog: makeFfmpegProgressLogger(total, onLog, undefined, 'Stitching'), onNotice: onLog }
  )
}

/**
 * Removes or replaces a built video's background music while keeping the narration
 * exactly — uses the saved narration track, so no AI separation is needed. Produces a
 * new MP4 (original kept). `musicPath` is required for 'replace'.
 */
export async function setVideoMusic(
  videoPath: string,
  narrationPath: string,
  mode: MusicMode,
  musicPath: string | undefined,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  await runFfmpeg(buildSetMusicArgs({ mode, videoPath, narrationPath, musicPath, outPath }), onLog)
}

/**
 * Renders a Timeline NLE project to a single MP4 at `outPath`. Picks the fast
 * encoder for the project's size/length and rebuilds args per attempt (so the
 * HW→CPU fallback works). The timing-critical arg construction is the pure,
 * unit-tested `buildTimelineArgs` (see ./timeline).
 */
export async function renderTimeline(
  doc: TimelineDoc,
  outPath: string,
  onLog?: (line: string) => void
): Promise<void> {
  beginRenderSession() // don't inherit a Stop from a previous build
  try {
    if (!doc.video.length) throw new Error('Add at least one video clip to the timeline before rendering.')
    const total = videoTrackDuration(doc)
    const encoder = await chooseEncoderForJob(doc.width, doc.height, total)
    // Show a real percentage during the encode instead of raw ffmpeg stderr spam.
    await runEncodeWithFallback(encoder, (encoderArgs) => buildTimelineArgs(doc, encoderArgs, outPath), {
      onLog: makeFfmpegProgressLogger(total, onLog),
      onNotice: onLog
    })
  } finally {
    endRenderSession() // a Stop must not outlive the render it stopped
  }
}

/** Beautifies (or roughens) one image to `out` using the pure, tested filter chain. */
export async function beautifyImage(input: string, out: string, opts: BeautifyOptions): Promise<void> {
  await runFfmpeg(buildBeautifyArgs(input, out, opts))
}

/** Composites an RGBA subject cutout (input 1) over a background scene (input 0) to `out`. */
export async function compositeImage(bgPath: string, subjectPath: string, out: string, opts: CompositeOptions): Promise<void> {
  await runFfmpeg(buildCompositeArgs(bgPath, subjectPath, out, opts))
}

/** Replaces a built video's narration with the user's own recorded audio bytes. */
export async function attachRecordedVoice(
  videoPath: string,
  audioBytes: Uint8Array,
  outPath: string
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'finscript-voice-'))
  const audio = join(scratch, 'voice.webm')
  try {
    writeFileSync(audio, Buffer.from(audioBytes))
    await attachVoiceover(videoPath, audio, outPath)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
