import { useEffect, useMemo, useRef, useState } from 'react'
import { useHistory } from '../hooks/useHistory'
import { useNavigate } from 'react-router-dom'
import type { SceneTransition, VideoAspect, VideoJob, VideoResolution, VideoStyle, VideoTemplate } from '../../../shared/types'
import { SCENE_TRANSITIONS, VIDEO_STYLES, VIDEO_TEMPLATES } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import { useStudio } from '../store/StudioContext'

import { fileUrl, pathFromFileUrl as plainPath } from '../../../shared/mediaUrl'

type SceneStatus = 'idle' | 'generating' | 'done' | 'error'
interface Scene {
  index: number
  label: string
  prompt: string
  img: string | null
  status: SceneStatus
  /** Absolute path to an attached photo — when set, this scene is generated FROM it (img2img). */
  photo?: string | null
  /** Live status/queue message (e.g. photo-scene queue position). */
  msg?: string
  /** How long this scene stays on screen (a weight — the total is fitted to the narration). */
  seconds?: number
  /** How the picture ARRIVES at this scene (cut/fade/slide/…). Ignored for the first scene. */
  transition?: SceneTransition
}

/** Pulls a whole-number percent out of a "Rendering 45% (…)" progress line, else null. */
function parsePct(stage: string | null): number | null {
  if (!stage) return null
  const m = /(\d+)%/.exec(stage)
  return m ? Math.min(100, Number(m[1])) : null
}

/**
 * Scene Studio — generate a video scene-by-scene, WATCH each scene appear, PAUSE any
 * time, rewrite any scene's prompt and regenerate just that scene, then build the final
 * video with a live progress bar. Free AI images, no key. This is the "see it as it
 * happens and steer it" workspace.
 */
