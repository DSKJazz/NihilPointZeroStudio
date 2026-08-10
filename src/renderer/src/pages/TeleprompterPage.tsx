import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_WPM,
  MAX_WPM,
  MIN_WPM,
  clampWpm,
  countSpokenWords,
  formatClock,
  readingSeconds,
  scrollPixelsPerSecond,
  suggestWpm,
  toPrompterLines
} from '../../../shared/teleprompter'

/**
 * The teleprompter.
 *
 * Design decisions that matter for it being usable on a real take:
 *
 * • A FIXED READING LINE with the script scrolling past it. Your eyes stay at one
 *   height, which is the single thing that makes you look like you are talking to the
 *   camera rather than reading a screen.
 * • Speed in WORDS PER MINUTE, not an arbitrary 1-10 slider, and it can be set from
 *   the script's own length so a run matches the timings the storyboard was planned
 *   with. 150 wpm is what the rest of the studio already assumes.
 * • Stage directions ([PATTERN INTERRUPT] and friends) are shown dimmed and are NOT
 *   counted in the timing — they are instructions to you, not words to say. Count them
 *   and every script finishes early.
 * • Keyboard only: space pauses, arrows nudge speed, so you never touch the mouse
 *   mid-take.
 * • It scrolls on a real clock (elapsed time), not by adding a fixed amount per frame.
 *   Frame-rate-based scrolling drifts, and a prompter that drifts is a prompter that
 *   lies about how long the read will take.
 */
