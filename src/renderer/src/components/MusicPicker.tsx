import { useEffect, useRef, useState } from 'react'
import type { MusicSuggestion, MusicTrack } from '../../../shared/types'

/**
 * The in-place music picker: mood-matched suggestions the AI derived from the script,
 * one tap to preview, one tap to use. Deliberately a small inline panel rather than a
 * separate screen — choosing a backing track should not lose your place in the edit.
 */
export default function MusicPicker({
  scriptText,
  current,
  onChoose,
  onClose
}: {
  scriptText: string
  current: MusicTrack | null
  onChoose: (t: MusicTrack) => void
  onClose: () => void
}): React.JSX.Element {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<MusicSuggestion | null>(null)
  const [query, setQuery] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Set the moment the user runs their OWN mood search: a slow mount-time suggest()
  // resolving late must never overwrite the results the user searched for.
  const userSearchedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.api.music
      .suggest(scriptText)
      .then((r) => {
        if (!cancelled && !userSearchedRef.current) setResult(r)
      })
      .catch(() => {
        if (!cancelled && !userSearchedRef.current) setResult({ moods: [], tracks: [], note: 'Could not reach the free music services.' })
      })
      .finally(() => {
        if (!cancelled && !userSearchedRef.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scriptText])

  // Stop any preview when the panel closes, so audio never keeps playing invisibly.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  async function runSearch(): Promise<void> {
    if (!query.trim()) return
    userSearchedRef.current = true
    setLoading(true)
    try {
      setResult(await window.api.music.moodSearch(query.trim()))
    } catch {
      setResult({ moods: [], tracks: [], note: 'Could not reach the free music services.' })
    } finally {
      setLoading(false)
    }
  }

  function preview(t: MusicTrack): void {
    if (playingId === t.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = t.url
      void audioRef.current.play().catch(() => setPlayingId(null))
      setPlayingId(t.id)
    }
  }

  return (
    <div className="mt-2 rounded-md border border-emerald-600/40 bg-ink-900 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-emerald-300 font-medium">♪ Choose background music — free &amp; copyright-safe</span>
        <button onClick={onClose} className="text-[11px] text-ink-500 hover:text-ink-200">
          Close
        </button>
      </div>

      {result?.moods.length ? (
        <div className="text-[10px] text-ink-500">
          Mood picked from your script: <span className="text-gold-300">{result.moods.join(', ')}</span>
          {result.synthMood ? (
            <span className="text-ink-600"> · the built-in music maker would play this as “{result.synthMood}”</span>
          ) : null}
        </div>
      ) : null}

      {result?.libraryLinks?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-500">
          Browse this vibe on the free libraries:
          {result.libraryLinks.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-ink-700 px-1.5 py-0.5 text-ink-300 hover:border-gold-500 hover:text-gold-300"
            >
              {l.name} ↗
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
          placeholder="Or search a mood: lo-fi, dramatic, hopeful…"
          className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-2 py-1 text-xs text-ink-100 outline-none focus:border-gold-500"
        />
        <button
          onClick={() => void runSearch()}
          disabled={loading}
          className="rounded-md border border-ink-600 px-2 py-1 text-xs text-ink-300 hover:border-gold-500 disabled:opacity-40"
        >
          Search
        </button>
      </div>

      {loading && <div className="text-[11px] text-ink-400">Finding music…</div>}

      {!loading && result && result.tracks.length === 0 && (
        <div className="text-[11px] text-amber-300">
          {result.note || 'No free music found. Your video will simply be built without music.'}
        </div>
      )}

      <div className="space-y-1 max-h-56 overflow-y-auto">
        {result?.tracks.map((t) => (
          <div
            key={`${t.source}-${t.id}`}
            className={`flex items-center gap-2 rounded-md border p-2 ${
              current?.url === t.url ? 'border-emerald-500 bg-emerald-500/10' : 'border-ink-800 bg-ink-950'
            }`}
          >
            <button
              onClick={() => preview(t)}
              className="rounded-full border border-ink-600 w-7 h-7 text-xs text-ink-200 hover:border-gold-500 shrink-0"
              title="Preview"
            >
              {playingId === t.id ? '⏸' : '▶'}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink-200">{t.title}</div>
              <div className="truncate text-[10px] text-ink-500">
                {t.tags}
                {t.durationSec ? ` · ${Math.round(t.durationSec)}s` : ''}
                <span className={t.needsAttribution ? ' text-amber-400' : ' text-emerald-400'}>
                  {t.needsAttribution ? ` · ${t.license} (credit needed)` : ` · ${t.license} (no credit needed)`}
                </span>
              </div>
            </div>
            <button
              onClick={() => onChoose(t)}
              className="shrink-0 rounded-md bg-gold-500 px-2.5 py-1 text-[11px] font-medium text-ink-950 hover:bg-gold-400"
            >
              {current?.url === t.url ? 'In use' : 'Use'}
            </button>
          </div>
        ))}
      </div>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
    </div>
  )
}
