import { useEffect, useMemo, useRef, useState } from 'react'
import RenderQueuePanel from '../components/RenderQueuePanel'
import { useLocation } from 'react-router-dom'
import { useAutosave } from '../hooks/useAutosave'
import type {
  AiEngineStatus,
  ExportFormat,
  GeneratedScript,
  LibraryEntry,
  LookEngine,
  Mood,
  PostMetadata,
  TrimMode,
  HardwareReport,
  VideoAspect,
  VideoJob,
  VideoResolution,
  VideoStyle,
  VideoTemplate
} from '../../../shared/types'
import { EXPORT_FORMATS, MOODS, VIDEO_STYLE_GROUPS, VIDEO_TEMPLATES } from '../../../shared/types'
import { useStudio } from '../store/StudioContext'
import MicButton, { appendDictation } from '../components/MicButton'
import VoiceRecorder from '../components/VoiceRecorder'
import TrimTimeline, { mmss } from '../components/TrimTimeline'
import MusicTrackBar, { type MusicRegion } from '../components/MusicTrackBar'
import MusicPicker from '../components/MusicPicker'
import TemplatesMenu from '../components/TemplatesMenu'
import FactCheckPanel from '../components/FactCheckPanel'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import DjStationPage from './DjStationPage'
import DirectorPage from './DirectorPage'

const ENGINE_INFO: Record<LookEngine, { label: string; badge: string; blurb: string }> = {
  presets: {
    label: 'Style presets',
    badge: '🟢 Free · offline',
    blurb: 'Styles text, backgrounds, waveform + your own images. Always works, no key.'
  },
  'ai-free': {
    label: 'Photo slideshow (AI images)',
    badge: '🟢 Free · online · no key',
    blurb:
      'Generates a real AI image per scene, then pans and zooms across them. A moving photo slideshow — ' +
      'not filmed motion. Needs internet; no key or install.'
  },
  'ai-free-video': {
    label: 'REAL AI video — free cloud',
    badge: '🟢 Free · online',
    blurb:
      'Real generated motion per scene — not a slideshow. Two free routes (pick in Settings → AI Video): ' +
      'a Pollinations key (free Quest Pollen, no phone number) or a Puter account (Google Veo, sign-in window). ' +
      'The free allowances are small, so a few scenes per build get real motion (adjustable) and the rest use ' +
      'AI stills. Any failure falls back to the slideshow and says why — the build never breaks.'
  },
  'ai-cloud': {
    label: 'AI footage (cloud)',
    badge: '💳 Paid · your key',
    blurb: 'Real AI-generated footage from a paid provider you supply a key for.'
  },
  'ai-local': {
    label: 'REAL AI video — local GPU (ComfyUI)',
    badge: '🟢 Free · needs NVIDIA GPU',
    blurb:
      'Real generated motion on your own graphics card through a local ComfyUI server (LTX and friends). ' +
      'Free per video, fully private. Needs a dedicated NVIDIA card + one-time setup in Settings → AI Video.'
  }
}

const SCRIPTPAD_KEY = '__scriptpad__'

import { fileUrl } from '../../../shared/mediaUrl'

/** Legitimately free / royalty-free music libraries. Downloading here is legal —
 * unlike ripping arbitrary YouTube videos, which would violate YouTube's terms.
 * Opened in the system browser via the main window's external-link handler. */
const FREE_MUSIC = [
  { name: 'YouTube Audio Library', url: 'https://studio.youtube.com/', note: 'YouTube Studio → Audio Library (free for YouTube)' },
  { name: 'Pixabay Music', url: 'https://pixabay.com/music/', note: 'CC0 / no attribution needed' },
  { name: 'Incompetech', url: 'https://incompetech.com/music/royalty-free/music.html', note: 'Kevin MacLeod, CC-BY (credit him)' },
  { name: 'Free Music Archive', url: 'https://freemusicarchive.org/', note: 'Creative Commons tracks' },
  { name: 'Chosic', url: 'https://www.chosic.com/free-music/all/', note: 'Royalty-free, filterable by mood' }
]

/** A script that can be turned into a video — either the live Writer draft or a saved Library script. */
interface VideoSource {
  key: string
  label: string
  title: string
  body: string
}

/** Always-present source: a blank slate you can paste into, type in, or fill by uploading a file. */
const PASTE_KEY = '__paste__'
const PASTE_SOURCE: VideoSource = {
  key: PASTE_KEY,
  label: '✍️ Paste / write my own script',
  title: '',
  body: ''
}

