import { useEffect, useMemo, useRef, useState } from 'react'
import { useHistory } from '../hooks/useHistory'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import { fileUrl } from '../../../shared/mediaUrl'
import type {
  TimelineAudioClip,
  TimelineDoc,
  TimelineTextOverlay,
  TimelineVideoClip
} from '../../../shared/types'

/**
 * Timeline NLE — a real non-linear editor. Add video/image clips to the video track
 * (trim each, set a crossfade into it, reorder), layer audio clips (trim/gain/fade/
 * place), and overlay text (timed, with fades). The bar under each track visualises
 * the true timeline: crossfades overlap, so the total length shrinks by each fade.
 * Everything autosaves; the actual render reuses the unit-tested timeline engine.
 */

let idSeq = 0
const nid = (p: string): string => `${p}${Date.now().toString(36)}${idSeq++}`
const round2 = (n: number): number => Math.round(n * 100) / 100

const RES: Record<string, { w: number; h: number }> = {
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 }
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}
function isImage(p: string): boolean {
  return /\.(jpe?g|png|webp|bmp)$/i.test(p)
}

/** Effective duration of one video clip after its source trim. */
function vdur(c: TimelineVideoClip): number {
  return Math.max(0, c.outSec - c.inSec)
}
/** Total video-track duration: Σ durations − Σ crossfades (each overlaps). */
function totalDuration(video: TimelineVideoClip[]): number {
  let total = 0
  video.forEach((c, i) => {
    total += vdur(c)
    if (i > 0) total -= Math.min(Math.max(c.transitionSec ?? 0, 0), vdur(c))
  })
  return Math.max(0, total)
}

