import { useEffect, useMemo, useRef, useState } from 'react'
import { VIDEO_STYLES, type GraftRegion, type VideoStyle } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'
import { fileUrl } from '../../../shared/mediaUrl'

type Mode = 'video' | 'photo' | 'graft'

const MODE_NOTE: Record<Mode, string> = {
  video:
    '🎥 Real Video Presenter (recommended). Upload a video of yourself narrating. Your REAL voice becomes the master track and your real face/lips appear as the on-camera moments — the rest cuts to theme b-roll + AI scenes on your voice. No fakery, real sync.',
  photo:
    '🖼 Photo Presenter. No video needed — your still photo appears (subtly moving, background-removed into the scene) on the presenter beats; the natural voice narrates. Good when you don’t want to film yourself.',
  graft:
    '✨ Living Picture (graft). Add your narration VIDEO and a PICTURE where you look your best. The moving part of the video (your mouth/face) is cut out, feather-edged and composited onto the picture — so the picture speaks with your real voice while keeping the look you chose. Position it with the sliders and check the Preview. Optional: set a local face-animation tool in Settings for full-quality grafting; without it the built-in engine is used. Free, offline, no fakery of anyone else — it is your own footage on your own picture.'
}

/** Default graft region — mirrors DEFAULT_GRAFT_REGION in the main process. */
const DEFAULT_REGION: GraftRegion = {
  sx: 0.3, sy: 0.5, sw: 0.4, sh: 0.3,
  dx: 0.35, dy: 0.55, dw: 0.3,
  featherFrac: 0.12, brightness: 0, saturation: 1
}

/**
 * Presenter Studio — put YOU in the video. Pick a mode, add your video (or photo) + script,
 * and the AI intercuts you with theme b-roll (Pixabay) + AI scenes, your voice throughout.
 * Reuses the tested Storyboard engine under the hood.
 */