export default function VideoPage() {
  const { writer } = useStudio()
  const location = useLocation()
  // Set when the user clicked "Send to Video Generator" on the Script Pad.
  const wantScriptPad = (location.state as { useScriptPad?: boolean } | null)?.useScriptPad === true

  const [sources, setSources] = useState<VideoSource[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const [studioView, setStudioView] = useState<'build' | 'sound' | 'director'>('build')
  const [resolution, setResolution] = useState<VideoResolution>('1080p')
  const [aspect, setAspect] = useState<VideoAspect>('16:9')
  const [template, setTemplate] = useState<VideoTemplate>('cinematic')
  const [narrationVoice, setNarrationVoice] = useState<'windows' | 'piper' | 'winnatural' | 'silent'>('windows')
  const [piperInstalled, setPiperInstalled] = useState(false)
  // Windows NATURAL voices (incl. Urdu Asad/Uzma once the Windows speech pack exists).
  const [winVoices, setWinVoices] = useState<{ id: string; name: string; language: string }[]>([])
  const [winVoiceId, setWinVoiceId] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [musicPath, setMusicPath] = useState<string | null>(null)
  // The music EXAMPLES: 3 full-length beds to listen through, each with its why.
  const [musicExamples, setMusicExamples] = useState<{ mood: string; why: string; path: string }[]>([])
  const [makingExamples, setMakingExamples] = useState(false)
  const [soundEffects, setSoundEffects] = useState(true)
  // Default to the free per-scene AI engine so the visuals actually follow the script
  // (a real generated image per section) instead of plain text cards over a gradient.
  // Falls back to the animated look automatically if the image service is unreachable.
  const [engine, setEngine] = useState<LookEngine>('ai-free')
  const [style, setStyle] = useState<VideoStyle>('cinematic')

  // Persist the paste/write-your-own script editor AND every build knob (engine,
  // style, resolution, shape, template) so switching tabs never resets choices.
  // Skip content restore when navigating in from "Send to Video Generator" (that
  // flow supplies its own content). Memoized ref → no autosave loop.
  const editorPersist = useMemo(
    () => ({ title, body, engine, style, resolution, aspect, template }),
    [title, body, engine, style, resolution, aspect, template]
  )
  // True once the autosave restore has put real user content into the editor.
  // The source-list loader below MUST NOT seed title/body over it: that seeding
  // used to run after every restore (mount order makes it deterministic) and
  // silently destroyed the user's pasted/typed script on every return to this tab.
  const restoredContentRef = useRef(false)
  useAutosave('video-editor', editorPersist, (v) => {
    if (v.engine != null && v.engine in ENGINE_INFO) setEngine(v.engine)
    if (typeof v.style === 'string' && v.style) setStyle(v.style as VideoStyle)
    if (typeof v.resolution === 'string' && v.resolution) setResolution(v.resolution as VideoResolution)
    if (typeof v.aspect === 'string' && v.aspect) setAspect(v.aspect as VideoAspect)
    if (typeof v.template === 'string' && v.template) setTemplate(v.template as VideoTemplate)
    if (wantScriptPad) return
    if (v.title != null) setTitle(v.title)
    if (v.body != null) setBody(v.body)
    restoredContentRef.current = Boolean((v.title ?? '').trim() || (v.body ?? '').trim())
  })
  const [images, setImages] = useState<string[]>([])
  const [useStock, setUseStock] = useState(false)
  const [hasStockKey, setHasStockKey] = useState(false)
  const [aiStatus, setAiStatus] = useState<AiEngineStatus | null>(null)
  const [plan, setPlan] = useState<{ hook: string; sections: { title: string; keyword: string; seconds: number }[]; thumbnailIdea: string; ctrTips: string[] } | null>(null)
  const [planning, setPlanning] = useState(false)

  /** Speaks one line in the chosen Windows natural voice so it can be judged by ear. */
  async function previewWinVoice(): Promise<void> {
    setPreviewing(true)
    try {
      const r = await window.api.voice.winNaturalPreview(
        winVoiceId,
        'Salam. Yeh aapki narration ki awaaz hai. This is your narration voice.'
      )
      if (r.ok && r.wavBase64) {
        await new Audio(`data:audio/wav;base64,${r.wavBase64}`).play()
      } else {
        toast(r.error || 'Could not play that voice.', 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not play that voice.', 'error')
    } finally {
      setPreviewing(false)
    }
  }

  async function handlePlan(): Promise<void> {
    if (!title.trim() && !body.trim()) return
    setPlanning(true)
    setError(null)
    setPlan(null)
    try {
      setPlan(await window.api.video.plan(title.trim(), body))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI planning failed — is your AI brain (Ollama/key) set up?')
    } finally {
      setPlanning(false)
    }
  }

  const [building, setBuilding] = useState(false)
  // The Build button must NEVER look dead with no explanation (a real user hit a
  // silently-disabled button with the ⊘ cursor and concluded the app was broken).
  // It stays clickable; clicking without a script points at the script box instead.
  const scriptBoxRef = useRef<HTMLTextAreaElement | null>(null)
  const [needScriptFlash, setNeedScriptFlash] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [buildPreview, setBuildPreview] = useState<string | null>(null)
  const [musicBusyId, setMusicBusyId] = useState<string | null>(null)
  const [replaceMood, setReplaceMood] = useState<Mood>('calm')
  // 🎧 AI DJ hint ("what should it feel like?") and the track handed to the DJ decks.
  const [aiDjHint, setAiDjHint] = useState('')
  const [djTrack, setDjTrack] = useState<{ path: string; name: string } | null>(null)
  const [voiceOpenId, setVoiceOpenId] = useState<string | null>(null)
  const [captionBusyId, setCaptionBusyId] = useState<string | null>(null)
  const [shortsBusyId, setShortsBusyId] = useState<string | null>(null)
  const [shortsCount, setShortsCount] = useState(3)
  const [metaBusyId, setMetaBusyId] = useState<string | null>(null)
  const [postMeta, setPostMeta] = useState<{ id: string; meta: PostMetadata } | null>(null)
  const [watermarkLogo, setWatermarkLogo] = useState<string | null>(null)
  const [watermarkPos, setWatermarkPos] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right')
  const [watermarkBusyId, setWatermarkBusyId] = useState<string | null>(null)
  // Dead-air removal: the PLAN is shown before anything is cut, because a silence
  // remover that just does it to a finished take is one nobody trusts.
  const [silenceBusyId, setSilenceBusyId] = useState<string | null>(null)
  const [silencePlan, setSilencePlan] = useState<{ id: string; headline: string; cuts: number } | null>(null)
  // The credit check. Not a copyright detector — it checks the paperwork for what the app
  // fetched itself, and says plainly when it cannot vouch for something.
  const [creditsBusyId, setCreditsBusyId] = useState<string | null>(null)
  const [creditReport, setCreditReport] = useState<
    ({ id: string } & import('../../../shared/copyrightCheck').CopyrightReport) | null
  >(null)
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel(): Promise<void> {
    setCancelling(true)
    try {
      await window.api.video.cancel()
    } finally {
      // The in-flight build/export/trim promise will reject and reset the flags.
      setTimeout(() => setCancelling(false), 500)
    }
  }

  /** True when the failure was a user cancellation rather than a real error. */
  function isCancel(err: unknown): boolean {
    return err instanceof Error && /cancel/i.test(err.message)
  }

  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [exportFormat, setExportFormat] = useState<ExportFormat>('youtube')
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [enhanceBusyId, setEnhanceBusyId] = useState<string | null>(null)
  const [trimOpenId, setTrimOpenId] = useState<string | null>(null)
  const [trimMode, setTrimMode] = useState<TrimMode>('remove')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimmingId, setTrimmingId] = useState<string | null>(null)
  const [stitchSel, setStitchSel] = useState<string[]>([])
  const [stitching, setStitching] = useState(false)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const [trimDuration, setTrimDuration] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [hardware, setHardware] = useState<HardwareReport | null>(null)
  const [captionsAndChapters, setCaptionsAndChapters] = useState(false)
  const [extras, setExtras] = useState<{ videoId: string; srtPath?: string; chapters: string } | null>(null)
  const [musicRegion, setMusicRegion] = useState<MusicRegion | null>(null)
  const [musicPickerOpen, setMusicPickerOpen] = useState(false)
  const [musicBusy, setMusicBusy] = useState(false)

  async function handleApplyMusic(job: VideoJob): Promise<void> {
    if (!musicRegion?.track) return
    setMusicBusy(true)
    setError(null)
    setStage('Adding your music…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.music.applyRegion(job.id, musicRegion.track, musicRegion.startSec, musicRegion.endSec)
      if (res.ok && res.video) {
        await refreshJobs()
        setMusicRegion(null)
        setSavedNote(`Music added — new video “${res.video.title}” saved. Your original is untouched.`)
      } else {
        setError(res.error || 'Could not add the music.')
      }
    } finally {
      unsubscribe()
      setMusicBusy(false)
      setStage(null)
    }
  }

  async function handleEnhance(job: VideoJob): Promise<void> {
    setEnhanceBusyId(job.id)
    try {
      const res = await window.api.video.enhance(job.id)
      if (res.ok) { await refreshJobs(); toast('Enhanced copy created ✓', 'success') }
      else toast(res.error ?? 'Enhance failed', 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Enhance failed', 'error')
    } finally {
      setEnhanceBusyId(null)
    }
  }

  async function refreshJobs(): Promise<void> {
    const vids = (await window.api.video.list()) as VideoJob[]
    setJobs(vids)
  }

  // Assemble the list of scripts you can build from: the current Writer draft (if
  // any) plus every script already saved to the Library. Also load built videos.
  useEffect(() => {
    const off = window.api.video.onExtras(setExtras)
    void window.api.hardware.check().then(setHardware).catch(() => {})
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const [lib, vids, pad] = await Promise.all([
        window.api.library.list(),
        window.api.video.list(),
        window.api.scriptpad.get()
      ])
      const saved = (lib as LibraryEntry[])
        .filter((e) => e.kind === 'script')
        .map((e) => e.data as GeneratedScript)
      // The blank "paste / write your own" slate is always first so you never
      // depend on having generated a finance script to make a video.
      const next: VideoSource[] = [PASTE_SOURCE]
      if (pad.body.trim()) {
        next.push({
          key: SCRIPTPAD_KEY,
          label: `📝 Script Pad${pad.title ? ` — ${pad.title}` : ''}`,
          title: pad.title,
          body: pad.body
        })
      }
      if (writer.script && writer.body.trim()) {
        next.push({ key: 'writer', label: `Current Writer draft — ${writer.script.title}`, title: writer.script.title, body: writer.body })
      }
      for (const s of saved) {
        // An empty saved script would silently leave nothing to build — say so in the list.
        next.push({ key: s.id, label: s.body.trim() ? s.title : `${s.title} (empty — no words in it)`, title: s.title, body: s.body })
      }
      setSources(next)
      setJobs(vids as VideoJob[])
      void refreshAiStatus()
      void window.api.voice.piperStatus().then((s) => setPiperInstalled(s.installed))
      void window.api.voice.winNaturalList().then((list) => {
        setWinVoices(list)
        // Prefer an Urdu voice by default when one is installed — this channel narrates
        // in Roman Urdu/Urdu, so ur-PK is almost always the right pick.
        const urdu = list.find((v) => v.language.toLowerCase().startsWith('ur'))
        setWinVoiceId((cur) => cur || urdu?.id || list[0]?.id || '')
      })
      void window.api.stock.getConfig().then((c) => {
        setHasStockKey(c.hasPixabay)
        if (c.hasPixabay) setUseStock(true)
      })
      if (selectedKey) return
      // A restored draft owns the editor: select the paste slate WITHOUT touching
      // title/body. (drafts.get is sent before this effect's requests and every
      // handler is synchronous, so the restore has already landed by now.)
      if (restoredContentRef.current) {
        setSelectedKey(PASTE_KEY)
        return
      }
      // If the user arrived via the Script Pad's "Send to Video Generator", start
      // on that. Otherwise prefer a real script (Writer/Library/Pad) over the
      // blank slate, falling back to the blank slate when nothing else exists.
      const initial = (wantScriptPad && next.find((s) => s.key === SCRIPTPAD_KEY)) || next[1] || next[0]
      if (initial) {
        setSelectedKey(initial.key)
        setTitle(initial.title)
        setBody(initial.body)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSelect(key: string): void {
    if (key === selectedKey) return
    const src = sources.find((s) => s.key === key)
    if (!src) {
      setSelectedKey(key)
      return
    }
    // Park the editor's current content on the source it belongs to before
    // switching. Without this, re-selecting "Paste / write my own" re-read the
    // frozen empty PASTE_SOURCE constant and wiped everything the user had
    // typed, pasted, or imported — with no confirm and no undo.
    setSources((prev) => prev.map((s) => (s.key === selectedKey ? { ...s, title, body } : s)))
    setSelectedKey(key)
    setTitle(src.title)
    setBody(src.body)
  }

  /**
   * Every setting on this page, as one build request.
   *
   * Shared by "Build Video" and "Add to the queue" deliberately: two copies of this object
   * would drift, and the queued video would quietly come out with different settings from
   * the one the user was looking at when they pressed the button.
   */
  function currentBuildRequest(effectiveTitle: string): Parameters<typeof window.api.video.build>[0] {
    return {
      title: effectiveTitle,
      body,
      resolution,
      aspect,
      template,
      narrationVoice,
      captionsAndChapters,
      winVoiceId: narrationVoice === 'winnatural' ? winVoiceId : undefined,
      musicPath: musicPath ?? undefined,
      soundEffects,
      engine,
      style,
      images: engine === 'presets' && images.length ? images : undefined,
      useStock: engine === 'presets' && useStock && hasStockKey
    }
  }

  /** The same title-derivation Build uses, so a queued item is named the same way. */
  function derivedTitle(): string {
    return (
      title.trim() ||
      body.replace(/^[\s#*[\]]+/, '').split(/[\n.!?]/)[0].split(/\s+/).slice(0, 8).join(' ').slice(0, 60) ||
      'My Video'
    )
  }

  async function handleAddToQueue(): Promise<void> {
    if (!body.trim()) {
      toast('The script box is empty — write or pick the words to be spoken first.', 'error')
      scriptBoxRef.current?.focus()
      return
    }
    try {
      await window.api.queue.add(currentBuildRequest(derivedTitle()))
      toast('Added to the queue ✓ — you can close the app, it will not be lost', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add it to the queue', 'error')
    }
  }

  /**
   * Every setting on this page, as one build request.
   *
   * Shared by "Build Video" and "Add to the queue" deliberately: two copies of this object
   * would drift, and the queued video would quietly come out with different settings from
   * the one the user was looking at when they pressed the button.
   */
  function currentBuildRequest(effectiveTitle: string): Parameters<typeof window.api.video.build>[0] {
    return {
      title: effectiveTitle,
      body,
      resolution,
      aspect,
      template,
      narrationVoice,
      captionsAndChapters,
      winVoiceId: narrationVoice === 'winnatural' ? winVoiceId : undefined,
      musicPath: musicPath ?? undefined,
      soundEffects,
      engine,
      style,
      images: engine === 'presets' && images.length ? images : undefined,
      useStock: engine === 'presets' && useStock && hasStockKey
    }
  }

  /** The same title-derivation Build uses, so a queued item is named the same way. */
  function derivedTitle(): string {
    return (
      title.trim() ||
      body.replace(/^[\s#*[\]]+/, '').split(/[\n.!?]/)[0].split(/\s+/).slice(0, 8).join(' ').slice(0, 60) ||
      'My Video'
    )
  }

  async function handleAddToQueue(): Promise<void> {
    if (!body.trim()) {
      toast('The script box is empty — write or pick the words to be spoken first.', 'error')
      scriptBoxRef.current?.focus()
      return
    }
    try {
      await window.api.queue.add(currentBuildRequest(derivedTitle()))
      toast('Added to the queue ✓ — you can close the app, it will not be lost', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add it to the queue', 'error')
    }
  }

  async function handleBuild(): Promise<void> {
    // Only a script is required — a missing title is auto-derived from the first line.
    // No script yet? Don't sit there disabled: SAY it and point at the exact box.
    if (!body.trim()) {
      toast('The script box is empty — write or pick the words to be spoken, then press Build.', 'error')
      setNeedScriptFlash(true)
      scriptBoxRef.current?.focus()
      scriptBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => setNeedScriptFlash(false), 3000)
      return
    }
    const effectiveTitle =
      title.trim() ||
      body.replace(/^[\s#*[\]]+/, '').split(/[\n.!?]/)[0].split(/\s+/).slice(0, 8).join(' ').slice(0, 60) ||
      'My Video'
    setBuilding(true)
    setError(null)
    setStage('Starting…')
    setBuildPreview(null)
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    const unsubPreview = window.api.video.onPreview((png) => setBuildPreview(`${fileUrl(png)}?t=${Date.now()}`))
    try {
      await window.api.video.build(currentBuildRequest(effectiveTitle))
      await refreshJobs()
      toast('Video built ✓', 'success')
    } catch (err) {
      if (isCancel(err)) setSavedNote('Build stopped.')
      else {
        setError(err instanceof Error ? err.message : 'Video build failed')
        toast(err instanceof Error ? err.message : 'Video build failed', 'error')
      }
    } finally {
      unsubscribe()
      unsubPreview()
      setBuilding(false)
      setStage(null)
      setBuildPreview(null)
    }
  }

  async function handlePickMusic(): Promise<void> {
    const p = await window.api.video.pickMusic()
    if (p) setMusicPath(p)
  }

  async function handleSetMusic(job: VideoJob, mode: 'remove' | 'replace'): Promise<void> {
    setMusicBusyId(job.id)
    setError(null)
    setStage(mode === 'remove' ? 'Removing background music…' : 'Replacing background music…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.setMusic(job.id, mode, mode === 'replace' ? replaceMood : undefined)
      await refreshJobs()
      toast(mode === 'remove' ? 'Music removed — voice kept ✓' : 'Music replaced ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Music edit failed')
      toast(err instanceof Error ? err.message : 'Music edit failed', 'error')
    } finally {
      unsubscribe()
      setMusicBusyId(null)
      setStage(null)
    }
  }

  async function handlePublish(job: VideoJob): Promise<void> {
    setPublishBusyId(job.id)
    setError(null)
    setSavedNote(null)
    try {
      const r = await window.api.youtube.publish(job.id)
      setSavedNote(
        `YouTube upload page opened + file revealed. Title/description/tags copied to clipboard — paste them in. (${r.tags.length} tags generated.)`
      )
      toast('YouTube upload page opened · details copied to clipboard', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the upload')
      toast('Could not prepare the upload', 'error')
    } finally {
      setPublishBusyId(null)
    }
  }

  async function pickLogo(): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths[0]) setWatermarkLogo(paths[0])
  }

  async function handleCreditCheck(job: VideoJob): Promise<void> {
    setCreditsBusyId(job.id)
    setError(null)
    setCreditReport(null)
    try {
      // The description the credit has to appear in is the one the app drafts for this
      // video. If that cannot be read, an empty description is the right fallback: it
      // reports a required credit as missing, which errs toward telling the user.
      const meta = await window.api.shorts.postMeta(job.id, 'youtube').catch(() => null)
      const description = meta?.description ?? ''
      const res = await window.api.copyright.check(job.id, description)
      if (res.found) setCreditReport({ id: job.id, ...res })
      else setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the credits.')
    } finally {
      setCreditsBusyId(null)
    }
  }

  /** Reads the take and reports what WOULD be cut. Two cheap reads, no encode. */
  async function handleSilencePlan(job: VideoJob): Promise<void> {
    setSilenceBusyId(job.id)
    setError(null)
    setSilencePlan(null)
    try {
      const res = await window.api.silence.plan(job.id)
      if (res.ok) setSilencePlan({ id: job.id, headline: res.summary.headline, cuts: res.summary.cuts })
      else setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the recording.')
    } finally {
      setSilenceBusyId(null)
    }
  }

  /** Cuts it — to a NEW video. The original is never touched. */
  async function handleSilenceApply(job: VideoJob): Promise<void> {
    setSilenceBusyId(job.id)
    setError(null)
    setSavedNote(null)
    const unsubscribe = window.api.video.onProgress((st) => setStage(st))
    try {
      const res = await window.api.silence.apply(job.id)
      if (res.ok) {
        await refreshJobs()
        setSilencePlan(null)
        setSavedNote(`${res.summary.headline} Saved as a new video — your original is untouched.`)
        toast('Dead air removed ✓', 'success')
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cut the recording.')
    } finally {
      unsubscribe()
      setSilenceBusyId(null)
      setStage(null)
    }
  }

  async function handleWatermark(job: VideoJob): Promise<void> {
    if (!watermarkLogo) {
      setError('Pick a logo image first (PNG with transparency looks best).')
      return
    }
    setWatermarkBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage('Adding logo watermark…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.watermark(job.id, watermarkLogo, watermarkPos)
      await refreshJobs()
      setSavedNote('Watermarked video created (saved in the list).')
      toast('Logo added ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watermark failed')
      toast(err instanceof Error ? err.message : 'Watermark failed', 'error')
    } finally {
      unsubscribe()
      setWatermarkBusyId(null)
      setStage(null)
    }
  }

  // Auto-caption: transcribe narration → .srt (and optionally burn into the video).
  async function handleCaptions(job: VideoJob, burn: boolean): Promise<void> {
    setCaptionBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage(burn ? 'Transcribing + burning captions…' : 'Transcribing narration…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.video.captions(job.id, burn)
      if (burn) await refreshJobs()
      setSavedNote(burn ? 'Captioned video created (also saved in the list).' : `Subtitles saved: ${res.srtPath}`)
      toast(burn ? 'Captioned video created ✓' : 'Subtitles (.srt) saved ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Captioning failed')
      toast(err instanceof Error ? err.message : 'Captioning failed', 'error')
    } finally {
      unsubscribe()
      setCaptionBusyId(null)
      setStage(null)
    }
  }

  /**
   * MAKE SHORTS — cut this video into vertical, captioned clips for Shorts/TikTok/Reels.
   * Everything is local and free: offline transcript → best moments → 9:16 crop + burned
   * captions. Each clip appears in this same list.
   */
  /** Ready-to-paste title/description/hashtags for one finished clip. */
  async function handlePostMeta(job: VideoJob, platform: 'youtube' | 'tiktok'): Promise<void> {
    setMetaBusyId(job.id)
    setError(null)
    try {
      // A 9:16 clip is a short — the title carries the marker set when it was cut.
      const vertical = /short/i.test(job.title)
      const meta = await window.api.shorts.postMeta(job.id, platform, vertical)
      setPostMeta({ id: job.id, meta })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write posting text')
      toast(err instanceof Error ? err.message : 'Could not write posting text', 'error')
    } finally {
      setMetaBusyId(null)
    }
  }

  async function handleMakeShorts(job: VideoJob, count: number): Promise<void> {
    setShortsBusyId(job.id)
    setError(null)
    setSavedNote(null)
    setStage('Finding the best moments…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.shorts.make(job.id, count)
      await refreshJobs()
      const picked = res.moments.map((m, i) => `${i + 1}. “${m.title}” — ${m.reason}`).join('\n')
      setSavedNote(`${res.jobs.length} vertical short(s) created and added to this list:\n${picked}`)
      toast(`${res.jobs.length} short(s) ready ✓`, 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make shorts')
      toast(err instanceof Error ? err.message : 'Could not make shorts', 'error')
    } finally {
      unsubscribe()
      setShortsBusyId(null)
      setStage(null)
    }
  }

  // AI-separate a video's blended audio and keep one side of the split:
  // keep 'voice' = music removed; keep 'music' = the voice removed, music stays.
  async function handleSeparateMusic(job: VideoJob, engine: 'online' | 'local', keep: 'voice' | 'music' = 'voice'): Promise<void> {
    setMusicBusyId(job.id)
    setError(null)
    setStage(engine === 'online' ? 'Separating audio (online)…' : 'Separating audio (local)…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.separateMusic(job.id, engine, keep)
      await refreshJobs()
      toast(keep === 'voice' ? 'Music removed — your voice kept ✓' : 'Voice removed — the music kept ✓', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Separation failed')
      toast(err instanceof Error ? err.message : 'Separation failed', 'error')
    } finally {
      unsubscribe()
      setMusicBusyId(null)
      setStage(null)
    }
  }

  // 🎧 AI DJ: the app judges the video's mood (user hint → its own script → listening
  // to the narration → the title), composes a fitting bed, and ducks it under the voice.
  async function handleAiDj(job: VideoJob): Promise<void> {
    setMusicBusyId(job.id)
    setError(null)
    setStage('AI DJ warming up…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.video.aiDj(job.id, aiDjHint.trim() || undefined)
      await refreshJobs()
      toast(`AI DJ done — a “${res.mood}” track now plays under the voice (decided from ${res.how}) ✓`, 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI DJ failed')
      toast(err instanceof Error ? err.message : 'AI DJ failed', 'error')
    } finally {
      unsubscribe()
      setMusicBusyId(null)
      setStage(null)
    }
  }

  // Rebuild this exact video with NOTHING drawn over the picture (no title, headings
  // or captions) — possible because videos now remember their own recipe (job.body).
  async function handleCleanCopy(job: VideoJob): Promise<void> {
    if (!job.body?.trim()) return
    setBuilding(true)
    setError(null)
    setStage('Building a clean copy (no on-screen text)…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.build({
        title: `${job.title} (clean)`,
        body: job.body,
        resolution: job.resolution,
        aspect: job.aspect,
        template: job.template,
        engine: 'presets',
        style: job.style,
        narrationVoice,
        winVoiceId: narrationVoice === 'winnatural' ? winVoiceId : undefined,
        captionsAndChapters: false,
        textOverlays: false
      })
      await refreshJobs()
      toast('Clean copy built — no titles, headings or captions on it ✓', 'success')
    } catch (err) {
      if (isCancel(err)) setSavedNote('Build stopped.')
      else {
        setError(err instanceof Error ? err.message : 'Clean copy failed')
        toast(err instanceof Error ? err.message : 'Clean copy failed', 'error')
      }
    } finally {
      unsubscribe()
      setBuilding(false)
      setStage(null)
    }
  }

  // Pull this video's audio out and load it onto Deck A of the Dual decks.
  async function handleOpenInDecks(job: VideoJob): Promise<void> {
    setError(null)
    setStage('Pulling the audio out of the video…')
    try {
      const p = await window.api.video.extractAudio(job.id)
      setDjTrack({ path: p, name: job.title })
      setStudioView('sound')
      toast('Loaded onto Deck A — the Dual decks are open below.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not extract the audio', 'error')
    } finally {
      setStage(null)
    }
  }

  async function handleAddImages(): Promise<void> {
    const paths = await window.api.video.pickImages()
    if (paths.length) setImages((prev) => [...prev, ...paths])
  }

  async function refreshAiStatus(): Promise<void> {
    try {
      setAiStatus(await window.api.ai.engineStatus())
    } catch {
      /* status is best-effort; badges just show defaults */
    }
  }

  // Upload a .txt/.md/.srt/.pdf and drop its text straight into the editor as a
  // brand-new "paste / write your own" script. No finance generation required.
  async function handleImportFile(): Promise<void> {
    setError(null)
    const res = await window.api.video.importScript()
    if (res.canceled) return
    if (res.error) {
      setError(res.error)
      return
    }
    setSelectedKey(PASTE_KEY)
    if (res.title) setTitle(res.title)
    if (res.body) setBody(res.body)
  }

  async function handleDelete(id: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this video?',
      message:
        'This permanently deletes the built video AND its file on disk — including its backup copies, so it is gone for good. This cannot be undone.',
      danger: true
    })
    if (!ok) return
    await window.api.video.remove(id)
    await refreshJobs()
    setStitchSel((s) => s.filter((x) => x !== id))
  }

  function toggleStitchSel(id: string): void {
    setStitchSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function handleStitch(): Promise<void> {
    if (stitchSel.length < 2) return
    setStitching(true)
    setError(null)
    setSavedNote(null)
    setStage('Stitching videos…')
    const unsub = window.api.video.onProgress((s) => setStage(s))
    try {
      // Preserve the order in which they were selected.
      await window.api.video.stitch(stitchSel)
      await refreshJobs()
      setStitchSel([])
      setSavedNote('Stitched video created below.')
    } catch (err) {
      if (isCancel(err)) setSavedNote('Stitch stopped.')
      else setError(err instanceof Error ? err.message : 'Stitch failed')
    } finally {
      unsub()
      setStitching(false)
      setStage(null)
    }
  }

  function toggleTrim(job: VideoJob): void {
    if (trimOpenId === job.id) {
      setTrimOpenId(null)
      return
    }
    // Seed the range from the player: start at current time, end at duration.
    const el = videoRefs.current[job.id]
    const dur = el && Number.isFinite(el.duration) ? el.duration : 0
    setTrimDuration(dur)
    setPlayhead(el ? el.currentTime : 0)
    setTrimStart(el ? Math.floor(el.currentTime) : 0)
    setTrimEnd(dur ? Math.round(dur) : 0)
    setTrimMode('remove')
    setTrimOpenId(job.id)
  }

  function applyCurrentTime(job: VideoJob, which: 'start' | 'end'): void {
    const el = videoRefs.current[job.id]
    if (!el) return
    const val = Math.round(el.currentTime * 100) / 100
    if (which === 'start') setTrimStart(val)
    else setTrimEnd(val)
  }

  async function handleTrim(job: VideoJob): Promise<void> {
    if (trimEnd - trimStart < 0.05) {
      setError('Pick an end time later than the start (at least 0.05s apart).')
      return
    }
    const span = (trimEnd - trimStart).toFixed(1)
    const okToCut = await confirmDialog({
      title: trimMode === 'remove' ? 'Remove this section?' : 'Keep only this section?',
      message:
        trimMode === 'remove'
          ? `${span} seconds (from ${mmss(trimStart)} to ${mmss(trimEnd)}) will be cut out. A new video is created — your original stays untouched.`
          : `Only ${span} seconds (from ${mmss(trimStart)} to ${mmss(trimEnd)}) will be kept. A new video is created — your original stays untouched.`,
      confirmLabel: trimMode === 'remove' ? 'Yes, remove it' : 'Yes, keep it'
    })
    if (!okToCut) return
    setError(null)
    setSavedNote(null)
    setTrimmingId(job.id)
    setStage(trimMode === 'keep' ? 'Cutting your clip…' : 'Removing that section…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      await window.api.video.trim(job.id, trimMode, trimStart, trimEnd)
      await refreshJobs()
      setTrimOpenId(null)
    } catch (err) {
      if (isCancel(err)) setSavedNote('Trim stopped.')
      else setError(err instanceof Error ? err.message : 'Trim failed')
    } finally {
      unsubscribe()
      setTrimmingId(null)
      setStage(null)
    }
  }

  async function handleSaveAs(job: VideoJob): Promise<void> {
    setSavedNote(null)
    const name = `${(job.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`
    const res = await window.api.video.saveAs(job.path, name)
    if (res.saved) setSavedNote(`Saved a copy to ${res.path}`)
  }

  // Transcode + download a video in the chosen delivery format. Streams coarse
  // ffmpeg progress into the same stage line the build uses.
  async function handleExport(job: VideoJob): Promise<void> {
    setSavedNote(null)
    setError(null)
    setExportingId(job.id)
    setStage('Preparing export…')
    const unsubscribe = window.api.video.onProgress((s) => setStage(s))
    try {
      const res = await window.api.video.export(job.id, exportFormat)
      if (res.saved) setSavedNote(`Downloaded (${exportFormat}) to ${res.path}`)
    } catch (err) {
      if (isCancel(err)) setSavedNote('Export stopped.')
      else setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      unsubscribe()
      setExportingId(null)
      setStage(null)
    }
  }

  // (The old inline mic-recording flow lived here; it was superseded by the full
  // 🎙 Voice studio (VoiceRecorder component) — pause/resume, scrub, redo-from-playhead.)

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div>
        <h1 className="text-2xl font-serif text-ink-100">Video Studio</h1>
        <p className="text-ink-400 text-sm mt-1">
          Build narrated videos and craft their sound — all in one place. Free, on your own machine. Every video
          auto-saves to memory.
        </p>
      </div>

      {/* Sub-tabs: build the video, or open the Sound Studio (DJ) — one unified studio. */}
      <div className="mt-4 inline-flex rounded-lg border border-ink-700 bg-ink-900 p-1">
        <button
          onClick={() => setStudioView('build')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'build' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🎬 Build &amp; Videos
        </button>
        <button
          onClick={() => setStudioView('sound')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'sound' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🎚 Sound Studio (DJ)
        </button>
        <button
          onClick={() => setStudioView('director')}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            studioView === 'director' ? 'bg-gold-500 text-ink-950 font-medium' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          🧠 AI Director
        </button>
      </div>

      {studioView === 'sound' && (
        <div className="mt-6">
          <DjStationPage embedded deckFile={djTrack ?? undefined} />
        </div>
      )}

      {studioView === 'director' && (
        <div className="mt-6">
          <DirectorPage embedded />
        </div>
      )}

      <div className={`mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 ${studioView === 'build' ? '' : 'hidden'}`}>
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
            <div>
              <label className="text-xs text-ink-400">Script to turn into a video</label>
              <select
                value={selectedKey}
                onChange={(e) => handleSelect(e.target.value)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                {sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleImportFile}
                className="mt-1.5 w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors"
              >
                📄 Upload a file (.txt / .md / .srt / .pdf)
              </button>
              <p className="text-[10px] text-ink-600 mt-1">
                Pick <span className="text-ink-400">“✍️ Paste / write my own”</span> to type or paste a script
                directly, or upload a file to load one. You can freely edit the title and text below before building.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Video title</label>
                <MicButton onText={(t) => setTitle((prev) => appendDictation(prev, t))} />
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Video title shown on the opening card"
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Narration script ({wordCount} words)</label>
                <MicButton onText={(t) => setBody((prev) => appendDictation(prev, t))} />
              </div>
              <textarea
                ref={scriptBoxRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="The spoken narration. Bracketed [STAGE DIRECTIONS] become on-screen section cards."
                className={`mt-1 w-full rounded-md bg-ink-800 border px-3 py-2 text-sm text-ink-100 leading-relaxed outline-none focus:border-gold-500 font-serif ${
                  needScriptFlash ? 'border-amber-400 ring-2 ring-amber-400/70 animate-pulse' : 'border-ink-700'
                }`}
              />
            </div>
            <TemplatesMenu
              title={title}
              body={body}
              onInsert={(t, b) => {
                setTitle(t)
                setBody(b)
              }}
            />
            <FactCheckPanel text={`${title}\n${body}`} />
            <div>
              <button
                onClick={handlePlan}
                disabled={planning || (!title.trim() && !body.trim())}
                className="w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {planning ? 'Planning…' : '🧭 AI Plan this video (hook + b-roll + CTR tips)'}
              </button>
              {plan && (
                <div className="mt-2 rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2 text-[11px]">
                  {plan.hook && (
                    <div>
                      <span className="text-gold-400">Hook:</span> <span className="text-ink-200">{plan.hook}</span>
                    </div>
                  )}
                  {plan.sections.length > 0 && (
                    <div>
                      <span className="text-gold-400">Sections &amp; b-roll:</span>
                      <ul className="mt-1 space-y-0.5">
                        {plan.sections.map((s, i) => (
                          <li key={i} className="text-ink-300">
                            • <span className="text-ink-100">{s.title}</span>
                            {s.keyword ? ` → 🎞 ${s.keyword}` : ''}
                            {s.seconds ? ` (~${s.seconds}s)` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {plan.thumbnailIdea && (
                    <div>
                      <span className="text-gold-400">Thumbnail:</span> <span className="text-ink-200">{plan.thumbnailIdea}</span>
                    </div>
                  )}
                  {plan.ctrTips.length > 0 && (
                    <div>
                      <span className="text-gold-400">CTR tips:</span>
                      <ul className="mt-1 space-y-0.5">
                        {plan.ctrTips.map((t, i) => (
                          <li key={i} className="text-ink-300">• {t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-600">
                    Guidance from your AI brain. Use the b-roll keywords with stock footage, and the hook/tips to sharpen
                    your script &amp; thumbnail.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-ink-400">Quick presets (one click sets shape · look · resolution)</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    { label: '▶ YouTube long-form', resolution: '1080p', aspect: '16:9', template: 'cinematic' },
                    { label: '📱 Shorts / TikTok / Reels', resolution: '1080p', aspect: '9:16', template: 'bold' },
                    { label: '⬛ Square (feed)', resolution: '1080p', aspect: '1:1', template: 'clean' }
                  ] as { label: string; resolution: VideoResolution; aspect: VideoAspect; template: VideoTemplate }[]
                ).map((p) => {
                  const active = aspect === p.aspect && template === p.template && resolution === p.resolution
                  return (
                    <button
                      key={p.label}
                      onClick={() => {
                        setResolution(p.resolution)
                        setAspect(p.aspect)
                        setTemplate(p.template)
                      }}
                      className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                        active ? 'border-gold-500 bg-gold-500/10 text-gold-300' : 'border-ink-700 text-ink-300 hover:border-ink-500'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-ink-600 mt-1">
                Presets only set the knobs below — you can still fine-tune everything afterwards.
              </p>
            </div>

            <div>
              <label className="text-xs text-ink-400">Video look (engine)</label>
              <div className="mt-1 space-y-1.5">
                {(Object.keys(ENGINE_INFO) as LookEngine[]).map((id) => {
                  const info = ENGINE_INFO[id]
                  const active = engine === id
                  // The local tier is hardware-gated: VISIBLE but greyed without an NVIDIA
                  // card, so the option is ready the day the hardware exists — never hidden.
                  // A DETECTED server always wins the gate: it may be a remote/other-PC
                  // ComfyUI, which works fine regardless of this machine's own GPU.
                  const gpuMissing = id === 'ai-local' && !!hardware && !hardware.gpu.hasCuda && !aiStatus?.localDetected
                  const ready =
                    id === 'presets' ||
                    id === 'ai-free' ||
                    (id === 'ai-free-video' && aiStatus?.freeCloudAvailable) ||
                    (id === 'ai-cloud' && aiStatus?.cloudConfigured) ||
                    (id === 'ai-local' && aiStatus?.localDetected)
                  const statusLine =
                    id === 'ai-free'
                      ? '✓ Ready — just needs internet'
                      : id === 'ai-free-video'
                        ? ready
                          ? aiStatus?.freeCloudProvider === 'pollinations'
                            ? '✓ Ready — Pollinations key saved (free Quest Pollen)'
                            : '✓ Ready — free Puter sign-in on the first build'
                          : (aiStatus?.freeCloudDetail ?? 'Checking the free video service…')
                        : id === 'ai-cloud'
                          ? ready
                            ? '✓ Configured — ready'
                            : 'Not set up yet — configure in Settings → AI Video'
                          : id === 'ai-local'
                            ? ready
                              ? '✓ ComfyUI server detected — ready'
                              : gpuMissing
                                ? 'Requires NVIDIA GPU — not detected on this system'
                                : 'Server not running — see Settings → AI Video for setup'
                            : null
                  return (
                    <button
                      key={id}
                      onClick={() => setEngine(id)}
                      className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                        active ? 'border-gold-500 bg-gold-500/5' : 'border-ink-700 hover:border-ink-500'
                      } ${gpuMissing ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink-100">{info.label}</span>
                        <span className="text-[10px] text-ink-400 shrink-0">{info.badge}</span>
                      </div>
                      <p className="text-[10px] text-ink-500 mt-0.5">{info.blurb}</p>
                      {statusLine && (
                        <p className={`text-[10px] mt-0.5 ${ready ? 'text-emerald-400' : 'text-amber-400/80'}`}>
                          {statusLine}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
              {(engine === 'ai-cloud' || engine === 'ai-local') && (
                <p className="text-[10px] text-ink-500 mt-1.5">
                  These generate real AI footage. The free “Style presets” engine needs no setup and always works
                  offline. If the chosen AI engine isn’t configured, the build will show setup instructions.
                </p>
              )}
              {/* Hardware honesty: say plainly, before a build is started, whether this PC
                  can do local AI motion video at all — instead of failing halfway through.
                  Hidden when a server IS detected (it may be a remote/other-PC ComfyUI). */}
              {engine === 'ai-local' && hardware && !hardware.gpu.hasCuda && !aiStatus?.localDetected && (
                <div className="mt-1.5 rounded-md border border-amber-600/50 bg-amber-950/20 p-2">
                  <div className="text-[11px] text-amber-300 font-medium">
                    Requires NVIDIA GPU — not detected on this system
                  </div>
                  <p className="text-[10px] text-ink-300 mt-1 leading-relaxed">
                    {hardware.models.find((m) => m.id === 'ltx-video')?.verdict.message ?? hardware.summary}
                  </p>
                  <p className="text-[10px] text-ink-400 mt-1 leading-relaxed">
                    The option stays here (configure it in Settings → AI Video) so it unlocks the day this PC has
                    the card. For real motion today, try “REAL AI video — free cloud” instead.
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => setEngine('ai-free-video')}
                      className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-[11px] font-medium px-2.5 py-1"
                    >
                      Use free cloud real video
                    </button>
                    <button
                      onClick={() => setEngine('ai-free')}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-[11px] px-2.5 py-1"
                    >
                      Use Photo slideshow
                    </button>
                  </div>
                </div>
              )}
              {engine === 'ai-free' && (
                <p className="text-[10px] text-emerald-400/90 mt-1.5">
                  Generates a real AI image for each scene (free, no key) and animates them. Needs internet; if the
                  service is busy it falls back to the animated look so the build never breaks.
                </p>
              )}
              {engine === 'ai-free-video' && (
                <p className="text-[10px] text-emerald-400/90 mt-1.5">
                  Honest expectations: each real-motion scene takes minutes to generate and draws on your free Puter
                  allowance. The status log always says which scenes got real motion and why any fell back to stills.
                </p>
              )}
            </div>

            {(engine === 'ai-free' || engine === 'ai-free-video' || engine === 'ai-local') && (
              <div>
                <label className="text-xs text-ink-400">
                  Visual style (guides the AI {engine === 'ai-free' ? 'images' : 'video'})
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as VideoStyle)}
                  className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
                >
                  {VIDEO_STYLE_GROUPS.map((g) => (
                    <optgroup key={g.family} label={g.family}>
                      {g.styles.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}

            {engine === 'presets' && (
              <>
                <div>
                  <label className="text-xs text-ink-400">Style</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value as VideoStyle)}
                    className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
                  >
                    {VIDEO_STYLE_GROUPS.map((g) => (
                      <optgroup key={g.family} label={g.family}>
                        {g.styles.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-[10px] text-ink-600 mt-1">
                    Changes colors, fonts and the waveform. Styles your text &amp; your images — it does not fabricate
                    AI footage.
                  </p>
                </div>
                <div>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${hasStockKey ? 'text-ink-300' : 'text-ink-600'}`}>
                    <input
                      type="checkbox"
                      checked={useStock && hasStockKey}
                      disabled={!hasStockKey}
                      onChange={(e) => setUseStock(e.target.checked)}
                      className="accent-gold-500"
                    />
                    🎞 Use real stock footage (online) — matched to your script
                  </label>
                  <p className="text-[10px] text-ink-600 mt-1">
                    {hasStockKey
                      ? 'Pulls real B-roll from Pixabay for each section (needs internet). Falls back to the animated look if offline.'
                      : 'Add a free Pixabay key in Settings → “Stock footage” to unlock real footage. Until then, videos use the animated look.'}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-ink-400">Background images (optional Ken-Burns)</label>
                  <button
                    onClick={handleAddImages}
                    className="mt-1 w-full rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors"
                  >
                    🖼 Add images…
                  </button>
                  {images.length > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[10px] text-ink-500">
                      <span>{images.length} image(s) — slow pan/zoom background</span>
                      <button onClick={() => setImages([])} className="text-ink-400 hover:text-red-300">
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-ink-400">Look (template)</label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as VideoTemplate)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 capitalize"
              >
                {VIDEO_TEMPLATES.map((t) => (
                  <option key={t} value={t} className="capitalize">{t}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink-600 mt-1">
                Clean = plain · News = crisp graded · Cinematic = graded + vignette + film grain + letterbox ·
                Bold = punchy colors. All add an animated title.
              </p>
            </div>
            <div>
              <label className="text-xs text-ink-400">Narration voice</label>
              <select
                value={narrationVoice}
                onChange={(e) => setNarrationVoice(e.target.value as typeof narrationVoice)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="winnatural" disabled={!winVoices.length}>
                  {winVoices.length
                    ? '★ Windows natural voice (best free — supports Urdu)'
                    : 'Windows natural voice — none found on this PC'}
                </option>
                <option value="piper" disabled={!piperInstalled}>
                  {piperInstalled ? 'Natural voice (Piper)' : 'Natural voice (Piper) — install in Settings first'}
                </option>
                <option value="windows">Built-in Windows voice (robotic, always free)</option>
                <option value="silent">🔇 No voice / silent — I&rsquo;ll record my own</option>
              </select>

              <label className="mt-2 flex items-start gap-2 text-xs text-ink-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={captionsAndChapters}
                  onChange={(e) => setCaptionsAndChapters(e.target.checked)}
                  className="mt-0.5 accent-gold-500"
                />
                <span>
                  Also make subtitles + YouTube chapters
                  <span className="block text-[10px] text-ink-600">
                    Off by default. When off, neither is created. Adds a minute or so to the build.
                  </span>
                </span>
              </label>

              {narrationVoice === 'silent' && (
                <p className="mt-1.5 text-[10px] text-emerald-300/90">
                  The video will be built with no narration at all. Its length is set from how long your script would
                  take to read aloud. Afterwards open 🎙 Voice studio under the finished video to record your own voice
                  over it.
                </p>
              )}

              {narrationVoice === 'winnatural' && (
                <div className="mt-2 space-y-1.5">
                  <select
                    value={winVoiceId}
                    onChange={(e) => setWinVoiceId(e.target.value)}
                    className="w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                  >
                    {winVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.language}
                        {v.language.toLowerCase().startsWith('ur') ? ' (Urdu)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={previewing || !winVoiceId}
                      onClick={() => void previewWinVoice()}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 disabled:opacity-40"
                    >
                      {previewing ? '▶ playing…' : '🔊 Hear this voice'}
                    </button>
                    <button
                      onClick={() => void window.api.voice.openSpeechSettings()}
                      className="text-[11px] text-gold-300 hover:text-gold-200"
                      title="Windows Settings → Speech: add a language to get its voices (free)"
                    >
                      + Add Urdu / more voices
                    </button>
                  </div>
                  {!winVoices.some((v) => v.language.toLowerCase().startsWith('ur')) && (
                    <p className="text-[10px] text-amber-400/80">
                      No Urdu voice on this PC yet. Click &ldquo;+ Add Urdu&rdquo;, add Urdu (Pakistan) speech in Windows,
                      then reopen this tab — Asad &amp; Uzma will appear here. Free, offline after install.
                    </p>
                  )}
                </div>
              )}

              <p className="text-[10px] text-ink-600 mt-1">
                Prefer your own voice? Build with any of these, then use 🎙 Voice studio to record over it — that stays
                the best quality.
              </p>
            </div>
            <div>
              <label className="text-xs text-ink-400">Format (shape)</label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as VideoAspect)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="16:9">16:9 — Landscape (YouTube)</option>
                <option value="9:16">9:16 — Vertical (Shorts / Reels / TikTok)</option>
                <option value="1:1">1:1 — Square (feed posts)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-400">Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as VideoResolution)}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                <option value="1080p">1080p Full HD (fastest)</option>
                <option value="1440p">1440p 2K QHD</option>
                <option value="4k">4K Ultra HD (sharper, slower)</option>
                <option value="8k">8K Ultra HD (7680×4320 — very slow, huge file)</option>
              </select>
              {resolution === '8k' && (
                <p className="text-[10px] text-gold-400/80 mt-1">
                  8K renders take a long time and produce very large files. For text/waveform-style videos, 4K already
                  looks razor-sharp — 8K is here because you asked, but 4K is the practical sweet spot.
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
              <input
                type="checkbox"
                checked={soundEffects}
                onChange={(e) => setSoundEffects(e.target.checked)}
                className="accent-gold-500"
              />
              Add transition sound effects (a soft whoosh at each section change)
            </label>
            <div>
              <label className="text-xs text-ink-400">Background music (optional)</label>
              <div className="mt-1 flex gap-1.5">
                <button
                  onClick={handlePickMusic}
                  className="flex-1 rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors truncate"
                  title={musicPath ?? undefined}
                >
                  {musicPath ? `🎵 ${musicPath.split(/[\\/]/).pop()}` : '🎵 Add your own music file…'}
                </button>
                {musicPath && (
                  <button
                    onClick={() => setMusicPath(null)}
                    className="rounded-md border border-ink-700 hover:border-red-500/60 text-ink-400 hover:text-red-300 text-xs px-2 py-1.5 transition-colors shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-ink-600 mt-1">
                Mixed softly under the narration (auto fade in/out). Use your own file, or grab a free track below.
              </p>
              {/* HIS ASK: "it gives me multiple examples... I play, I listen... and it
                  would tell me why." Three full-length beds from the offline synthesizer,
                  each with one sentence of reasoning; he picks, nothing is picked for him. */}
              <div className="mt-2">
                <button
                  onClick={() => {
                    if (makingExamples) return
                    setMakingExamples(true)
                    const words = body.trim().split(/\s+/).filter(Boolean).length
                    // Full length: narration runs ~2.4 words/second in this app's voices.
                    const estSec = Math.max(20, Math.round(words / 2.4))
                    void window.api.youtube
                      .musicExamples(body, estSec)
                      .then((r) => {
                        setMusicExamples(r.examples)
                        if (!r.examples.length) toast('Could not make music examples this time.', 'error')
                      })
                      .finally(() => setMakingExamples(false))
                  }}
                  disabled={makingExamples || !body.trim()}
                  className="rounded-md border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 disabled:opacity-40 text-xs px-3 py-1.5 transition-colors"
                >
                  {makingExamples ? 'Composing examples…' : '🎼 Make me examples to listen to'}
                </button>
                {musicExamples.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {musicExamples.map((ex) => (
                      <div key={ex.path} className={`rounded-md border p-2 ${musicPath === ex.path ? 'border-gold-500/60 bg-gold-500/5' : 'border-ink-700 bg-ink-800/60'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-ink-100 font-medium capitalize">{ex.mood}</span>
                          <button
                            onClick={() => setMusicPath(ex.path)}
                            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-[11px] font-medium px-2.5 py-1 transition-colors"
                          >
                            {musicPath === ex.path ? '✓ Chosen' : 'Use this one'}
                          </button>
                        </div>
                        <p className="text-[10px] text-ink-500 mt-1">{ex.why}</p>
                        <audio controls preload="none" src={fileUrl(ex.path)} className="mt-1.5 w-full h-8" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <details className="mt-2 rounded-md border border-ink-700 bg-ink-800/60">
                <summary className="cursor-pointer px-3 py-1.5 text-xs text-gold-400 select-none">
                  🎼 Get free, legal music ↗
                </summary>
                <div className="px-3 pb-2 pt-1 space-y-1">
                  {FREE_MUSIC.map((m) => (
                    <button
                      key={m.url}
                      onClick={() => window.open(m.url, '_blank')}
                      className="block w-full text-left rounded px-2 py-1 hover:bg-ink-700/60 transition-colors"
                    >
                      <span className="text-[11px] text-ink-100">{m.name}</span>
                      <span className="block text-[10px] text-ink-500">{m.note}</span>
                    </button>
                  ))}
                  <p className="text-[10px] text-ink-600 pt-1">
                    Download a track from one of these (all free/royalty-free), then click “Add your own music file”
                    above. We don’t rip from YouTube — that breaks its rules and could get your channel in trouble.
                  </p>
                </div>
              </details>
            </div>
            {/* The queue, when there is one. Above the Build button so it is the first
                thing seen after queueing something. */}
            <div className="mb-3">
              <RenderQueuePanel />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBuild}
                disabled={building}
                className="flex-1 rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
              >
                {building ? 'Building video…' : `🎬 Build Video (${resolution.toUpperCase()}, free)`}
              </button>
              {/* Queue it instead of building now: the point is to line several up and
                  walk away, and the list survives the app closing. */}
              <button
                onClick={() => void handleAddToQueue()}
                className="rounded-md border border-gold-500/50 hover:border-gold-400 text-gold-400 text-sm px-4 py-2 transition-colors"
                title="Puts it in the queue instead of building it now. Queue several and walk away — the list is written down, so closing the app does not lose it."
              >
                ＋ Queue it
              </button>
              {(building || exportingId || trimmingId) && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="rounded-md border border-red-500/60 hover:border-red-400 text-red-300 text-sm px-4 py-2 transition-colors disabled:opacity-50"
                >
                  {cancelling ? 'Stopping…' : '⏹ Stop'}
                </button>
              )}
            </div>
            {!body.trim() && !building && (
              <p className="text-[11px] text-amber-300/90 leading-snug">
                ⚠ Build needs script words first — type in the “Narration script” box above, or pick a saved
                script from the list at the top. Everything else (title, music, look) is optional.
              </p>
            )}
            {(building || exportingId || trimmingId) && stage && (
              <div className="flex items-center gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold-400" />
                <span className="text-[11px] text-gold-300/90 leading-snug">{stage}</span>
              </div>
            )}
            {building && buildPreview && (
              <div className="rounded-md border border-ink-800 bg-ink-950 p-2">
                <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">Live preview — opening frame</div>
                <img src={buildPreview} alt="preview" className="w-full rounded" />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <p className="text-[10px] text-ink-600">
              Uses the free bundled ffmpeg and the built-in Windows voice. Long scripts take longer to render — the
              progress line above shows the current stage.
            </p>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-ink-100">Your videos</h2>
              <span className="text-xs text-ink-500">{jobs.length} built</span>
            </div>
            {jobs.length > 1 && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-3 py-1.5">
                <span className="text-[11px] text-ink-400">
                  🔗 Tick videos to join them end-to-end{stitchSel.length ? ` (${stitchSel.length} selected)` : ''}
                </span>
                <button
                  onClick={handleStitch}
                  disabled={stitching || stitchSel.length < 2}
                  className="ml-auto rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 text-[11px] font-medium px-3 py-1 transition-colors"
                >
                  {stitching ? 'Stitching…' : 'Stitch selected'}
                </button>
                {stitchSel.length > 0 && (
                  <button onClick={() => setStitchSel([])} className="text-[11px] text-ink-400 hover:text-ink-200">
                    Clear
                  </button>
                )}
              </div>
            )}
            {savedNote && <p className="mt-1 text-[11px] text-emerald-400 break-all">{savedNote}</p>}
            {jobs.length ? (
              <div className="mt-3 space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="rounded-md border border-ink-700 bg-ink-800 p-3">
                    {/* flex-wrap + a basis on the text column: the button row used to be
                        shrink-0, so on a narrow panel it kept its full width and squeezed
                        the title/path column to about one character — which made the path
                        (break-all) render one letter per line as an endless vertical strip. */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
                        {jobs.length > 1 && (
                          <input
                            type="checkbox"
                            checked={stitchSel.includes(job.id)}
                            onChange={() => toggleStitchSel(job.id)}
                            title="Select for stitching"
                            className="mt-1 accent-gold-500 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                        <div className="text-sm text-ink-100 truncate">{job.title || 'Untitled video'}</div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          {job.hasCustomVoice ? 'With your recorded voice' : 'Narrated (Windows voice)'} ·{' '}
                          {new Date(job.createdAt).toLocaleString()}
                        </div>
                        <p className="text-[10px] text-ink-600 mt-1 truncate" title={job.path}>{job.path}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          onClick={() => window.api.video.reveal(job.path)}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                        >
                          Show file
                        </button>
                        <button
                          onClick={() => handleSaveAs(job)}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                        >
                          Save a copy
                        </button>
                        <button
                          onClick={() => handleEnhance(job)}
                          disabled={enhanceBusyId === job.id}
                          title="Clean up the voice (de-noise + loudness) and polish the picture (colour + sharpen) → a new copy"
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          {enhanceBusyId === job.id ? 'Enhancing…' : '✨ Enhance'}
                        </button>
                        <button
                          onClick={() => setVoiceOpenId(voiceOpenId === job.id ? null : job.id)}
                          className={`rounded-md border text-xs px-3 py-1 transition-colors ${
                            voiceOpenId === job.id
                              ? 'border-gold-500 text-gold-300'
                              : 'border-ink-600 hover:border-ink-400 text-ink-200'
                          }`}
                        >
                          🎙 Voice studio
                        </button>
                        <button
                          onClick={() => toggleTrim(job)}
                          className={`rounded-md border text-xs px-3 py-1 transition-colors ${
                            trimOpenId === job.id
                              ? 'border-gold-500 text-gold-300'
                              : 'border-ink-600 hover:border-ink-400 text-ink-200'
                          }`}
                        >
                          ✂ Trim / cut
                        </button>
                        <button
                          onClick={() => handlePublish(job)}
                          disabled={publishBusyId === job.id}
                          className="rounded-md border border-red-500/50 hover:border-red-400 text-red-300 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          {publishBusyId === job.id ? 'Preparing…' : '▶ Publish to YouTube'}
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="rounded-md border border-ink-700 hover:border-red-500/60 text-ink-400 hover:text-red-300 text-xs px-3 py-1 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {job.narrationPath ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                        <span className="text-[11px] text-ink-400">🎵 Music</span>
                        <button
                          onClick={() => handleSetMusic(job, 'remove')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Remove (keep my voice)
                        </button>
                        <span className="text-[11px] text-ink-500">or replace with</span>
                        <select
                          value={replaceMood}
                          onChange={(e) => setReplaceMood(e.target.value as Mood)}
                          className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500 capitalize"
                        >
                          {MOODS.map((m) => (
                            <option key={m} value={m} className="capitalize">{m}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSetMusic(job, 'replace')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button
                          onClick={() => handleSeparateMusic(job, 'online', 'music')}
                          disabled={musicBusyId === job.id}
                          title="AI-separates the mixed audio and keeps only the music/instrumental"
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Remove my voice (keep music)
                        </button>
                        {musicBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                        <div className="w-full flex flex-wrap items-center gap-1.5 pt-1 border-t border-ink-800">
                          <span className="text-[11px] text-gold-300">🎧 AI DJ</span>
                          <input
                            value={aiDjHint}
                            onChange={(e) => setAiDjHint(e.target.value)}
                            placeholder="optional — what should it feel like? (e.g. lofi · tense · calm) Empty = it reads the video"
                            className="flex-1 min-w-[180px] rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                          />
                          <button
                            onClick={() => handleAiDj(job)}
                            disabled={musicBusyId === job.id}
                            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1 transition-colors disabled:opacity-50"
                          >
                            Let the AI DJ pick &amp; lay the music
                          </button>
                          <span className="w-full text-[10px] text-ink-600">
                            Reads this video’s own script (or listens to the narration) to judge the mood, composes a fitting
                            track sized to the video, and mixes it softly under your voice. New copy — the original is kept.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                        <span className="text-[11px] text-ink-400">🎵 Remove music (AI separate)</span>
                        <button
                          onClick={() => handleSeparateMusic(job, 'online')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Online (free)
                        </button>
                        <button
                          onClick={() => handleSeparateMusic(job, 'local')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Local (Demucs)
                        </button>
                        <span className="text-[11px] text-ink-500">· or remove the VOICE instead:</span>
                        <button
                          onClick={() => handleSeparateMusic(job, 'online', 'music')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Keep music (online)
                        </button>
                        <button
                          onClick={() => handleSeparateMusic(job, 'local', 'music')}
                          disabled={musicBusyId === job.id}
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Keep music (local)
                        </button>
                        {musicBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                        <span className="w-full text-[10px] text-ink-600">
                          For videos NOT made in the app (music already mixed in). Online works out of the box (free, built-in);
                          Local needs a one-time Demucs install. Quality is an AI estimate — great for clear speech over music.
                          Videos you build in the app remove/replace music exactly without this.
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">© Credits</span>
                      <button
                        onClick={() => handleCreditCheck(job)}
                        disabled={creditsBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Check before publishing
                      </button>
                      {creditsBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      {creditReport?.id === job.id && (
                        <>
                          <span
                            className={`w-full text-[11px] ${creditReport.ok ? 'text-emerald-300' : 'text-amber-300'}`}
                          >
                            {creditReport.headline}
                          </span>
                          {creditReport.creditsBlock && (
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(creditReport.creditsBlock)
                                toast('Credits copied ✓', 'success')
                              }}
                              className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1 transition-colors"
                            >
                              Copy the credits
                            </button>
                          )}
                          {creditReport.verdicts.map((v, i) => (
                            <span key={`${v.item.title}-${i}`} className="w-full text-[10px] text-ink-500">
                              {v.item.title} — {v.note}
                            </span>
                          ))}
                        </>
                      )}
                      <span className="w-full text-[10px] text-ink-600">
                        This is NOT a copyright detector — nothing on your PC can tell you whether YouTube will claim
                        something. It checks the paperwork for music and footage the app fetched itself: whether the
                        licence needs a credit, and whether that credit is actually in your description. A missing
                        credit is what turns a free track into a claim.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">✂ Dead air</span>
                      <button
                        onClick={() => handleSilencePlan(job)}
                        disabled={silenceBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        What would be cut?
                      </button>
                      {silencePlan?.id === job.id && silencePlan.cuts > 0 && (
                        <button
                          onClick={() => handleSilenceApply(job)}
                          disabled={silenceBusyId === job.id}
                          className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          Cut it
                        </button>
                      )}
                      {silenceBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      {silencePlan?.id === job.id && (
                        <span className="w-full text-[11px] text-gold-300">{silencePlan.headline}</span>
                      )}
                      <span className="w-full text-[10px] text-ink-600">
                        Removes the long pauses where nothing is said, keeping a quarter-second of breath so it still
                        sounds like a person talking. Picture and sound are cut together, so nothing goes out of sync.
                        Makes a NEW video — your original stays in this list.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">📝 Captions</span>
                      <button
                        onClick={() => handleCaptions(job, false)}
                        disabled={captionBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Get subtitles (.srt)
                      </button>
                      <button
                        onClick={() => handleCaptions(job, true)}
                        disabled={captionBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Burn into video
                      </button>
                      {captionBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      <span className="w-full text-[10px] text-ink-600">
                        Transcribes your narration offline (free). The .srt uploads straight to YouTube; “Burn” makes a
                        captioned copy for Shorts/Reels — your original (without captions) stays in this list.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">🎛 Studio tools</span>
                      <button
                        onClick={() => handleOpenInDecks(job)}
                        title="Pulls this video's audio out and loads it onto Deck A of the Dual decks"
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                      >
                        Open audio in DJ decks
                      </button>
                      {job.body && (job.engine ?? 'presets') === 'presets' && (
                        <button
                          onClick={() => handleCleanCopy(job)}
                          disabled={building}
                          title="Rebuilds this exact video with NOTHING drawn over the picture — no title, no headings, no captions"
                          className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                        >
                          🧹 Clean copy (no on-screen text)
                        </button>
                      )}
                      {!job.body && (
                        <span className="text-[10px] text-ink-600">
                          (Clean copy — a rebuild without titles/headings — unlocks for videos built from now on.)
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-gold-500/30 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-gold-300">📱 Make Shorts</span>
                      <label className="text-[11px] text-ink-400 flex items-center gap-1">
                        How many
                        <select
                          value={shortsCount}
                          onChange={(e) => setShortsCount(Number(e.target.value))}
                          disabled={shortsBusyId === job.id}
                          className="rounded bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100"
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() => handleMakeShorts(job, shortsCount)}
                        disabled={shortsBusyId === job.id}
                        className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        📱 Cut into vertical shorts
                      </button>
                      {shortsBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                      <span className="w-full text-[10px] text-ink-600">
                        Listens to this video offline, picks the strongest moments (hooks, numbers, questions), and
                        makes 9:16 clips with big burned-in captions — ready for YouTube Shorts, TikTok and Reels.
                        They appear in this list. Free, no internet needed.
                      </span>
                    </div>
                    {/* Ready-to-paste posting text so uploading is copy-paste, not writing. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">🏷 Posting text</span>
                      <button
                        onClick={() => handlePostMeta(job, 'youtube')}
                        disabled={metaBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        YouTube
                      </button>
                      <button
                        onClick={() => handlePostMeta(job, 'tiktok')}
                        disabled={metaBusyId === job.id}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        TikTok
                      </button>
                      {metaBusyId === job.id && <span className="text-[10px] text-gold-300">writing…</span>}
                      {postMeta && postMeta.id === job.id && (
                        <div className="w-full mt-1 space-y-1.5">
                          {(
                            [
                              ['Title', postMeta.meta.title],
                              ['Description', postMeta.meta.description],
                              ['Hashtags', postMeta.meta.hashtags.map((h) => `#${h}`).join(' ')]
                            ] as [string, string][]
                          ).map(([label, value]) => (
                            <div key={label} className="rounded border border-ink-800 bg-ink-950 p-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-ink-500">{label}</span>
                                <button
                                  onClick={() => {
                                    // Match the app's existing guarded pattern, but never
                                    // claim success if the clipboard isn't available.
                                    if (navigator.clipboard?.writeText) {
                                      void navigator.clipboard
                                        .writeText(value)
                                        .then(() => toast(`${label} copied ✓`, 'success'))
                                        .catch(() => toast('Could not copy — select the text and press Ctrl+C', 'error'))
                                    } else {
                                      toast('Could not copy — select the text and press Ctrl+C', 'error')
                                    }
                                  }}
                                  className="ml-auto text-[10px] text-gold-300 hover:text-gold-200"
                                >
                                  Copy
                                </button>
                              </div>
                              <div className="whitespace-pre-wrap text-[11px] text-ink-200">{value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="w-full text-[10px] text-ink-600">
                        Writes a click-worthy title, a short description and hashtags for this clip — then Copy each
                        one straight into YouTube/TikTok.
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">🏷 Logo</span>
                      <button
                        onClick={pickLogo}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors"
                      >
                        {watermarkLogo ? 'Change logo' : 'Pick logo image'}
                      </button>
                      {watermarkLogo && <span className="text-[10px] text-emerald-400 truncate max-w-[120px]">{watermarkLogo.split(/[\\/]/).pop()}</span>}
                      <select
                        value={watermarkPos}
                        onChange={(e) => setWatermarkPos(e.target.value as typeof watermarkPos)}
                        className="rounded bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100"
                      >
                        <option value="bottom-right">bottom-right</option>
                        <option value="bottom-left">bottom-left</option>
                        <option value="top-right">top-right</option>
                        <option value="top-left">top-left</option>
                      </select>
                      <button
                        onClick={() => handleWatermark(job)}
                        disabled={watermarkBusyId === job.id || !watermarkLogo}
                        className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1 transition-colors disabled:opacity-50"
                      >
                        Apply
                      </button>
                      {watermarkBusyId === job.id && <span className="text-[10px] text-gold-300">working…</span>}
                    </div>
                    {voiceOpenId === job.id && (
                      <VoiceRecorder
                        job={job}
                        onDone={async (newJob) => {
                          setVoiceOpenId(null)
                          await refreshJobs()
                          setSavedNote(`Voice-over added — new video “${newJob.title}” saved.`)
                        }}
                        onPlayVideo={() => {
                          const el = videoRefs.current[job.id]
                          if (!el) return
                          el.currentTime = 0
                          void el.play().catch(() => {})
                        }}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 p-2">
                      <span className="text-[11px] text-ink-400">⬇ Download as</span>
                      <select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                        className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-[11px] text-ink-100 outline-none focus:border-gold-500"
                      >
                        {EXPORT_FORMATS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleExport(job)}
                        disabled={exportingId === job.id}
                        className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 text-[11px] font-medium px-3 py-1 transition-colors"
                      >
                        {exportingId === job.id ? 'Exporting…' : '⬇ Download'}
                      </button>
                      <span className="text-[10px] text-ink-600 basis-full">
                        {EXPORT_FORMATS.find((f) => f.id === exportFormat)?.note} Pick a different format if YouTube ever
                        changes what it accepts.
                      </span>
                    </div>
                    <video
                      ref={(el) => {
                        videoRefs.current[job.id] = el
                      }}
                      src={fileUrl(job.path)}
                      controls
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        if (trimOpenId === job.id && Number.isFinite(e.currentTarget.duration)) {
                          setTrimDuration(e.currentTarget.duration)
                        }
                      }}
                      onTimeUpdate={(e) => {
                        if (trimOpenId === job.id) setPlayhead(e.currentTarget.currentTime)
                      }}
                      className="mt-2 w-full max-h-72 rounded-md bg-black"
                    />
                    {extras?.videoId === job.id && (extras.chapters || extras.srtPath) && (
                      <div className="mt-2 rounded-md border border-emerald-600/40 bg-ink-900/60 p-3 space-y-2">
                        <div className="text-[11px] text-emerald-300 font-medium">Subtitles &amp; chapters</div>
                        {extras.srtPath ? (
                          <div className="text-[10px] text-ink-400">
                            Subtitle file saved next to the video (.srt) — upload it with your video on YouTube.
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-300">
                            No speech was detected, so no subtitles were made.
                          </div>
                        )}
                        {extras.chapters ? (
                          <>
                            <textarea
                              readOnly
                              value={extras.chapters}
                              rows={Math.min(8, extras.chapters.split('\n').length)}
                              className="w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1 text-[11px] text-ink-200 font-mono"
                            />
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(extras.chapters)
                                toast('Chapters copied — paste them into your YouTube description.')
                              }}
                              className="rounded-md border border-ink-600 px-2 py-1 text-[10px] text-ink-300 hover:border-gold-500"
                            >
                              📋 Copy chapters for the description
                            </button>
                          </>
                        ) : (
                          <div className="text-[10px] text-ink-500">
                            This script was too short (or had too few sections) for YouTube chapters.
                          </div>
                        )}
                      </div>
                    )}
                    {trimOpenId === job.id && (
                      <div className="mt-2 rounded-md border border-gold-500/30 bg-ink-900/60 p-3 space-y-2">
                        <p className="text-[11px] text-ink-300">
                          Tap the bar to move the nearest marker, or drag a marker. Then choose whether to cut that
                          section out or keep only it.
                        </p>
                        <TrimTimeline
                          duration={trimDuration}
                          start={trimStart}
                          end={trimEnd}
                          playhead={playhead}
                          mode={trimMode}
                          onChange={(s, e2) => {
                            setTrimStart(s)
                            setTrimEnd(e2)
                          }}
                          onSeek={(sec) => {
                            const el = videoRefs.current[job.id]
                            if (!el) return
                            el.currentTime = sec
                            setPlayhead(sec)
                          }}
                        />
                        <div className="pt-1 border-t border-ink-800">
                          <MusicTrackBar
                            duration={trimDuration}
                            region={musicRegion}
                            onChange={setMusicRegion}
                            onPick={() => setMusicPickerOpen(true)}
                            busy={musicBusy}
                          />
                          {musicPickerOpen && (
                            <MusicPicker
                              scriptText={`${job.title}\n${body}`}
                              current={musicRegion?.track ?? null}
                              onChoose={(t) => {
                                setMusicRegion((r) =>
                                  r
                                    ? { ...r, track: t }
                                    : { startSec: 0, endSec: Math.min(30, trimDuration || 30), track: t }
                                )
                                setMusicPickerOpen(false)
                              }}
                              onClose={() => setMusicPickerOpen(false)}
                            />
                          )}
                          {musicRegion?.track && (
                            <button
                              onClick={() => void handleApplyMusic(job)}
                              disabled={musicBusy}
                              className="mt-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 transition-colors"
                            >
                              {musicBusy ? 'Adding music…' : '🎵 Add this music to the video'}
                            </button>
                          )}
                        </div>
                        <details className="text-[10px] text-ink-500">
                          <summary className="cursor-pointer hover:text-ink-300">Type exact times instead</summary>
                        <div className="flex flex-wrap items-end gap-2 mt-2">
                          <div>
                            <label className="text-[10px] text-ink-400 block">Start (s)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={trimStart}
                              onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                              className="w-24 rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                            />
                            <button
                              onClick={() => applyCurrentTime(job,'start')}
                              className="ml-1 rounded border border-ink-600 hover:border-ink-400 text-ink-300 text-[10px] px-1.5 py-1"
                            >
                              Use current
                            </button>
                          </div>
                          <div>
                            <label className="text-[10px] text-ink-400 block">End (s)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={trimEnd}
                              onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                              className="w-24 rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                            />
                            <button
                              onClick={() => applyCurrentTime(job,'end')}
                              className="ml-1 rounded border border-ink-600 hover:border-ink-400 text-ink-300 text-[10px] px-1.5 py-1"
                            >
                              Use current
                            </button>
                          </div>
                        </div>
                        </details>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={trimMode}
                            onChange={(e) => setTrimMode(e.target.value as TrimMode)}
                            className="rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                          >
                            <option value="remove">Remove this range (cut it out)</option>
                            <option value="keep">Keep only this range (clip it)</option>
                          </select>
                          <button
                            onClick={() => handleTrim(job)}
                            disabled={trimmingId === job.id}
                            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1 transition-colors"
                          >
                            {trimmingId === job.id ? 'Working…' : 'Apply ✂'}
                          </button>
                          <span className="text-[10px] text-ink-600">
                            Creates a new video — your original stays untouched.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-ink-700 py-10 px-6 text-center text-ink-500 text-sm">
                No videos yet. Pick a script on the left and click “Build Video”.
                <span className="block mt-2 text-[11px] text-ink-600">
                  Once a video is built, it appears here with buttons to <span className="text-ink-400">Save a copy</span>{' '}
                  (download to USB/anywhere), <span className="text-ink-400">🎙 Voice studio</span> (record your own
                  audio over it), and a built-in preview player.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