export default function TeleprompterPage(): React.JSX.Element {
  const [script, setScript] = useState('')
  const [wpm, setWpm] = useState(DEFAULT_WPM)
  const [fontSize, setFontSize] = useState(44)
  const [mirror, setMirror] = useState(false)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [editing, setEditing] = useState(true)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  // Wall-clock anchors, so pausing and resuming can never accumulate drift.
  const startedAtRef = useRef(0)
  const offsetPxRef = useRef(0)

  const lines = useMemo(() => toPrompterLines(script), [script])
  const words = useMemo(() => countSpokenWords(script), [script])
  const totalSeconds = useMemo(() => readingSeconds(script, wpm), [script, wpm])

  /** How far the text must travel: everything below the fold, plus a full screen so
   *  the last line can reach the reading line instead of stopping at the bottom. */
  const scrollDistance = useCallback((): number => {
    const el = scrollerRef.current
    if (!el) return 0
    return Math.max(0, el.scrollHeight - el.clientHeight)
  }, [])

  const stopLoop = useCallback((): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => {
    if (!running) {
      stopLoop()
      return
    }
    const distance = scrollDistance()
    const pps = scrollPixelsPerSecond(distance, totalSeconds)
    startedAtRef.current = performance.now()

    const tick = (now: number): void => {
      const seconds = (now - startedAtRef.current) / 1000
      const px = offsetPxRef.current + pps * seconds
      const el = scrollerRef.current
      if (el) el.scrollTop = px
      setElapsed(pps > 0 ? px / pps : seconds)
      if (distance > 0 && px >= distance) {
        offsetPxRef.current = distance
        setRunning(false)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return stopLoop
  }, [running, totalSeconds, scrollDistance, stopLoop])

  /** Remembers where we stopped, so resuming continues rather than restarting. */
  function pause(): void {
    offsetPxRef.current = scrollerRef.current?.scrollTop ?? offsetPxRef.current
    setRunning(false)
  }

  function toggle(): void {
    if (running) pause()
    else {
      offsetPxRef.current = scrollerRef.current?.scrollTop ?? 0
      setRunning(true)
    }
  }

  function restart(): void {
    setRunning(false)
    offsetPxRef.current = 0
    setElapsed(0)
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }

  // Keyboard control — the whole point is not touching the mouse during a take.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editing) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setWpm((w) => clampWpm(w + 10))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setWpm((w) => clampWpm(w - 10))
      } else if (e.code === 'Home') {
        e.preventDefault()
        restart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, running])

  const remaining = Math.max(0, totalSeconds - elapsed)

  return (
    <div className="flex h-full flex-col bg-black text-white">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-800 bg-ink-950 px-4 py-2 text-sm">
        <button
          onClick={toggle}
          disabled={!script.trim()}
          className="rounded-md bg-gold-500 px-4 py-1.5 font-medium text-ink-950 disabled:opacity-40"
        >
          {running ? '❚❚ Pause' : '▶ Start'}
        </button>
        <button onClick={restart} className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 hover:bg-ink-800">
          ↺ Restart
        </button>

        <label className="flex items-center gap-2 text-ink-300">
          Speed
          <input
            type="range"
            min={MIN_WPM}
            max={MAX_WPM}
            step={5}
            value={wpm}
            onChange={(e) => setWpm(clampWpm(Number(e.target.value)))}
            className="w-32"
          />
          <span className="w-20 tabular-nums text-ink-100">{wpm} wpm</span>
        </label>

        <label className="flex items-center gap-2 text-ink-300">
          Size
          <input
            type="range"
            min={20}
            max={90}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-24"
          />
        </label>

        <label className="flex items-center gap-1.5 text-ink-300">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          Mirror
        </label>

        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 hover:bg-ink-800"
        >
          {editing ? 'Done editing' : 'Edit script'}
        </button>

        <div className="ml-auto flex items-center gap-4 tabular-nums text-ink-300">
          <span>{words} words</span>
          <span className="text-gold-400">{formatClock(remaining)} left</span>
          <span>of {formatClock(totalSeconds)}</span>
        </div>
      </div>

      {editing ? (
        <div className="flex-1 overflow-y-auto p-4">
          <label className="text-xs text-ink-400">
            Paste your script. Bracketed directions like [PATTERN INTERRUPT] are shown but never counted in the
            timing — they are notes to you, not words to say.
          </label>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={18}
            placeholder="Paste your script here…"
            className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 p-3 font-mono text-sm text-ink-100"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-400">Finish in:</span>
            {[3, 5, 10, 15, 20].map((mins) => (
              <button
                key={mins}
                onClick={() => {
                  const s = suggestWpm(script, mins * 60)
                  if (s) setWpm(s)
                }}
                disabled={!words}
                className="rounded-md border border-ink-700 px-3 py-1 text-ink-200 hover:bg-ink-800 disabled:opacity-40"
              >
                {mins} min
              </button>
            ))}
            <span className="text-xs text-ink-500">
              Sets the speed so the whole script lands exactly on that length.
            </span>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden">
          {/* The fixed reading line — keep your eyes here. */}
          <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex items-center">
            <div className="h-px flex-1 bg-gold-500/40" />
            <span className="px-2 text-[10px] uppercase tracking-widest text-gold-500/70">read here</span>
            <div className="h-px flex-1 bg-gold-500/40" />
          </div>

          <div
            ref={scrollerRef}
            className="h-full overflow-hidden px-[8%]"
            style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
          >
            {/* Leading and trailing space so the first and last lines can both reach
                the reading line rather than being stuck at an edge. */}
            <div style={{ height: '33vh' }} />
            {lines.map((line, i) =>
              line.kind === 'blank' ? (
                <div key={i} style={{ height: fontSize * 0.6 }} />
              ) : (
                <p
                  key={i}
                  className={line.kind === 'direction' ? 'text-gold-600/60' : 'text-white'}
                  style={{
                    fontSize: line.kind === 'direction' ? fontSize * 0.55 : fontSize,
                    lineHeight: 1.45,
                    margin: '0 0 0.5em',
                    fontWeight: line.kind === 'direction' ? 400 : 600
                  }}
                >
                  {line.text}
                </p>
              )
            )}
            <div style={{ height: '80vh' }} />
          </div>

          {!script.trim() && (
            <div className="absolute inset-0 flex items-center justify-center text-ink-500">
              Press “Edit script” and paste your script.
            </div>
          )}
        </div>
      )}

      <div className="border-t border-ink-800 bg-ink-950 px-4 py-1.5 text-center text-xs text-ink-500">
        Space = start/pause · ↑ ↓ = speed · Home = back to the top
      </div>
    </div>
  )
}