export default function PresenterPage(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('video')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [style, setStyle] = useState<VideoStyle>('cinematic')
  // AI scene beats: classic animated stills, or REAL AI video (free cloud / local GPU).
  // Your own footage/photo beats are never AI-generated; failures fall back to stills.
  const [motion, setMotion] = useState<'stills' | 'ai-free-video' | 'ai-local'>('stills')
  const [presenterPath, setPresenterPath] = useState('')
  const [graftPhotoPath, setGraftPhotoPath] = useState('')
  const [region, setRegion] = useState<GraftRegion>(DEFAULT_REGION)
  const [graftPreview, setGraftPreview] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((s: string) => setStage(s))
    return () => unsub.current?.()
  }, [])

  // Autosave everything on this tab (script, mode, style, chosen files, graft region).
  const persisted = useMemo(
    () => ({ mode, title, body, style, presenterPath, graftPhotoPath, region }),
    [mode, title, body, style, presenterPath, graftPhotoPath, region]
  )
  const saveStatus = useAutosave('presenter-tab', persisted, (v) => {
    if (v.mode) setMode(v.mode)
    if (v.title != null) setTitle(v.title)
    if (v.body != null) setBody(v.body)
    if (v.style) setStyle(v.style)
    if (v.presenterPath != null) setPresenterPath(v.presenterPath)
    if (v.graftPhotoPath != null) setGraftPhotoPath(v.graftPhotoPath)
    if (v.region) setRegion({ ...DEFAULT_REGION, ...v.region })
  })

  const needsPhoto = mode === 'photo'
  const fileLabel = needsPhoto ? 'your photo' : 'your narration video'

  async function pick(): Promise<void> {
    setError(null)
    const p = needsPhoto ? await window.api.storyboard.pickPhoto() : await window.api.presenter.pickVideo()
    if (p) setPresenterPath(p)
  }

  async function pickGraftPhoto(): Promise<void> {
    setError(null)
    const p = await window.api.storyboard.pickPhoto()
    if (p) { setGraftPhotoPath(p); setGraftPreview(null) }
  }

  async function previewGraft(): Promise<void> {
    if (!presenterPath || !graftPhotoPath) { setError('Pick both your video and your picture first.'); return }
    setPreviewBusy(true); setError(null)
    try {
      const res = await window.api.presenter.graftPreview({ photoPath: graftPhotoPath, videoPath: presenterPath, region })
      if (res.ok && res.path) setGraftPreview(`${fileUrl(res.path)}?t=${Date.now()}`)
      else setError(res.error ?? 'Preview failed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed.')
    } finally {
      setPreviewBusy(false)
    }
  }

  async function build(): Promise<void> {
    if (!body.trim()) { setError('Paste your script first.'); return }
    if (!presenterPath) { setError(`Add ${fileLabel} first.`); return }
    if (mode === 'graft' && !graftPhotoPath) { setError('Add the picture to graft onto (the one where you look your best).'); return }
    setBusy(true); setError(null); setNote(null); setStage('Starting…')
    try {
      const res = await window.api.presenter.build({
        title: title.trim() || 'Presenter video',
        body,
        mode,
        presenterPath,
        graftPhotoPath: mode === 'graft' ? graftPhotoPath : undefined,
        graftRegion: mode === 'graft' ? region : undefined,
        style,
        motionEngine: motion === 'stills' ? undefined : motion
      })
      if (res.ok) { setNote('Presenter video built ✓ — open Video Studio to preview, voice-check, export, or the Timeline to fine-tune.'); toast('Presenter video built ✓', 'success') }
      else setError(res.error ?? 'Build failed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed.')
    } finally {
      setBusy(false); setStage(null)
    }
  }

  const fileName = presenterPath ? presenterPath.split(/[\\/]/).pop() : ''

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-gold-400">Presenter Studio
        <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
      </h1>
      <p className="text-ink-400 text-sm mt-1">Put yourself in the video — real footage or your photo — and the AI cuts to theme b-roll + AI scenes on your voice.</p>

      {/* Mode selector. Switching between photo- and video-based modes clears the
          attached file: a photo picked in Photo mode used to stay attached as "your
          narration video" in the video modes (and vice versa), building the wrong thing. */}
      <div className="mt-4 inline-flex rounded-md border border-ink-700 overflow-hidden text-sm">
        {(['video', 'photo', 'graft'] as Mode[]).map((m) => (
          <button key={m} onClick={() => { if ((m === 'photo') !== (mode === 'photo')) setPresenterPath(''); setMode(m) }} className={`px-3 py-1.5 ${mode === m ? 'bg-gold-500 text-ink-950' : 'text-ink-300 hover:bg-ink-800'}`}>
            {m === 'video' ? '🎥 Real Video' : m === 'photo' ? '🖼 Photo' : '✨ Living Picture'}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-[12px] text-ink-300">{MODE_NOTE[mode]}</div>

      {/* File + inputs */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={pick} disabled={busy} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">
          {needsPhoto ? '🖼 Choose my photo' : '🎥 Upload my narration video'}
        </button>
        {fileName && <span className="text-xs text-ink-500 truncate max-w-[280px]">{fileName}</span>}
        <label className="ml-auto text-xs text-ink-400">Look</label>
        <select value={style} onChange={(e) => setStyle(e.target.value as VideoStyle)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200">
          {VIDEO_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={motion}
          onChange={(e) => setMotion(e.target.value as 'stills' | 'ai-free-video' | 'ai-local')}
          className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200"
          title="Applies to the AI scene beats only — your own footage/photo stays untouched. Failures fall back to animated stills; the build never breaks."
        >
          <option value="stills">AI scenes: animated stills</option>
          <option value="ai-free-video">AI scenes: REAL video — free cloud</option>
          <option value="ai-local">AI scenes: REAL video — local GPU</option>
        </select>
      </div>

      {/* GRAFT: picture picker + region controls + live preview */}
      {mode === 'graft' && (
        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={pickGraftPhoto} disabled={busy} className="rounded-md border border-gold-700 px-3 py-2 text-sm text-gold-300 hover:bg-ink-800 disabled:opacity-40">
              🖼 Choose my best picture
            </button>
            {graftPhotoPath && <span className="text-xs text-ink-500 truncate max-w-[280px]">{graftPhotoPath.split(/[\\/]/).pop()}</span>}
            <button onClick={previewGraft} disabled={previewBusy || !presenterPath || !graftPhotoPath} className="ml-auto rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">
              {previewBusy ? 'Compositing…' : '🔍 Preview the graft'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-ink-300">
            <div>
              <div className="text-ink-400 mb-1">FROM the video (the moving part — usually your mouth/face)</div>
              {([
                ['Left', 'sx', 0, 0.9], ['Top', 'sy', 0, 0.9], ['Width', 'sw', 0.05, 1], ['Height', 'sh', 0.05, 1]
              ] as [string, keyof GraftRegion, number, number][]).map(([label, key, min, max]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-16">{label}</span>
                  <input type="range" min={min} max={max} step={0.01} value={region[key]} className="flex-1 accent-amber-400"
                    onChange={(e) => setRegion((r) => ({ ...r, [key]: Number(e.target.value) }))} />
                  <span className="w-10 text-right">{Math.round((region[key] as number) * 100)}%</span>
                </label>
              ))}
            </div>
            <div>
              <div className="text-ink-400 mb-1">ONTO the picture (where it lands)</div>
              {([
                ['Left', 'dx', 0, 0.95], ['Top', 'dy', 0, 0.95], ['Width', 'dw', 0.05, 1]
              ] as [string, keyof GraftRegion, number, number][]).map(([label, key, min, max]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-16">{label}</span>
                  <input type="range" min={min} max={max} step={0.01} value={region[key]} className="flex-1 accent-amber-400"
                    onChange={(e) => setRegion((r) => ({ ...r, [key]: Number(e.target.value) }))} />
                  <span className="w-10 text-right">{Math.round((region[key] as number) * 100)}%</span>
                </label>
              ))}
              <div className="text-ink-400 mb-1 mt-2">Blend</div>
              <label className="flex items-center gap-2">
                <span className="w-16">Feather</span>
                <input type="range" min={0} max={0.45} step={0.01} value={region.featherFrac} className="flex-1 accent-amber-400"
                  onChange={(e) => setRegion((r) => ({ ...r, featherFrac: Number(e.target.value) }))} />
                <span className="w-10 text-right">{Math.round(region.featherFrac * 100)}%</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-16">Brightness</span>
                <input type="range" min={-0.3} max={0.3} step={0.01} value={region.brightness} className="flex-1 accent-amber-400"
                  onChange={(e) => setRegion((r) => ({ ...r, brightness: Number(e.target.value) }))} />
                <span className="w-10 text-right">{region.brightness.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-16">Colour</span>
                <input type="range" min={0.2} max={2} step={0.05} value={region.saturation} className="flex-1 accent-amber-400"
                  onChange={(e) => setRegion((r) => ({ ...r, saturation: Number(e.target.value) }))} />
                <span className="w-10 text-right">{region.saturation.toFixed(2)}</span>
              </label>
              <button onClick={() => setRegion(DEFAULT_REGION)} className="mt-1 text-[11px] text-ink-500 underline hover:text-ink-300">Reset to defaults</button>
            </div>
          </div>

          {graftPreview && (
            <div>
              <div className="text-[11px] text-ink-500 mb-1">Preview — this exact composite is what the full video uses. Adjust the sliders and preview again until it melts into the picture.</div>
              <img src={graftPreview} alt="Graft preview" className="rounded-md border border-ink-700 max-h-72" />
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-ink-400">Title</label>
          <MicButton onText={(t) => setTitle((p) => appendDictation(p, t))} />
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional — a title (auto-derived if blank)" className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100" />
        <div className="flex items-center justify-between">
          <label className="text-xs text-ink-400">Script (paste your full narration — [visual] lines become scenes)</label>
          <MicButton onText={(t) => setBody((p) => appendDictation(p, t))} />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Paste your full script here. For video mode this should match what you say in your uploaded video." className="w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200 font-serif" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={build} disabled={busy || !body.trim() || !presenterPath} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950">
          {busy ? 'Building…' : '🎬 Build presenter video'}
        </button>
        {busy && stage && <span className="text-sm text-gold-300">{stage}</span>}
      </div>

      {error && <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <div className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}

      <p className="mt-4 text-[11px] text-ink-600">
        Tip: theme b-roll needs a free Pixabay key in Settings (already connected on this PC). Build times scale with your
        video length — a long narration takes a while. Everything you add here autosaves and the finished video is saved in Video Studio.
      </p>
    </div>
  )
}