export default function SceneStudioPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { scene, setScene, saveStatus } = useStudio()
  const title = scene.title
  const body = scene.body
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  const [direction, setDirection] = useState('')
  const [resolution, setResolution] = useState<VideoResolution>('1080p')
  const [aspect, setAspect] = useState<VideoAspect>('16:9')
  const [template, setTemplate] = useState<VideoTemplate>('cinematic')
  const [fast, setFast] = useState(true)
  const [soundEffects, setSoundEffects] = useState(true)
  // Video look for the final build: your generated stills (classic), or REAL AI motion
  // per scene — free cloud (Puter) or local GPU (ComfyUI). Motion failures fall back to
  // the stills automatically, so the build never breaks.
  const [motion, setMotion] = useState<'stills' | 'ai-free-video' | 'ai-local'>('stills')
  const [photoStrength, setPhotoStrength] = useState(0.5)
  // The GLOBAL scene length. Typed once here, it fills every card's "Stays" box in one
  // go; any card can still be edited afterwards to run longer or shorter than the rest.
  // Empty = automatic pacing (the total always stretches to fit the narration).
  const [everySceneSec, setEverySceneSec] = useState<number | ''>('')

  const [scenes, setScenes] = useState<Scene[]>([])
  // Undo/redo over the scene list. Scene Studio was the one editing surface without it:
  // deleting a scene, or rewriting a prompt you liked, was final for the session — and it
  // is the surface where a scene can represent several minutes of generation.
  const sceneHistory = useHistory(scenes, setScenes)
  // Watch ONE scene before committing to the whole render. A still cannot show whether the
  // camera move drifts the subject out of frame, or whether the grade suits this picture.
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null)
  // Which scene the CURRENT preview belongs to. Separate from previewingIndex, which only
  // means "busy" — the player has to stay visible after the render finishes, and it must
  // appear under the right scene rather than under whichever one was last touched.
  const [previewedIndex, setPreviewedIndex] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // Persist the generated scenes too — NOT just the script. The images are files on disk,
  // so a restored scene shows its picture again; a scene that was mid-generation when you
  // left comes back as ready (idle) rather than stuck "generating". Without this, all your
  // scenes vanished on tab-switch while only the script was kept. (`scenes` is a stable
  // state ref, so this can't cause a save-loop.)
  useAutosave('scene-scenes', scenes, (v) => {
    if (Array.isArray(v) && v.length) {
      setScenes(
        (v as Scene[]).map((s) => ({ ...s, status: s.img ? 'done' : 'idle', msg: undefined }))
      )
    }
  })
  const [generating, setGenerating] = useState(false)
  const [paused, setPaused] = useState(false)
  const [building, setBuilding] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [buildPreview, setBuildPreview] = useState<string | null>(null)
  const [built, setBuilt] = useState<VideoJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refs so the async generation loop always reads the latest prompts/pause state.
  const scenesRef = useRef<Scene[]>([])
  const pausedRef = useRef(false)
  // Each generateRemaining() run gets its own id; a worker whose id is stale exits.
  // Without this, pressing Resume while a paused run still had a request in flight
  // reset pausedRef and REVIVED the old pool alongside the new one — doubling the
  // request rate against the rate-limited free image service.
  const runIdRef = useRef(0)
  const fastRef = useRef(fast)
  const strengthRef = useRef(photoStrength)
  useEffect(() => {
    scenesRef.current = scenes
  }, [scenes])
  useEffect(() => {
    fastRef.current = fast
  }, [fast])
  useEffect(() => {
    strengthRef.current = photoStrength
  }, [photoStrength])
  // Live queue progress for photo-based scenes.
  useEffect(() => {
    const unsub = window.api.scene.onProgress((p) => patchScene(p.index, { msg: p.message }))
    return () => {
      unsub()
    }
  }, [])

  const doneCount = scenes.filter((s) => s.status === 'done').length
  const genPct = scenes.length ? Math.round((doneCount / scenes.length) * 100) : 0
  const buildPct = parsePct(stage)

  function patchScene(index: number, patch: Partial<Scene>): void {
    setScenes((prev) => prev.map((s) => (s.index === index ? { ...s, ...patch } : s)))
  }

  // --- storyboard controls: reorder / add / remove (generation is by scene id, so
  // reordering only changes the sequence used when building) ---
  function moveScene(arrIdx: number, dir: -1 | 1): void {
    setScenes((prev) => {
      const to = arrIdx + dir
      if (to < 0 || to >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(arrIdx, 1)
      copy.splice(to, 0, item)
      return copy
    })
  }
  function addScene(): void {
    setScenes((prev) => {
      const id = (prev.reduce((m, s) => Math.max(m, s.index), -1) + 1) || prev.length
      const prompt = `${style} style, ${direction || title || 'establishing shot'}. high detail, no text, no watermark`
      return [...prev, { index: id, label: 'CUSTOM', prompt, img: null, status: 'idle' as SceneStatus }]
    })
  }
  function removeScene(index: number): void {
    setScenes((prev) => prev.filter((s) => s.index !== index))
  }

  async function useScriptPad(): Promise<void> {
    const pad = await window.api.scriptpad.get()
    if (pad.title) setScene((prev) => ({ ...prev, title: pad.title }))
    if (pad.body) setScene((prev) => ({ ...prev, body: pad.body }))
  }

  async function plan(): Promise<void> {
    if (!body.trim()) {
      setError('Paste or write a script first (use [SECTION] headers for scene boundaries).')
      return
    }
    // Same guard the Storyboard page has: re-planning replaces the whole board —
    // hand-edited prompts, attached photos, every generated image — so never do
    // that silently over existing work.
    if (scenes.length > 0) {
      const ok = await confirmDialog({
        title: 'Re-plan and replace your scenes?',
        message:
          'This replaces the current scene board — including edited prompts, attached photos and generated pictures — with a fresh plan from the script. (The last board stays in autosave history.)',
        confirmLabel: 'Re-plan',
        danger: true
      })
      if (!ok) return
    }
    setError(null)
    setBuilt(null)
    const planned = await window.api.scene.plan(title.trim() || 'Video', body, style, direction)
    setScenes(planned.map((p) => ({ ...p, img: null, status: 'idle' as SceneStatus })))
  }

  /** Generate ONE scene: img2img from an attached photo if present, else free text-to-image. */
  async function genOne(index: number, seedBump = 0): Promise<void> {
    const s = scenesRef.current.find((x) => x.index === index)
    if (!s) return

    const retryable = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err)
      return /429|rate[- ]limit|too many requests|service busy|busy right now|queue/i.test(msg)
    }

    const delay = (attempt: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 2000 * Math.pow(2, attempt) + Math.round(Math.random() * 800)))

    patchScene(index, { status: 'generating', msg: undefined })
    let attempt = 0
    while (true) {
      try {
        const img = s.photo
          ? await window.api.scene.generateFromPhoto(index, s.prompt, s.photo, strengthRef.current)
          : await window.api.scene.generate(s.prompt, index + 1 + seedBump, fastRef.current)
        patchScene(index, { img: `${fileUrl(img)}?t=${Date.now()}`, status: 'done', msg: undefined })
        return
      } catch (err) {
        if (!retryable(err) || attempt >= 2) {
          patchScene(index, { status: 'error', msg: err instanceof Error ? err.message : 'failed' })
          return
        }
        attempt += 1
        const retryMsg = err instanceof Error ? err.message : String(err)
        patchScene(index, {
          status: 'generating',
          msg: `Rate-limited; retrying in ${Math.round(2 * Math.pow(2, attempt) + 0.5)}s…`
        })
        await delay(attempt)
      }
    }
  }

  /**
   * Runs a PACED worker pool over the not-yet-done scenes, honoring Pause, then
   * automatically re-tries any failed scenes (up to 2 extra passes with a breather in
   * between) — so ONE click finishes the whole board even when the free image queue is
   * busy, instead of leaving scenes on "✗ failed" for the user to regenerate by hand.
   */
  async function generateRemaining(): Promise<void> {
    // Starting a run invalidates any previous pool instantly (see runIdRef note).
    const myRun = ++runIdRef.current
    setGenerating(true)
    setPaused(false)
    pausedRef.current = false
    const runPool = async (indexes: number[], seedBump: number): Promise<void> => {
      let cursor = 0
      // The free image service rate-limits parallel requests from one machine: 3 workers
      // made whole batches fail together. 2 (turbo) / 1 (flux or the slow photo queue),
      // with staggered starts, is the reliable pace.
      const anyPhoto = scenesRef.current.some((s) => s.photo)
      const workers = anyPhoto ? 1 : fastRef.current ? 2 : 1
      const worker = async (offsetMs: number): Promise<void> => {
        await new Promise((r) => setTimeout(r, offsetMs))
        while (true) {
          if (pausedRef.current || runIdRef.current !== myRun) return
          const at = cursor++
          if (at >= indexes.length) return
          await genOne(indexes[at], seedBump)
        }
      }
      await Promise.all(Array.from({ length: workers }, (_, w) => worker(w * 700)))
    }
    await runPool(scenesRef.current.filter((s) => s.status !== 'done').map((s) => s.index), 0)
    for (let round = 1; round <= 2 && !pausedRef.current && runIdRef.current === myRun; round++) {
      const failed = scenesRef.current.filter((s) => s.status === 'error').map((s) => s.index)
      if (!failed.length) break
      toast(`Retrying ${failed.length} failed scene${failed.length === 1 ? '' : 's'} — the free queue was busy…`, 'info')
      await new Promise((r) => setTimeout(r, 8000))
      await runPool(failed, round * 1000)
    }
    // Only the run that still owns the board may clear the busy flag — a stale
    // (superseded) run finishing must not hide a newer run's progress.
    if (runIdRef.current === myRun) setGenerating(false)
  }

  function pause(): void {
    pausedRef.current = true
    setPaused(true)
  }

  /** Regenerate ONE scene with its (possibly edited) prompt — works even while paused. */
  async function regenerate(index: number): Promise<void> {
    await genOne(index, Math.floor(Math.random() * 9999))
    // A single manual regenerate has no retry pass — if it failed, say so out loud.
    const s = scenesRef.current.find((x) => x.index === index)
    if (s?.status === 'error') toast(s.msg ?? 'Scene regenerate failed — try again.', 'error')
  }

  /** Attach a photo to a scene ("put me in this scene"). */
  async function attachPhoto(index: number): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths[0]) patchScene(index, { photo: paths[0] })
  }

  /** Save ONE generated scene image wherever the user chooses. */
  async function saveOne(s: Scene, arrIdx: number): Promise<void> {
    if (!s.img) return
    const res = await window.api.scene.saveImage(plainPath(s.img), `scene-${String(arrIdx + 1).padStart(2, '0')}.jpg`)
    if (res.saved) toast(`Saved to ${res.path}`, 'success')
    else if (res.error) toast(`Save failed: ${res.error}`, 'error')
  }

  /** Save every generated scene image, numbered in storyboard order, into one folder. */
  async function saveAll(): Promise<void> {
    const paths = scenes.filter((s) => s.status === 'done' && s.img).map((s) => plainPath(s.img as string))
    if (!paths.length) {
      toast('Generate at least one scene first.', 'error')
      return
    }
    const res = await window.api.scene.saveAllImages(paths)
    if (res.saved) toast(`Saved ${res.count} images to ${res.path}`, 'success')
    else if (res.error) toast(`Save failed: ${res.error}`, 'error')
  }

  async function build(): Promise<void> {
    const ready = scenes.filter((s) => s.status === 'done' && s.img)
    if (!ready.length) {
      setError('Generate at least one scene first.')
      return
    }
    setBuilding(true)
    setError(null)
    setStage('Starting…')
    setBuildPreview(null)
    const unsub = window.api.video.onProgress((s) => setStage(s))
    const unsubP = window.api.video.onPreview((png) => setBuildPreview(`${fileUrl(png)}?t=${Date.now()}`))
    try {
      // Strip the preview link back to a plain path for the builder.
      const imagePaths = ready.map((s) => plainPath(s.img as string))
      // Did the user set any pacing? Then send per-scene shots: every scene exactly
      // once, in order, with their seconds + transitions. Untouched = the classic
      // varied Ken-Burns cut every ~6s.
      const paced = ready.some((s) => (s.seconds && s.seconds > 0) || (s.transition && s.transition !== 'cut'))
      const job = await window.api.video.build({
        title: title.trim() || 'Video',
        body,
        // The generated stills always ride along: with a REAL-motion engine they are the
        // per-scene fallback; with 'stills' they ARE the video (classic behavior).
        images: imagePaths,
        imageShots: paced
          ? ready.map((s, i) => ({ path: imagePaths[i], seconds: s.seconds, transition: s.transition }))
          : undefined,
        engine: motion === 'stills' ? 'presets' : motion,
        style,
        resolution,
        aspect,
        template,
        soundEffects
      })
      setBuilt(job)
      toast('Scene video built ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed')
      toast(err instanceof Error ? err.message : 'Build failed', 'error')
    } finally {
      unsub()
      unsubP()
      setBuilding(false)
      setStage(null)
      setBuildPreview(null)
    }
  }

  // The same four moves the render cycles through, in the same order, so the preview shows
  // the move this scene will really get. Named here rather than imported because they live
  // in src/main and the renderer cannot reach into that — the main process validates the
  // name it receives and falls back to zoom-in, so a drift here cannot break a preview.
  const PREVIEW_MOTIONS = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const

  /** Renders this one scene, exactly as the final video will treat it, and plays it. */
  async function handleScenePreview(scene: Scene): Promise<void> {
    if (!scene.img) return
    setPreviewingIndex(scene.index)
    setPreviewUrl(null)
    setPreviewedIndex(null)
    try {
      const imagePath = plainPath(scene.img)
      const res = await window.api.scenePreview(
        imagePath,
        scene.seconds ?? 4,
        PREVIEW_MOTIONS[scene.index % PREVIEW_MOTIONS.length],
        aspect,
        template
      )
      // fileUrl() here in the page, not in main — that is what makes it play on the phone.
      if (res.ok) {
        setPreviewUrl(`${fileUrl(res.path)}?t=${Date.now()}`)
        setPreviewedIndex(scene.index)
      } else toast(res.error, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make the preview', 'error')
    } finally {
      setPreviewingIndex(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <header className="mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-serif text-gold-400">Scene Studio</h1>
          <span className="text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={sceneHistory.undo}
              disabled={!sceneHistory.canUndo}
              title="Undo (Ctrl+Z)"
              className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
            >
              ↩
            </button>
            <button
              onClick={sceneHistory.redo}
              disabled={!sceneHistory.canRedo}
              title="Redo (Ctrl+Y)"
              className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
            >
              ↪
            </button>
          </div>
        </div>
        <p className="text-ink-400 text-sm mt-1">
          Generate your video scene by scene and watch each one appear. Pause anytime, rewrite any scene’s
          prompt and regenerate just that scene, then build the final video with a live progress bar. Free AI
          images — no key, no install, needs internet.
        </p>
      </header>

      {/* Script + settings */}
      <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setScene((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Title"
            className="flex-1 rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
          />
          <MicButton onText={(t) => setScene((prev) => ({ ...prev, title: appendDictation(prev.title, t) }))} className="px-3 py-2" />
          <button onClick={useScriptPad} className="rounded-md border border-ink-700 px-3 text-xs text-ink-300 hover:border-gold-500">
            Use Script Pad
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setScene((prev) => ({ ...prev, body: e.target.value }))}
          placeholder="Paste your script. Put [SECTION HEADERS] on their own lines to define scenes."
          rows={4}
          className="w-full resize-y rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
        />
        <div className="flex justify-end -mt-1">
          <MicButton onText={(t) => setScene((prev) => ({ ...prev, body: appendDictation(prev.body, t) }))} />
        </div>
        <div className="flex gap-2 items-start">
          <input
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Overall scene direction (optional) — e.g. “dark documentary look, 1970s Karachi, rain”"
            className="flex-1 rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
          />
          <MicButton onText={(t) => setDirection((prev) => appendDictation(prev, t))} className="px-3 py-2" />
        </div>
        <div className="rounded-md border border-ink-800 bg-ink-950/60 px-3 py-2">
        <div className="mb-1 text-[11px] font-medium tracking-wide text-gold-400">
          🎬 VIDEO SETTINGS — style · video look · resolution · format · look (these apply to the final built video)
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-300">
          <label className="flex items-center gap-1">
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1 capitalize">
              {VIDEO_STYLES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1" title="Real AI motion generates actual video per scene; any failure falls back to your stills — the build never breaks.">
            Video look
            <select value={motion} onChange={(e) => setMotion(e.target.value as 'stills' | 'ai-free-video' | 'ai-local')} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
              <option value="stills">Your stills (Ken-Burns) — default</option>
              <option value="ai-free-video">REAL AI video — free cloud (Puter sign-in)</option>
              <option value="ai-local">REAL AI video — local GPU (ComfyUI)</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Resolution
            <select value={resolution} onChange={(e) => setResolution(e.target.value as VideoResolution)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4k">4K</option>
              <option value="8k">8K</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Format
            <select value={aspect} onChange={(e) => setAspect(e.target.value as VideoAspect)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Look
            <select value={template} onChange={(e) => setTemplate(e.target.value as VideoTemplate)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1 capitalize">
              {VIDEO_TEMPLATES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="accent-gold-500" />
            Fast images (turbo)
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={soundEffects} onChange={(e) => setSoundEffects(e.target.checked)} className="accent-gold-500" />
            Transition SFX
          </label>
          <label className="flex items-center gap-1" title="How much a scene with your photo is transformed. Lower = keep more of you.">
            Photo transform
            <input type="range" min={0.2} max={0.9} step={0.05} value={photoStrength} onChange={(e) => setPhotoStrength(Number(e.target.value))} />
            <span className="tabular-nums">{Math.round(photoStrength * 100)}%</span>
          </label>
          <label
            className="flex items-center gap-1"
            title="Sets every scene's 'Stays' time in one go — 0.5 seconds to minutes. After applying, change any single scene's own box to make just that one longer or shorter. Empty = automatic pacing."
          >
            ⏱ Every scene stays
            <input
              type="number"
              min={0.5}
              max={600}
              step={0.5}
              value={everySceneSec}
              placeholder="auto"
              onChange={(e) => setEverySceneSec(e.target.value === '' ? '' : Math.max(0.5, Number(e.target.value)))}
              className="w-16 rounded bg-ink-950 border border-ink-800 px-1 py-0.5 text-[10px] text-ink-200"
            />
            sec
            <button
              onClick={() => {
                const v = everySceneSec === '' ? undefined : everySceneSec
                setScenes((prev) => prev.map((sc) => ({ ...sc, seconds: v })))
              }}
              disabled={!scenes.length}
              className="rounded border border-gold-500/40 px-2 py-0.5 text-gold-400 hover:bg-gold-500/10 disabled:opacity-40"
              title="Writes this time into every scene card below (you can still change single cards afterwards)"
            >
              Apply to all
            </button>
          </label>
          <button onClick={plan} disabled={generating || building} className="ml-auto rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
            Plan scenes
          </button>
        </div>
        </div>
        <p className="text-[10px] text-ink-500">
          ⏱ “Every scene stays … sec” sets ALL the cards in one go (0.5 sec to minutes — your call), and each
          card’s own “Stays” box can then override just that scene: pick 1.5 sec for everything and give scene 12
          five seconds. Leave everything empty for automatic pacing — the total always stretches to fit the
          narration.
        </p>
        <p className="text-[10px] text-ink-500">
          📎 “Put me in (photo)” on any scene uses your photo as the base (free image-to-image). It keeps your
          photo’s composition and follows the prompt (clothes, setting, style); exact face likeness varies. The free
          photo queue can be slow — add a free AI Horde key in Settings for priority.
        </p>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* Scene controls + progress */}
      {scenes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-3 mb-3">
            {!generating ? (
              <button onClick={generateRemaining} disabled={building} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
                {doneCount ? '▶ Generate remaining' : '▶ Generate all scenes'}
              </button>
            ) : paused ? (
              <button onClick={generateRemaining} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                ▶ Resume
              </button>
            ) : (
              <button onClick={pause} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
                ⏸ Pause
              </button>
            )}
            <div className="flex-1">
              <div className="flex justify-between text-[11px] text-ink-400 mb-1">
                <span>{doneCount} / {scenes.length} scenes ready{generating && !paused ? ' — generating…' : paused ? ' — paused' : ''}</span>
                <span>{genPct}%</span>
              </div>
              <div className="h-2 rounded bg-ink-800 overflow-hidden">
                <div className="h-full bg-gold-500 transition-all" style={{ width: `${genPct}%` }} />
              </div>
            </div>
            <button onClick={saveAll} disabled={doneCount === 0} title="Save every generated image, numbered in order, into a folder you pick" className="rounded-md border border-ink-600 px-4 py-2 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40">
              ⬇ Save all images
            </button>
            <button onClick={build} disabled={building || generating || doneCount === 0} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
              {building ? 'Building…' : '🎬 Build video'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scenes.map((s, arrIdx) => (
              <div key={s.index} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gold-400 font-medium">Scene {arrIdx + 1} · {s.label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-500 mr-1">
                      {s.status === 'generating' ? '…working' : s.status === 'done' ? '✓ ready' : s.status === 'error' ? '✗ failed' : 'idle'}
                    </span>
                    <button onClick={() => moveScene(arrIdx, -1)} disabled={arrIdx === 0} title="Move up" className="text-[11px] text-ink-500 hover:text-gold-400 disabled:opacity-30">↑</button>
                    <button onClick={() => moveScene(arrIdx, 1)} disabled={arrIdx === scenes.length - 1} title="Move down" className="text-[11px] text-ink-500 hover:text-gold-400 disabled:opacity-30">↓</button>
                    <button onClick={() => removeScene(s.index)} title="Remove scene" className="text-[11px] text-ink-500 hover:text-red-300">✕</button>
                  </div>
                </div>
                <div className="aspect-video rounded bg-ink-950 overflow-hidden flex items-center justify-center mb-2">
                  {s.img ? (
                    <img src={s.img} alt={`scene ${s.index + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="px-2 text-center text-[11px] text-ink-600">
                      {s.status === 'generating' ? s.msg ?? 'Generating…' : s.status === 'error' ? s.msg ?? 'failed' : 'not generated'}
                    </span>
                  )}
                </div>
                {/* A failed REGENERATE used to be invisible when an older image was still on
                    screen — only a 10px "✗ failed" badge with no reason. Say what went wrong. */}
                {s.status === 'error' && s.img && s.msg && (
                  <p className="mb-1 rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-[11px] leading-snug text-red-300">
                    Couldn’t regenerate (the image above is your previous one): {s.msg}
                  </p>
                )}
                {s.status === 'generating' && s.img && s.msg && (
                  <p className="mb-1 text-[10px] text-gold-300/80">{s.msg}</p>
                )}
                <div className="flex items-center gap-2 mb-1 text-[10px]">
                  <button onClick={() => attachPhoto(s.index)} className="rounded border border-ink-700 px-2 py-0.5 text-ink-300 hover:border-gold-500">
                    📎 {s.photo ? 'Change photo' : 'Put me in (photo)'}
                  </button>
                  {s.photo && (
                    <>
                      <span className="text-emerald-400">photo attached</span>
                      <button onClick={() => patchScene(s.index, { photo: null })} className="text-ink-500 hover:text-red-300">remove</button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-1 text-[10px]">
                  <label className="text-ink-500 flex items-center gap-1" title="How long this image stays on screen. Leave empty for automatic pacing. The total is always fitted to the narration, so speech never gets cut off.">
                    ⏱ Stays
                    <input
                      type="number"
                      min={0.5}
                      max={600}
                      step={0.5}
                      value={s.seconds ?? ''}
                      placeholder="auto"
                      onChange={(e) =>
                        patchScene(s.index, { seconds: e.target.value === '' ? undefined : Math.max(0.5, Number(e.target.value)) })
                      }
                      className="w-14 rounded bg-ink-950 border border-ink-800 px-1 py-0.5 text-[10px] text-ink-200"
                    />
                    sec
                  </label>
                  {arrIdx > 0 && (
                    <label className="text-ink-500 flex items-center gap-1" title="How the picture switches from the previous scene to this one">
                      ✨ Arrives by
                      <select
                        value={s.transition ?? 'cut'}
                        onChange={(e) => patchScene(s.index, { transition: e.target.value as SceneTransition })}
                        className="rounded bg-ink-950 border border-ink-800 px-1 py-0.5 text-[10px] text-ink-200"
                      >
                        {SCENE_TRANSITIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <textarea
                  value={s.prompt}
                  onChange={(e) => patchScene(s.index, { prompt: e.target.value })}
                  rows={2}
                  className="w-full resize-y rounded bg-ink-950 border border-ink-800 px-2 py-1 text-[11px] text-ink-200"
                />
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => regenerate(s.index)} disabled={s.status === 'generating'} className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-gold-500 disabled:opacity-40">
                    ↻ Regenerate this scene
                  </button>
                  {s.img && s.status === 'done' && (
                    <button onClick={() => void saveOne(s, arrIdx)} title="Save this image to your computer" className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-gold-500">
                      ⬇ Save
                    </button>
                  )}
                  {/* Watch just this one, with its real camera move and grade, instead of
                      rendering the whole video to check six seconds. */}
                  {s.img && s.status === 'done' && (
                    <button
                      onClick={() => void handleScenePreview(s)}
                      disabled={previewingIndex !== null}
                      title="Renders just this scene with the camera move and look the final video will use — a few seconds"
                      className="rounded border border-gold-500/40 px-2 py-1 text-[11px] text-gold-400 hover:bg-gold-500/10 disabled:opacity-40"
                    >
                      {previewingIndex === s.index ? 'Making it…' : '▶ Watch this scene'}
                    </button>
                  )}
                  <MicButton onText={(t) => patchScene(s.index, { prompt: appendDictation(s.prompt, t) })} />
                </div>
                {/* Only under the scene it belongs to, so there is never any doubt about
                    which one you are looking at. */}
                {previewUrl && previewedIndex === s.index && (
                  <div className="mt-2 rounded border border-gold-500/30 bg-ink-950 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] text-gold-400">Scene {s.index + 1}, as the video will show it</span>
                      <button
                        onClick={() => {
                          setPreviewUrl(null)
                          setPreviewedIndex(null)
                        }}
                        className="text-[11px] text-ink-500 hover:text-ink-300"
                      >
                        close
                      </button>
                    </div>
                    <video src={previewUrl} controls autoPlay loop className="w-full rounded" />
                    <div className="mt-1 text-[10px] text-ink-600">
                      No sound — the narration is the same either way. This is here to show the camera move and the
                      look on this particular picture.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addScene}
            className="mt-3 rounded-md border border-dashed border-ink-700 px-4 py-2 text-xs text-ink-400 hover:border-gold-500 hover:text-gold-400"
          >
            ＋ Add a scene
          </button>
        </div>
      )}

      {/* Build progress + result */}
      {building && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-950 p-4">
          <div className="flex justify-between text-[11px] text-ink-400 mb-1">
            <span>{stage ?? 'Building…'}</span>
            {buildPct != null && <span>{buildPct}%</span>}
          </div>
          <div className="h-2 rounded bg-ink-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${buildPct ?? 5}%` }} />
          </div>
          {buildPreview && <img src={buildPreview} alt="preview" className="mt-3 w-full max-w-sm rounded border border-ink-800" />}
        </div>
      )}
      {built && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-900 p-4">
          <div className="text-sm text-ink-100 mb-2">✓ Built “{built.title}” — also saved in Video Studio.</div>
          <video src={fileUrl(built.path)} controls className="w-full max-w-2xl rounded bg-black" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void window.api.video.reveal(built.path)} className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">
              Show file
            </button>
            <button onClick={() => navigate('/video')} title="Voice options, music, captions, export and everything else live here" className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">
              🎥 Open in Video Studio
            </button>
            <button onClick={() => navigate('/timeline')} title="Cut, trim and rearrange this video in the Timeline Editor" className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">
              ✂ Edit in Timeline
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
