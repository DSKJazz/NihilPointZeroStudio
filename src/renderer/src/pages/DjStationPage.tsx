import { useEffect, useRef, useState } from 'react'
import { useAutosave } from '../hooks/useAutosave'
import DualDecks from '../components/DualDecks'
import {
  MOODS,
  SFX_KINDS,
  type AudioClip,
  type FreeTrack,
  type Mood,
  type MusicSearchResult,
  type SfxKind,
  type VideoJob
} from '../../../shared/types'

import { fileUrl } from '../../../shared/mediaUrl'

interface PackItem {
  id: string
  kind: 'music' | 'sfx'
  label: string
  file: string
}

/** A previewable/placeable sound. `resolve` returns an absolute file path (cached). */
interface SoundSource {
  key: string
  label: string
  group: string
  resolve: () => Promise<string>
}

// Random-suffix ids: a plain counter reset to 0 on every app start while the
// autosaved timeline still holds clip-0, clip-1… — so the first sound added
// after a restart collided with an existing clip and edits hit the wrong one.
function newClipId(): string {
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export default function DjStationPage({
  embedded = false,
  deckFile
}: { embedded?: boolean; deckFile?: { path: string; name: string } } = {}): React.JSX.Element {
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [pack, setPack] = useState<PackItem[]>([])
  const [userFiles, setUserFiles] = useState<{ label: string; file: string }[]>([])
  const [clips, setClips] = useState<AudioClip[]>([])
  const [selectedVideoId, setSelectedVideoId] = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState<MusicSearchResult | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [mixDur, setMixDur] = useState(30)
  const [rendering, setRendering] = useState(false)
  const [mixPath, setMixPath] = useState<string | null>(null)
  const [mixUrl, setMixUrl] = useState<string | null>(null)
  const [waveUrl, setWaveUrl] = useState<string | null>(null)
  const [waveBusy, setWaveBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cache = useRef<Record<string, string>>({})

  // Persist the DJ timeline across close/restart (it was in-memory only before, so a
  // built mix was lost on restart). `clips` is a stable state array → no save-loop.
  useAutosave('dj-timeline', clips, (v) => {
    if (Array.isArray(v) && v.length) setClips(v)
  })

  async function runSearch(): Promise<void> {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      setSearch(await window.api.music.search(query.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function downloadTrack(track: FreeTrack): Promise<void> {
    if (!track.audioUrl) return
    setDownloadingId(track.id)
    setError(null)
    try {
      const path = await window.api.music.download(track.audioUrl, track.title)
      setUserFiles((u) => [...u, { label: `${track.title} (downloaded)`, file: path }])
      setNote(`Added “${track.title}” to your library below — license: ${track.license || 'see source'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  useEffect(() => {
    void (async () => {
      const [vids, packList] = await Promise.all([window.api.video.list(), window.api.audio.listPack()])
      setJobs(vids as VideoJob[])
      setPack(packList as PackItem[])
      if ((vids as VideoJob[])[0]) setSelectedVideoId((vids as VideoJob[])[0].id)
    })()
  }, [])

  // Build the library of sound sources from generators + bundled pack + user files.
  const sources: SoundSource[] = [
    ...MOODS.map((mood: Mood) => ({
      key: `music-${mood}`,
      label: `${mood} bed`,
      group: 'Generated music',
      resolve: () => window.api.audio.generateMusic(mood, 24, 1)
    })),
    ...SFX_KINDS.map((kind: SfxKind) => ({
      key: `sfx-${kind}`,
      label: kind,
      group: 'Generated SFX',
      resolve: () => window.api.audio.generateSfx(kind)
    })),
    ...pack.map((p) => ({
      key: `pack-${p.id}`,
      label: `${p.label} (pack)`,
      group: 'Bundled pack',
      resolve: async () => p.file
    })),
    ...userFiles.map((u, i) => ({
      key: `user-${i}-${u.label}`,
      label: u.label,
      group: 'Your files',
      resolve: async () => u.file
    }))
  ]

  async function resolveCached(src: SoundSource): Promise<string> {
    if (cache.current[src.key]) return cache.current[src.key]
    const path = await src.resolve()
    cache.current[src.key] = path
    return path
  }

  async function preview(src: SoundSource): Promise<void> {
    setError(null)
    setBusyKey(src.key)
    try {
      const path = await resolveCached(src)
      setPreviewKey(src.key)
      setPreviewUrl(fileUrl(path))
      // Let the <audio> element pick up the new src, then play.
      setTimeout(() => void audioRef.current?.play().catch(() => undefined), 60)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate that sound')
    } finally {
      setBusyKey(null)
    }
  }

  async function addToTimeline(src: SoundSource): Promise<void> {
    setError(null)
    setBusyKey(src.key)
    try {
      const path = await resolveCached(src)
      const clip: AudioClip = {
        id: newClipId(),
        src: path,
        label: src.label,
        atSec: 0,
        gain: src.group === 'Generated music' || src.group === 'Bundled pack' ? 0.25 : 0.8,
        fadeIn: src.group.includes('music') ? 1 : 0,
        fadeOut: src.group.includes('music') ? 1.5 : 0
      }
      setClips((c) => [...c, clip])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that sound')
    } finally {
      setBusyKey(null)
    }
  }

  function updateClip(id: string, patch: Partial<AudioClip>): void {
    setClips((c) => c.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)))
  }
  function removeClip(id: string): void {
    setClips((c) => c.filter((clip) => clip.id !== id))
  }

  async function addUserFile(): Promise<void> {
    const path = await window.api.audio.pickFile()
    if (!path) return
    const label = path.split(/[\\/]/).pop() || 'audio'
    setUserFiles((u) => [...u, { label, file: path }])
  }

  async function renderStandalone(): Promise<void> {
    if (!clips.length) return
    setRendering(true)
    setError(null)
    setNote(null)
    try {
      const path = await window.api.audio.renderMix(clips, mixDur)
      setMixPath(path)
      setMixUrl(`${fileUrl(path)}?t=${Date.now()}`)
      setNote('Music rendered — preview below, then Save to download it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Render failed')
    } finally {
      setRendering(false)
    }
  }

  async function saveMix(): Promise<void> {
    if (!mixPath) return
    const res = await window.api.audio.saveFile(mixPath, 'my-music.mp3')
    if (res.saved) setNote(`Saved to ${res.path}`)
  }

  async function showWaveform(): Promise<void> {
    if (!selectedVideoId) return
    setWaveBusy(true)
    setError(null)
    try {
      const p = await window.api.audio.waveform(selectedVideoId)
      setWaveUrl(`${fileUrl(p)}?t=${Date.now()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not render waveform')
    } finally {
      setWaveBusy(false)
    }
  }

  async function applyMix(): Promise<void> {
    if (!selectedVideoId || !clips.length) return
    setApplying(true)
    setError(null)
    setNote(null)
    try {
      const job = await window.api.audio.remix(selectedVideoId, clips)
      setNote(`Created “${job.title}”. Find it under the “Build & Videos” tab.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mixing failed')
    } finally {
      setApplying(false)
    }
  }

  const groups = ['Generated music', 'Generated SFX', 'Bundled pack', 'Your files']

  return (
    <div className={embedded ? '' : 'max-w-6xl mx-auto p-8'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-serif text-ink-100">DJ Station</h1>
          <p className="text-ink-400 text-sm mt-1">
            Listen to built-in music &amp; sound effects, place them on a timeline, then mix them onto any built video.
            Everything here is generated on your machine — free and offline.
          </p>
        </div>
      )}

      {/* Live two-deck mixing — separate from the timeline below: decks are for
          performing/practicing by ear; the timeline is for placing sounds onto videos. */}
      <details open={!!deckFile} className={`${embedded ? '' : 'mt-6 '}rounded-lg border border-ink-800 bg-ink-950`}>
        <summary className="cursor-pointer px-3 py-2 text-sm text-gold-400 select-none">
          🎛 Dual decks — mix two tracks live (EQ · loops · hot cues · crossfader · BPM)
        </summary>
        <div className="p-2">
          <DualDecks initialFile={deckFile} />
        </div>
      </details>

      {/* Errors surface ABOVE both columns: they used to render only at the very
          bottom of the right-hand column, so a failed Listen/＋Timeline click in
          the left column gave no visible feedback at all. */}
      {error && (
        <div className={`${embedded ? '' : 'mt-4 '}rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300`}>
          {error}
        </div>
      )}

      <div className={`${embedded ? '' : 'mt-6 '}grid grid-cols-1 lg:grid-cols-2 gap-6`}>
        {/* Library */}
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-ink-100">Sound library</h2>
            <button
              onClick={addUserFile}
              className="rounded-md border border-ink-600 hover:border-gold-500 text-ink-200 text-xs px-3 py-1.5 transition-colors"
            >
              ＋ Add your own audio
            </button>
          </div>

          {/* Online free-music search (Creative Commons). Degrades gracefully offline. */}
          <details className="rounded-md border border-ink-700 bg-ink-800/60">
            <summary className="cursor-pointer px-3 py-1.5 text-xs text-gold-400 select-none">
              🔎 Find free music online (Creative Commons)
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-2">
              <div className="flex gap-1.5">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  placeholder="e.g. calm piano, epic cinematic, lofi…"
                  className="flex-1 rounded-md bg-ink-900 border border-ink-700 px-3 py-1.5 text-xs text-ink-100 outline-none focus:border-gold-500"
                />
                <button
                  onClick={runSearch}
                  disabled={searching || !query.trim()}
                  className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5"
                >
                  {searching ? '…' : 'Search'}
                </button>
              </div>
              {search && !search.online && (
                <p className="text-[11px] text-amber-400/90">
                  Online music unavailable (you seem to be offline). No problem — use the built-in generated sounds and
                  bundled pack below; they work fully offline.
                </p>
              )}
              {search && search.online && search.tracks.length === 0 && (
                <p className="text-[11px] text-ink-500">No matches — try different words.</p>
              )}
              {search && search.online && search.tracks.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {search.tracks.map((t) => (
                    <div key={t.id} className="rounded-md border border-ink-700 bg-ink-900 p-2">
                      <div className="text-xs text-ink-100 truncate">{t.title}</div>
                      <div className="text-[10px] text-ink-500 truncate">
                        {t.artist} · {t.license || 'CC'}
                        {t.durationSec ? ` · ${t.durationSec}s` : ''}
                      </div>
                      {t.audioUrl && <audio src={t.audioUrl} controls preload="none" className="w-full mt-1 h-8" />}
                      <div className="flex gap-1.5 mt-1">
                        <button
                          onClick={() => downloadTrack(t)}
                          disabled={!t.audioUrl || downloadingId === t.id}
                          className="rounded border border-gold-500/60 hover:border-gold-400 text-gold-300 text-[10px] px-2 py-1 disabled:opacity-40"
                        >
                          {downloadingId === t.id ? 'Downloading…' : '⬇ Use this (add to library)'}
                        </button>
                        {t.landingUrl && (
                          <button
                            onClick={() => window.open(t.landingUrl, '_blank')}
                            className="rounded border border-ink-600 hover:border-ink-400 text-ink-300 text-[10px] px-2 py-1"
                          >
                            Source ↗
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-ink-600 pt-1">
                    Downloaded tracks appear under “Your files” below — preview, slice, and place them like any sound.
                    Always keep the license/credit shown here.
                  </p>
                </div>
              )}
            </div>
          </details>

          {groups.map((group) => {
            const items = sources.filter((s) => s.group === group)
            if (!items.length) return null
            return (
              <div key={group}>
                <div className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">{group}</div>
                <div className="space-y-1">
                  {items.map((src) => (
                    <div
                      key={src.key}
                      className="flex items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5"
                    >
                      <span className="text-sm text-ink-100 capitalize truncate">{src.label}</span>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => preview(src)}
                          disabled={busyKey === src.key}
                          className="rounded border border-ink-600 hover:border-ink-400 text-ink-200 text-[11px] px-2 py-1 disabled:opacity-50"
                        >
                          {busyKey === src.key ? '…' : previewKey === src.key ? '▶ Again' : '▶ Listen'}
                        </button>
                        <button
                          onClick={() => addToTimeline(src)}
                          disabled={busyKey === src.key}
                          className="rounded border border-gold-500/60 hover:border-gold-400 text-gold-300 text-[11px] px-2 py-1 disabled:opacity-50"
                        >
                          ＋ Timeline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {previewUrl && (
            <div className="pt-1">
              <div className="text-[11px] text-ink-500 mb-1">Preview</div>
              <audio ref={audioRef} src={previewUrl} controls className="w-full" />
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
          <h2 className="text-lg font-medium text-ink-100">Timeline ({clips.length})</h2>
          {clips.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-700 py-8 px-4 text-center text-ink-500 text-sm">
              Add sounds from the library. For each one, set when it starts, how loud, and (optionally) which slice of
              the file to use.
            </div>
          ) : (
            <div className="space-y-2">
              {clips.map((clip) => (
                <div key={clip.id} className="rounded-md border border-ink-700 bg-ink-800 p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-100 capitalize truncate">{clip.label}</span>
                    <button
                      onClick={() => removeClip(clip.id)}
                      className="text-[11px] text-ink-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <label className="text-[10px] text-ink-400">
                      Start at (s)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={clip.atSec}
                        onChange={(e) => updateClip(clip.id, { atSec: parseFloat(e.target.value) || 0 })}
                        className="mt-0.5 w-full rounded bg-ink-900 border border-ink-700 px-1.5 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                      />
                    </label>
                    <label className="text-[10px] text-ink-400">
                      Volume
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.05}
                        value={clip.gain}
                        onChange={(e) => updateClip(clip.id, { gain: parseFloat(e.target.value) || 0 })}
                        className="mt-0.5 w-full rounded bg-ink-900 border border-ink-700 px-1.5 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                      />
                    </label>
                    <label className="text-[10px] text-ink-400">
                      Use from (s)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={clip.startSec ?? ''}
                        placeholder="whole"
                        onChange={(e) =>
                          updateClip(clip.id, {
                            startSec: e.target.value === '' ? undefined : parseFloat(e.target.value)
                          })
                        }
                        className="mt-0.5 w-full rounded bg-ink-900 border border-ink-700 px-1.5 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                      />
                    </label>
                    <label className="text-[10px] text-ink-400">
                      Use to (s)
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={clip.endSec ?? ''}
                        placeholder="end"
                        onChange={(e) =>
                          updateClip(clip.id, {
                            endSec: e.target.value === '' ? undefined : parseFloat(e.target.value)
                          })
                        }
                        className="mt-0.5 w-full rounded bg-ink-900 border border-ink-700 px-1.5 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-ink-700 pt-3 space-y-2">
            <label className="text-xs text-ink-400 block">🎵 Create music only (export as an audio file)</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-ink-400 flex items-center gap-1">
                Length (s)
                <input
                  type="number"
                  min={1}
                  step={5}
                  value={mixDur}
                  onChange={(e) => setMixDur(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="w-20 rounded bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
                />
              </label>
              <button
                onClick={renderStandalone}
                disabled={rendering || !clips.length}
                className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5"
              >
                {rendering ? 'Rendering…' : '🎧 Render music'}
              </button>
              {mixUrl && (
                <button onClick={saveMix} className="rounded-md border border-gold-500/60 hover:border-gold-400 text-gold-300 text-xs px-3 py-1.5">
                  ⬇ Save / download
                </button>
              )}
            </div>
            {mixUrl && <audio src={mixUrl} controls className="w-full" />}
            <p className="text-[10px] text-ink-600">
              Layers your timeline sounds into one track (no video needed) — make a song, a loop, or a background bed,
              then save it as MP3. Use the same timeline to lay it over a video below instead.
            </p>
          </div>

          <div className="border-t border-ink-700 pt-3 space-y-2">
            <label className="text-xs text-ink-400 block">Apply the mix onto this video (over/under narration)</label>
            {jobs.length ? (
              <select
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                className="w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-ink-500">
                No built videos yet. Build one under the “Build & Videos” tab, then come back to mix sounds onto it.
              </p>
            )}
            {selectedVideoId && jobs.find((j) => j.id === selectedVideoId) && (
              <video
                key={selectedVideoId}
                src={fileUrl(jobs.find((j) => j.id === selectedVideoId)!.path)}
                controls
                preload="metadata"
                className="w-full max-h-56 rounded-md bg-black"
              />
            )}
            {selectedVideoId && (
              <div>
                <button
                  onClick={showWaveform}
                  disabled={waveBusy}
                  className="rounded-md border border-ink-600 hover:border-gold-500 text-ink-300 text-[11px] px-3 py-1 disabled:opacity-50"
                >
                  {waveBusy ? 'Rendering…' : '📊 Show waveform'}
                </button>
                {waveUrl && <img src={waveUrl} alt="waveform" className="mt-1 w-full rounded bg-ink-950" />}
              </div>
            )}
            <button
              onClick={applyMix}
              disabled={applying || !clips.length || !selectedVideoId}
              className="w-full rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
            >
              {applying ? 'Mixing…' : '🎚 Apply mix → new video'}
            </button>
            <p className="text-[10px] text-ink-600">
              Your sounds are layered over the video’s existing narration. A new video is created — the original is kept.
            </p>
            {note && <p className="text-[11px] text-emerald-400">{note}</p>}
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