export default function TimelinePage(): React.JSX.Element {
  const [resKey, setResKey] = useState<keyof typeof RES | string>('1080p')
  const [fps, setFps] = useState(25)
  const [video, setVideo] = useState<TimelineVideoClip[]>([])
  const [audio, setAudio] = useState<TimelineAudioClip[]>([])
  const [text, setText] = useState<TimelineTextOverlay[]>([])
  // Undo/redo over the STRUCTURAL edits (clips, audio, overlays) — one wrong delete
  // or drag used to be unrecoverable. Ctrl+Z / Ctrl+Y, plus the ↩ ↪ buttons.
  const history = useHistory({ video, audio, text }, (v) => {
    setVideo(v.video)
    setAudio(v.audio)
    setText(v.text)
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [renderedPath, setRenderedPath] = useState<string | null>(null)

  // A TimelineDoc handed over from the Storyboard Director ("open in editor"). Known at
  // first render, so autosave can skip its restore and NOT clobber the imported film.
  const location = useLocation()
  const navigate = useNavigate()
  const importDoc = (location.state as { importTimeline?: TimelineDoc } | null)?.importTimeline

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((stage: string) => setProgress(stage))
    return () => unsub.current?.()
  }, [])

  const imported = useRef(false)
  useEffect(() => {
    if (imported.current || !importDoc) return
    imported.current = true
    const match = Object.keys(RES).find((k) => RES[k].w === importDoc.width && RES[k].h === importDoc.height)
    if (match) setResKey(match)
    if (typeof importDoc.fps === 'number') setFps(importDoc.fps)
    setVideo(importDoc.video ?? [])
    setAudio(importDoc.audio ?? [])
    setText(importDoc.text ?? [])
    toast('Loaded your film into the Timeline editor — tweak anything and re-render.', 'info')
    // Clear the router state so navigating away and back can't re-import over live edits.
    navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave the whole project. When importing, skip the restore so the old saved timeline
  // doesn't asynchronously overwrite the freshly-imported film.
  const persisted = useMemo(() => ({ resKey, fps, video, audio, text }), [resKey, fps, video, audio, text])
  const saveStatus = useAutosave(
    'timeline-project',
    persisted,
    (v) => {
      if (v.resKey) setResKey(v.resKey)
      if (typeof v.fps === 'number') setFps(v.fps)
      if (Array.isArray(v.video)) setVideo(v.video)
      if (Array.isArray(v.audio)) setAudio(v.audio)
      if (Array.isArray(v.text)) setText(v.text)
    },
    { skipRestore: !!importDoc }
  )

  const total = totalDuration(video)
  /**
   * Stand-ins for scrubbing, keyed by the clip's REAL path.
   *
   * Deliberately a display-only overlay: `video` (the clip list the render reads) always
   * holds the master path, so a proxy can never end up in a finished video. Only what the
   * player and the waveform LOAD is swapped.
   */
  const [proxies, setProxies] = useState<Record<string, string>>({})
  const [proxyBusy, setProxyBusy] = useState<string | null>(null)

  async function makeProxy(src: string): Promise<void> {
    setProxyBusy(src)
    try {
      const res = await window.api.timelineProxy(src)
      if (res.ok) {
        setProxies((p) => ({ ...p, [src]: res.path }))
        toast(res.note, 'success')
      } else {
        toast(res.error, 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not make the stand-in', 'error')
    } finally {
      setProxyBusy(null)
    }
  }

  async function addClips(): Promise<void> {
    const paths = await window.api.timeline.pickClips()
    if (!paths.length) return
    const added: TimelineVideoClip[] = []
    for (const p of paths) {
      // Images have no intrinsic duration → default to 4s; videos probe their length.
      let dur = 4
      if (!isImage(p)) {
        const probe = await window.api.timeline.probe(p)
        if (probe.ok && probe.duration) dur = round2(probe.duration)
        else if (probe.error) toast(`Could not read ${baseName(p)}: ${probe.error}`, 'error')
      }
      added.push({ id: nid('v'), src: p, name: baseName(p), inSec: 0, outSec: dur, transitionSec: 0 })
    }
    setVideo((prev) => [...prev, ...added])
  }

  async function addAudio(): Promise<void> {
    const paths = await window.api.timeline.pickAudio()
    if (!paths.length) return
    const added: TimelineAudioClip[] = []
    for (const p of paths) {
      let dur = 30
      const probe = await window.api.timeline.probe(p)
      if (probe.ok && probe.duration) dur = round2(probe.duration)
      added.push({ id: nid('a'), src: p, name: baseName(p), inSec: 0, outSec: dur, atSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0 })
    }
    setAudio((prev) => [...prev, ...added])
  }

  function patchVideo(id: string, patch: Partial<TimelineVideoClip>): void {
    setVideo((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }
  function patchAudio(id: string, patch: Partial<TimelineAudioClip>): void {
    setAudio((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }
  function patchText(id: string, patch: Partial<TimelineTextOverlay>): void {
    setText((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  function move(id: string, dir: -1 | 1): void {
    setVideo((prev) => {
      const i = prev.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  async function removeVideo(id: string): Promise<void> {
    const ok = await confirmDialog({ title: 'Remove this clip?', message: 'Removes the clip from the timeline (your source file is not deleted).', confirmLabel: 'Remove', danger: true })
    if (ok) setVideo((prev) => prev.filter((c) => c.id !== id))
  }
  async function removeAudio(id: string): Promise<void> {
    const ok = await confirmDialog({ title: 'Remove this audio clip?', message: 'Removes it from the timeline (your source file is not deleted).', confirmLabel: 'Remove', danger: true })
    if (ok) setAudio((prev) => prev.filter((c) => c.id !== id))
  }
  function addText(): void {
    setText((prev) => [...prev, { id: nid('t'), text: 'New caption', startSec: 0, endSec: Math.min(3, total || 3), x: 'center', y: 'bottom', fadeSec: 0.3 }])
  }

  async function render(): Promise<void> {
    if (!video.length) { toast('Add at least one video/image clip first.', 'error'); return }
    const { w, h } = RES[resKey] ?? RES['1080p']
    const doc: TimelineDoc = { width: w, height: h, fps, video, audio, text }
    setBusy('Rendering timeline…'); setProgress(null); setRenderedPath(null)
    try {
      const res = await window.api.timeline.render(doc, 'Timeline edit')
      if (res.ok && res.video) {
        setRenderedPath(res.video.path)
        toast('Timeline rendered — also saved in Video Studio.', 'success')
      } else {
        toast(res.error ?? 'Render failed.', 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Render failed.', 'error')
    } finally {
      setBusy(null); setProgress(null)
    }
  }


  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif text-gold-400">
            Timeline Editor
            <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
          </h1>
          <p className="text-ink-400 text-sm mt-1">
            A real non-linear editor: trim, reorder and crossfade clips, layer audio with fades, and add
            timed text overlays. Total length: <span className="text-ink-200">{total.toFixed(2)}s</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl+Z)"
            className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
          >
            ↩
          </button>
          <button
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo (Ctrl+Y)"
            className="rounded-md border border-ink-700 px-2 py-1.5 text-sm text-ink-200 hover:border-gold-500 disabled:opacity-40"
          >
            ↪
          </button>
          <select value={resKey} onChange={(e) => setResKey(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200">
            {Object.keys(RES).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-200">
            {[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
          <button onClick={render} disabled={!!busy || !video.length} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950">
            🎬 Render
          </button>
        </div>
      </div>

      {busy && <div className="mt-3 text-sm text-gold-300">{busy}{progress ? ` — ${progress}` : ''}</div>}

      {/* VIDEO TRACK */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-200">Video track ({video.length})</h2>
          <button onClick={addClips} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">+ Add clips</button>
        </div>
        <TrackBar segments={video.map((c) => ({ id: c.id, label: c.name ?? baseName(c.src), len: vdur(c), overlap: Math.min(Math.max(c.transitionSec ?? 0, 0), vdur(c)) }))} total={total} />
        <div className="mt-2 space-y-2">
          {video.length === 0 && <div className="rounded-md border border-dashed border-ink-800 p-4 text-center text-xs text-ink-500">No clips yet — add video or image files to begin.</div>}
          {video.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-500 w-6">{i + 1}.</span>
                <span className="flex-1 truncate text-sm text-ink-200" title={c.src}>{c.name ?? baseName(c.src)} {isImage(c.src) && <span className="text-ink-500">(image)</span>}</span>
                <button onClick={() => move(c.id, -1)} disabled={i === 0} className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-30">↑</button>
                <button onClick={() => move(c.id, 1)} disabled={i === video.length - 1} className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 disabled:opacity-30">↓</button>
                {/* A stand-in for scrubbing a big clip. The render always uses the master —
                    only what the PLAYER loads is swapped. */}
                {!isImage(c.src) &&
                  (proxies[c.src] ? (
                    <span className="rounded border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300" title="Scrubbing a small stand-in. Your cuts land in exactly the same place, and the finished video is still made from the original.">
                      ✓ smooth scrubbing
                    </span>
                  ) : (
                    <button
                      onClick={() => void makeProxy(c.src)}
                      disabled={proxyBusy !== null}
                      title="Makes a small stand-in copy so scrubbing is smooth. It is the same length as the original, so your cuts land in exactly the same place — and the finished video is still made from the full-quality file."
                      className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-gold-500 disabled:opacity-40"
                    >
                      {proxyBusy === c.src ? 'Making…' : '⚡ Scrub smoothly'}
                    </button>
                  ))}
                <button onClick={() => void removeVideo(c.id)} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">Remove</button>
              </div>
              {proxies[c.src] && (
                <video src={`${fileUrl(proxies[c.src])}#t=${c.inSec}`} controls preload="metadata" className="mt-2 w-full rounded bg-black" />
              )}
              <div className="mt-2 grid grid-cols-3 gap-3">
                <NumField label="In (s)" value={c.inSec} min={0} onChange={(v) => patchVideo(c.id, { inSec: Math.min(v, c.outSec) })} />
                <NumField label="Out (s)" value={c.outSec} min={0} onChange={(v) => patchVideo(c.id, { outSec: Math.max(v, c.inSec) })} />
                {i > 0
                  ? <NumField label="Crossfade in (s)" value={c.transitionSec ?? 0} min={0} onChange={(v) => patchVideo(c.id, { transitionSec: Math.max(0, v) })} />
                  : <div className="text-[11px] text-ink-600 self-end pb-2">first clip — no transition</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* AUDIO TRACK */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-200">Audio track ({audio.length})</h2>
          <button onClick={addAudio} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">+ Add audio</button>
        </div>
        <div className="mt-2 space-y-2">
          {audio.map((c) => (
            <div key={c.id} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink-200" title={c.src}>{c.name ?? baseName(c.src)}</span>
                <Waveform src={c.src} />
                <button onClick={() => void removeAudio(c.id)} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">Remove</button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <NumField label="In (s)" value={c.inSec} min={0} onChange={(v) => patchAudio(c.id, { inSec: Math.min(v, c.outSec) })} />
                <NumField label="Out (s)" value={c.outSec} min={0} onChange={(v) => patchAudio(c.id, { outSec: Math.max(v, c.inSec) })} />
                <NumField label="At (s)" value={c.atSec} min={0} onChange={(v) => patchAudio(c.id, { atSec: Math.max(0, v) })} />
                <NumField label="Gain (0=mute,1=full)" value={c.gain ?? 1} min={0} step={0.05} onChange={(v) => patchAudio(c.id, { gain: Math.max(0, v) })} />
                <NumField label="Fade in (s)" value={c.fadeInSec ?? 0} min={0} onChange={(v) => patchAudio(c.id, { fadeInSec: Math.max(0, v) })} />
                <NumField label="Fade out (s)" value={c.fadeOutSec ?? 0} min={0} onChange={(v) => patchAudio(c.id, { fadeOutSec: Math.max(0, v) })} />
              </div>
            </div>
          ))}
          {audio.length === 0 && <div className="rounded-md border border-dashed border-ink-800 p-4 text-center text-xs text-ink-500">No audio — add music, narration or SFX (placed anywhere on the timeline).</div>}
        </div>
      </section>

      {/* TEXT OVERLAYS */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-200">Text overlays ({text.length})</h2>
          <button onClick={addText} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">+ Add text</button>
        </div>
        <div className="mt-2 space-y-2">
          {text.map((t) => (
            <div key={t.id} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
              <div className="flex items-center gap-2">
                <input value={t.text} onChange={(e) => patchText(t.id, { text: e.target.value })} className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100" />
                <button onClick={() => setText((prev) => prev.filter((x) => x.id !== t.id))} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-950/40">Remove</button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <NumField label="Start (s)" value={t.startSec} min={0} onChange={(v) => patchText(t.id, { startSec: Math.max(0, v) })} />
                <NumField label="End (s)" value={t.endSec} min={0} onChange={(v) => patchText(t.id, { endSec: Math.max(t.startSec, v) })} />
                <SelField label="X" value={t.x ?? 'center'} options={['left', 'center', 'right']} onChange={(v) => patchText(t.id, { x: v as TimelineTextOverlay['x'] })} />
                <SelField label="Y" value={t.y ?? 'bottom'} options={['top', 'middle', 'bottom']} onChange={(v) => patchText(t.id, { y: v as TimelineTextOverlay['y'] })} />
                <NumField label="Fade (s)" value={t.fadeSec ?? 0} min={0} step={0.1} onChange={(v) => patchText(t.id, { fadeSec: Math.max(0, v) })} />
                <NumField label="Font size (px, 0=auto)" value={t.fontSize ?? 0} min={0} onChange={(v) => patchText(t.id, { fontSize: Math.max(0, Math.round(v)) })} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {renderedPath && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-ink-200">Rendered result</h2>
          <video src={fileUrl(renderedPath)} controls className="mt-2 w-full max-w-2xl rounded-md bg-black" />
          <div className="mt-2">
            <button onClick={() => void window.api.video.reveal(renderedPath)} className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700">Show file</button>
          </div>
        </section>
      )}
    </div>
  )
}

/** A proportional bar showing each clip's share of the timeline; crossfades overlap. */
function TrackBar({ segments, total }: { segments: { id: string; label: string; len: number; overlap: number }[]; total: number }): React.JSX.Element {
  if (!segments.length || total <= 0) return <div className="mt-2 h-8 rounded-md bg-ink-950 border border-ink-800" />
  const palette = ['bg-gold-600/70', 'bg-emerald-700/70', 'bg-sky-700/70', 'bg-fuchsia-700/70', 'bg-amber-700/70']
  return (
    <div className="mt-2 flex h-8 overflow-hidden rounded-md border border-ink-800 bg-ink-950">
      {segments.map((s, i) => {
        // A clip's own contribution to the total = its length minus the crossfade it shares with the previous clip.
        const contrib = Math.max(0, s.len - (i > 0 ? s.overlap : 0))
        const pct = (contrib / total) * 100
        return (
          <div key={s.id} className={`flex items-center justify-center text-[10px] text-white/90 ${palette[i % palette.length]} border-r border-ink-950`} style={{ width: `${pct}%` }} title={`${s.label} · ${s.len.toFixed(2)}s`}>
            <span className="truncate px-1">{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function NumField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }): React.JSX.Element {
  return (
    <label className="block">
      <span className="block text-[11px] text-ink-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step={step ?? 0.1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
      />
    </label>
  )
}

function SelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <label className="block">
      <span className="block text-[11px] text-ink-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

/**
 * Renders a compact waveform of an audio file using the Web Audio API entirely in
 * the renderer (no backend needed). Fails silently to a flat line if decoding fails.
 */
function Waveform({ src }: { src: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // fetch() cannot read the file: scheme, so on the DESKTOP every waveform
        // silently rendered blank. Reading the bytes over the api bridge works on
        // both surfaces — Electron IPC on the PC, the HTTP bridge on the phone.
        const bytes = await window.api.audio.readFile(src)
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        const audioBuf = await ctx.decodeAudioData(buf)
        void ctx.close()
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const g = canvas.getContext('2d')
        if (!g) return
        const data = audioBuf.getChannelData(0)
        const W = canvas.width, H = canvas.height, mid = H / 2
        const step = Math.max(1, Math.floor(data.length / W))
        g.clearRect(0, 0, W, H)
        g.strokeStyle = '#b6892f'
        g.beginPath()
        for (let x = 0; x < W; x++) {
          let peak = 0
          for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(data[x * step + j] || 0))
          g.moveTo(x + 0.5, mid - peak * mid)
          g.lineTo(x + 0.5, mid + peak * mid)
        }
        g.stroke()
      } catch {
        /* decoding not supported for this file — leave the canvas blank */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src])
  return <canvas ref={canvasRef} width={160} height={28} className="rounded bg-ink-950 border border-ink-800" title="waveform" />
}
