import { useRef, useState } from 'react'
import type { MusicTrack } from '../../../shared/types'
import { mmss } from './TrimTimeline'

export interface MusicRegion {
  startSec: number
  endSec: number
  track: MusicTrack | null
}

/**
 * The music lane that sits under the video's trim bar: a coloured region showing where
 * music plays, draggable to reposition, with the track picker opening in place rather
 * than on another screen.
 */
export default function MusicTrackBar({
  duration,
  region,
  onChange,
  onPick,
  busy
}: {
  duration: number
  region: MusicRegion | null
  onChange: (r: MusicRegion | null) => void
  /** Opens the in-place picker for this region. */
  onPick: () => void
  busy?: boolean
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<'move' | 'start' | 'end' | 'new' | null>(null)
  const dragFrom = useRef(0)
  const original = useRef<MusicRegion | null>(null)

  const pct = (sec: number): number => (duration > 0 ? Math.min(100, Math.max(0, (sec / duration) * 100)) : 0)

  function secAt(clientX: number): number {
    const el = trackRef.current
    if (!el || duration <= 0) return 0
    const box = el.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - box.left) / box.width) * duration))
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (duration <= 0 || busy) return
    const sec = secAt(e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!region) {
      // Dragging across empty space is how a new music region is created.
      dragFrom.current = sec
      setDrag('new')
      onChange({ startSec: sec, endSec: sec, track: null })
      return
    }
    if (sec >= region.startSec && sec <= region.endSec) {
      dragFrom.current = sec
      original.current = region
      setDrag('move')
      return
    }
    dragFrom.current = sec
    setDrag('new')
    onChange({ startSec: sec, endSec: sec, track: region.track })
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!drag || !region) return
    const sec = secAt(e.clientX)
    if (drag === 'new') {
      onChange({ ...region, startSec: Math.min(dragFrom.current, sec), endSec: Math.max(dragFrom.current, sec) })
    } else if (drag === 'move' && original.current) {
      const span = original.current.endSec - original.current.startSec
      // Keep the whole region on the timeline instead of letting it slide off an edge.
      const start = Math.min(Math.max(0, original.current.startSec + (sec - dragFrom.current)), duration - span)
      onChange({ ...region, startSec: start, endSec: start + span })
    } else if (drag === 'start') {
      onChange({ ...region, startSec: Math.min(sec, region.endSec - 0.5) })
    } else if (drag === 'end') {
      onChange({ ...region, endSec: Math.max(sec, region.startSec + 0.5) })
    }
  }

  function endDrag(e: React.PointerEvent): void {
    if (!drag) return
    const wasNew = drag === 'new'
    const wasMove = drag === 'move'
    setDrag(null)
    original.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!region) return
    // A tap rather than a drag means "put music here" — open the picker with a sensible
    // default span instead of leaving a zero-length region behind.
    if (wasNew && region.endSec - region.startSec < 0.4) {
      const end = Math.min(duration, region.startSec + Math.min(30, duration))
      onChange({ ...region, endSec: end })
      if (!region.track) onPick()
    }
    // Tapping INSIDE an existing trackless region must honour its own label
    // ("Tap to choose a track…") — it used to start a 'move' drag that, on a
    // plain tap, did nothing at all.
    if (wasMove && !region.track && Math.abs(secAt(e.clientX) - dragFrom.current) < 0.2) {
      onPick()
    }
  }

  function grab(which: 'start' | 'end') {
    return (e: React.PointerEvent): void => {
      e.stopPropagation()
      setDrag(which)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-ink-400">🎵 Music track</span>
        {region && (
          <button
            onClick={() => onChange(null)}
            disabled={busy}
            className="text-[10px] text-ink-500 hover:text-red-300 disabled:opacity-40"
          >
            Remove music
          </button>
        )}
      </div>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-9 w-full cursor-pointer rounded-md border border-ink-700 bg-ink-950 touch-none overflow-hidden"
      >
        {!region && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-600 pointer-events-none">
            Tap to add music here, or drag to choose a stretch
          </div>
        )}
        {region && (
          <div
            className="absolute inset-y-0 flex items-center border-x-2 border-emerald-400 bg-emerald-500/25"
            style={{ left: `${pct(region.startSec)}%`, width: `${Math.max(0, pct(region.endSec) - pct(region.startSec))}%` }}
          >
            <span className="truncate px-2 text-[10px] text-emerald-100 pointer-events-none">
              {region.track ? region.track.title : 'Tap to choose a track…'}
            </span>
            <div onPointerDown={grab('start')} className="absolute inset-y-0 left-0 -ml-1.5 w-3 cursor-ew-resize touch-none" />
            <div onPointerDown={grab('end')} className="absolute inset-y-0 right-0 -mr-1.5 w-3 cursor-ew-resize touch-none" />
          </div>
        )}
      </div>
      {region && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="text-ink-500 tabular-nums">
            {mmss(region.startSec)} → {mmss(region.endSec)}
          </span>
          <button
            onClick={onPick}
            disabled={busy}
            className="rounded border border-ink-600 px-2 py-1 text-ink-300 hover:border-gold-500 disabled:opacity-40"
          >
            {region.track ? '↔ Swap track' : '♪ Choose a track'}
          </button>
          {region.track && (
            <span className={region.track.needsAttribution ? 'text-amber-400' : 'text-emerald-400'}>
              {region.track.needsAttribution
                ? `${region.track.license} — credit the artist in your description`
                : `${region.track.license} — no credit needed`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
