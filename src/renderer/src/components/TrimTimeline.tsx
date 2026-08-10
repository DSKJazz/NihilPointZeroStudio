import { useRef, useState } from 'react'

export function mmss(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}

/** Smallest range the cutter accepts; keeps handles from crossing into nonsense. */
const MIN_SPAN = 0.05

type Drag = 'start' | 'end' | null

/**
 * Touch-friendly trim bar: tap the track to move the nearest marker, or drag a marker.
 * Built for finger-sized targets rather than the numeric time boxes it replaces —
 * typing "12.4" into a spinner is not how anyone trims a video on a touchscreen.
 *
 * Pointer events (not mouse events) so pen, finger and mouse all work from one path.
 */
export default function TrimTimeline({
  duration,
  start,
  end,
  playhead,
  mode,
  onChange,
  onSeek
}: {
  duration: number
  start: number
  end: number
  /** Current player position, drawn as a thin marker. */
  playhead?: number
  /** 'remove' shades the selection red (it's going away); 'keep' shades it gold. */
  mode: 'remove' | 'keep'
  onChange: (start: number, end: number) => void
  onSeek?: (sec: number) => void
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<Drag>(null)

  const pct = (sec: number): number => (duration > 0 ? Math.min(100, Math.max(0, (sec / duration) * 100)) : 0)

  function secAt(clientX: number): number {
    const el = trackRef.current
    if (!el || duration <= 0) return 0
    const box = el.getBoundingClientRect()
    const ratio = (clientX - box.left) / box.width
    return Math.min(duration, Math.max(0, ratio * duration))
  }

  function moveMarker(which: Exclude<Drag, null>, sec: number): void {
    // Clamp to the video itself: the keyboard path can push values past either end,
    // where the handle sits frozen at the edge while the real numbers keep drifting
    // (and disagree with the times shown on screen).
    const snapped = Math.min(duration, Math.max(0, Math.round(sec * 100) / 100))
    if (which === 'start') onChange(Math.min(snapped, end - MIN_SPAN), end)
    else onChange(start, Math.max(snapped, start + MIN_SPAN))
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (duration <= 0) return
    const sec = secAt(e.clientX)
    // Tapping the track grabs whichever marker is closer, so one tap both selects and
    // positions — no separate "which end am I setting?" step.
    const which: Exclude<Drag, null> = Math.abs(sec - start) <= Math.abs(sec - end) ? 'start' : 'end'
    setDrag(which)
    moveMarker(which, sec)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!drag) return
    moveMarker(drag, secAt(e.clientX))
  }

  function endDrag(e: React.PointerEvent): void {
    if (!drag) return
    setDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  function grabHandle(which: Exclude<Drag, null>) {
    return (e: React.PointerEvent): void => {
      e.stopPropagation()
      setDrag(which)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const selLeft = pct(start)
  const selWidth = Math.max(0, pct(end) - pct(start))
  const selColor = mode === 'remove' ? 'bg-red-500/30 border-red-400' : 'bg-gold-500/30 border-gold-400'

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-12 w-full cursor-pointer rounded-md border border-ink-700 bg-ink-950 touch-none"
      >
        <div className={`absolute inset-y-0 border-x-2 ${selColor}`} style={{ left: `${selLeft}%`, width: `${selWidth}%` }} />
        {playhead !== undefined && duration > 0 && (
          <div className="absolute inset-y-0 w-px bg-ink-200/70" style={{ left: `${pct(playhead)}%` }} />
        )}
        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            onPointerDown={grabHandle(which)}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="slider"
            aria-label={which === 'start' ? 'Start of section' : 'End of section'}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={which === 'start' ? start : end}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 1 : 0.1
              if (e.key === 'ArrowLeft') moveMarker(which, (which === 'start' ? start : end) - step)
              else if (e.key === 'ArrowRight') moveMarker(which, (which === 'start' ? start : end) + step)
              else return
              e.preventDefault()
            }}
            style={{ left: `${pct(which === 'start' ? start : end)}%` }}
            className={`absolute inset-y-0 -ml-3 w-6 cursor-ew-resize touch-none ${drag === which ? 'z-20' : 'z-10'}`}
          >
            <div className="mx-auto h-full w-1.5 rounded-full bg-gold-400 shadow" />
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-500">
        <span>0:00.0</span>
        <span className="text-gold-300 tabular-nums">
          {mmss(start)} → {mmss(end)} ({(end - start).toFixed(1)}s)
        </span>
        <span>{mmss(duration)}</span>
      </div>
      {onSeek && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            onClick={() => onSeek(start)}
            className="rounded border border-ink-600 px-2 py-1 text-[10px] text-ink-300 hover:border-gold-500"
          >
            ▶ Jump to start
          </button>
          <button
            onClick={() => onSeek(end)}
            className="rounded border border-ink-600 px-2 py-1 text-[10px] text-ink-300 hover:border-gold-500"
          >
            ▶ Jump to end
          </button>
        </div>
      )}
    </div>
  )
}
