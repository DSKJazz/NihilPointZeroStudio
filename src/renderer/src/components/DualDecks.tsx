import { useEffect, useRef, useState } from 'react'
import { clampTime, computePeaks, detectBpm, equalPowerGains, isValidLoop } from '../audio/djMath'

/**
 * 🎛 DUAL DECKS — a real two-deck DJ engine, 100% on this PC (WebAudio), free for
 * life: no service, no key, no internet. Per deck: load any audio file, play/pause,
 * pitch (speed), 3-band EQ, loop in/out, 4 hot cues, BPM detection, clickable
 * waveform. Between decks: an equal-power crossfader.
 *
 * All the math lives in ../audio/djMath.ts (unit-tested); this file is the WebAudio
 * plumbing + controls. Audio graph per deck:
 *   BufferSource → low shelf (250Hz) → mid peak (1kHz) → high shelf (4kHz)
 *     → deck gain → crossfade gain → speakers
 */

interface DeckState {
  name: string
  buffer: AudioBuffer | null
  peaks: number[]
  bpm: number | null
  playing: boolean
  rate: number
  eq: { low: number; mid: number; high: number }
  loopIn: number | null
  loopOut: number | null
  cues: (number | null)[]
}

const FRESH: DeckState = {
  name: '',
  buffer: null,
  peaks: [],
  bpm: null,
  playing: false,
  rate: 1,
  eq: { low: 0, mid: 0, high: 0 },
  loopIn: null,
  loopOut: null,
  cues: [null, null, null, null]
}

/** The live WebAudio objects for one deck (kept outside React state — they mutate). */
interface DeckNodes {
  source: AudioBufferSourceNode | null
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  gain: GainNode
  cross: GainNode
  startedAt: number // ctx.currentTime when playback began
  offset: number // seconds into the track at that moment
}

export default function DualDecks({ initialFile }: { initialFile?: { path: string; name: string } } = {}): React.JSX.Element {
  const ctxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<(DeckNodes | null)[]>([null, null])
  const [decks, setDecks] = useState<[DeckState, DeckState]>([{ ...FRESH }, { ...FRESH }])
  const [cross, setCross] = useState(0.5)
  const canvasRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)]
  const rafRef = useRef(0)

  function ctx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  function nodes(i: number): DeckNodes {
    if (!nodesRef.current[i]) {
      const c = ctx()
      const low = c.createBiquadFilter()
      low.type = 'lowshelf'
      low.frequency.value = 250
      const mid = c.createBiquadFilter()
      mid.type = 'peaking'
      mid.frequency.value = 1000
      mid.Q.value = 1
      const high = c.createBiquadFilter()
      high.type = 'highshelf'
      high.frequency.value = 4000
      const gain = c.createGain()
      const crossG = c.createGain()
      low.connect(mid)
      mid.connect(high)
      high.connect(gain)
      gain.connect(crossG)
      crossG.connect(c.destination)
      nodesRef.current[i] = { source: null, low, mid, high, gain, cross: crossG, startedAt: 0, offset: 0 }
    }
    return nodesRef.current[i] as DeckNodes
  }

  const patchDeck = (i: number, patch: Partial<DeckState>): void =>
    setDecks((prev) => {
      const next = [...prev] as [DeckState, DeckState]
      next[i] = { ...next[i], ...patch }
      return next
    })

  /** Where the deck's playhead is right now, in seconds. */
  function position(i: number): number {
    const n = nodesRef.current[i]
    const d = decks[i]
    if (!n || !d.buffer) return 0
    if (!d.playing) return n.offset
    let pos = n.offset + (ctx().currentTime - n.startedAt) * d.rate
    if (isValidLoop(d.loopIn, d.loopOut) && pos > (d.loopOut as number)) {
      const span = (d.loopOut as number) - (d.loopIn as number)
      pos = (d.loopIn as number) + ((pos - (d.loopIn as number)) % span)
    }
    return Math.min(pos, d.buffer.duration)
  }

  function stopSource(i: number): void {
    const n = nodesRef.current[i]
    if (n?.source) {
      try {
        n.source.onended = null
        n.source.stop()
      } catch {
        /* already stopped */
      }
      n.source = null
    }
  }

  /** (Re)starts playback from `fromSec` — WebAudio sources are one-shot, so every
   * play/seek/loop-change builds a fresh source against the persistent EQ chain. */
  function play(i: number, fromSec?: number): void {
    const d = decks[i]
    if (!d.buffer) return
    const c = ctx()
    void c.resume()
    const n = nodes(i)
    stopSource(i)
    const src = c.createBufferSource()
    src.buffer = d.buffer
    src.playbackRate.value = d.rate
    if (isValidLoop(d.loopIn, d.loopOut)) {
      src.loop = true
      src.loopStart = d.loopIn as number
      src.loopEnd = d.loopOut as number
    }
    src.connect(n.low)
    const offset = clampTime(fromSec ?? position(i), d.buffer.duration)
    n.offset = offset
    n.startedAt = c.currentTime
    src.onended = () => {
      // Natural end of a non-looping track: show it as paused at the start.
      if (nodesRef.current[i]?.source === src) {
        nodesRef.current[i]!.source = null
        nodesRef.current[i]!.offset = 0
        patchDeck(i, { playing: false })
      }
    }
    n.source = src
    src.start(0, offset)
    patchDeck(i, { playing: true })
  }

  function pause(i: number): void {
    const n = nodesRef.current[i]
    if (!n) return
    n.offset = position(i)
    stopSource(i)
    patchDeck(i, { playing: false })
  }

  async function loadBytes(i: number, name: string, bytes: ArrayBuffer): Promise<void> {
    try {
      const buffer = await ctx().decodeAudioData(bytes)
      const mono = buffer.getChannelData(0)
      stopSource(i)
      nodes(i).offset = 0
      patchDeck(i, {
        ...FRESH,
        name,
        buffer,
        peaks: computePeaks(mono, 240),
        bpm: detectBpm(mono, buffer.sampleRate)
      })
    } catch {
      patchDeck(i, { ...FRESH, name: `could not read ${name}` })
    }
  }

  async function loadFile(i: number, file: File): Promise<void> {
    patchDeck(i, { ...FRESH, name: `decoding ${file.name}…` })
    await loadBytes(i, file.name, await file.arrayBuffer())
  }

  // A track handed in from outside (e.g. "Open in DJ decks" on a built video) lands
  // on Deck A automatically. Bytes come over IPC — a sandboxed renderer cannot
  // fetch() file:// URLs (media elements can play them, but fetch is refused).
  const loadedInitial = useRef<string | null>(null)
  useEffect(() => {
    if (!initialFile || loadedInitial.current === initialFile.path) return
    loadedInitial.current = initialFile.path
    void (async () => {
      patchDeck(0, { ...FRESH, name: `loading ${initialFile.name}…` })
      try {
        const bytes = await window.api.audio.readFile(initialFile.path)
        // Copy into a tight ArrayBuffer — decodeAudioData wants exactly the audio bytes.
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        await loadBytes(0, initialFile.name, buf)
      } catch {
        patchDeck(0, { ...FRESH, name: `could not read ${initialFile.name}` })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile?.path])

  // Crossfader + EQ + rate live-apply (cheap, every render is fine at this scale).
  useEffect(() => {
    const g = equalPowerGains(cross)
    nodesRef.current[0]?.cross.gain.setTargetAtTime(g.a, ctx().currentTime, 0.01)
    nodesRef.current[1]?.cross.gain.setTargetAtTime(g.b, ctx().currentTime, 0.01)
  }, [cross])
  useEffect(() => {
    decks.forEach((d, i) => {
      const n = nodesRef.current[i]
      if (!n) return
      n.low.gain.value = d.eq.low
      n.mid.gain.value = d.eq.mid
      n.high.gain.value = d.eq.high
      if (n.source) n.source.playbackRate.value = d.rate
    })
  }, [decks])

  // Waveform + playhead painter.
  useEffect(() => {
    const paint = (): void => {
      decks.forEach((d, i) => {
        const canvas = canvasRefs[i].current
        if (!canvas) return
        const g = canvas.getContext('2d')
        if (!g) return
        const { width, height } = canvas
        g.clearRect(0, 0, width, height)
        g.fillStyle = '#1c2530'
        g.fillRect(0, 0, width, height)
        const per = width / Math.max(1, d.peaks.length)
        g.fillStyle = i === 0 ? '#38bdf8' : '#f0b34e'
        d.peaks.forEach((p, k) => {
          const h = Math.max(1, p * (height - 4))
          g.fillRect(k * per, (height - h) / 2, Math.max(1, per - 1), h)
        })
        if (d.buffer) {
          // Loop region shading + playhead.
          if (isValidLoop(d.loopIn, d.loopOut)) {
            g.fillStyle = 'rgba(74, 222, 128, 0.15)'
            const x1 = ((d.loopIn as number) / d.buffer.duration) * width
            const x2 = ((d.loopOut as number) / d.buffer.duration) * width
            g.fillRect(x1, 0, x2 - x1, height)
          }
          g.fillStyle = '#f8fafc'
          g.fillRect((position(i) / d.buffer.duration) * width, 0, 2, height)
        }
      })
      rafRef.current = requestAnimationFrame(paint)
    }
    rafRef.current = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(rafRef.current)
  })

  // Full teardown on unmount — the decks must never keep playing after leaving the tab.
  useEffect(
    () => () => {
      stopSource(0)
      stopSource(1)
      void ctxRef.current?.close()
      ctxRef.current = null
      nodesRef.current = [null, null]
    },
    []
  )

  const deckUi = (i: 0 | 1): React.JSX.Element => {
    const d = decks[i]
    const accent = i === 0 ? 'text-sky-300' : 'text-gold-300'
    return (
      <div className="flex-1 min-w-0 rounded-lg border border-ink-700 bg-ink-900 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-medium ${accent}`}>Deck {i === 0 ? 'A' : 'B'}</span>
          <span className="text-[10px] text-ink-500 truncate">{d.name || 'no track loaded'}</span>
          <span className="text-[10px] text-ink-400 shrink-0">BPM {d.bpm ?? '—'}</span>
        </div>
        <label className="block">
          <span className="sr-only">Load audio file</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadFile(i, f)
              e.target.value = ''
            }}
            className="block w-full text-[10px] text-ink-400 file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-[10px] file:text-ink-200"
          />
        </label>
        <canvas
          ref={canvasRefs[i]}
          width={560}
          height={64}
          className="w-full h-16 rounded cursor-pointer"
          onClick={(e) => {
            if (!d.buffer) return
            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
            const t = ((e.clientX - rect.left) / rect.width) * d.buffer.duration
            if (d.playing) play(i, t)
            else {
              nodes(i).offset = clampTime(t, d.buffer.duration)
              patchDeck(i, {}) // repaint
            }
          }}
          title="Click to jump"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => (d.playing ? pause(i) : play(i))}
            disabled={!d.buffer}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 text-ink-950 text-xs font-medium px-3 py-1"
          >
            {d.playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <label className="flex items-center gap-1 text-[10px] text-ink-400">
            Pitch
            <input
              type="range"
              min={0.92}
              max={1.08}
              step={0.005}
              value={d.rate}
              onChange={(e) => patchDeck(i, { rate: Number(e.target.value) })}
              className="w-20"
            />
            <span className="w-10 text-ink-300">{((d.rate - 1) * 100).toFixed(1)}%</span>
          </label>
          <button
            onClick={() => patchDeck(i, { loopIn: position(i) })}
            disabled={!d.buffer}
            className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-ink-300 hover:border-emerald-500 disabled:opacity-40"
          >
            Loop in
          </button>
          <button
            onClick={() => {
              const out = position(i)
              patchDeck(i, { loopOut: out })
              // Applying a loop live means rebuilding the source with loop points.
              if (d.playing && isValidLoop(d.loopIn, out)) play(i, d.loopIn as number)
            }}
            disabled={!d.buffer || d.loopIn === null}
            className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-ink-300 hover:border-emerald-500 disabled:opacity-40"
          >
            Loop out
          </button>
          <button
            onClick={() => {
              patchDeck(i, { loopIn: null, loopOut: null })
              if (d.playing) play(i, position(i))
            }}
            disabled={!isValidLoop(d.loopIn, d.loopOut)}
            className="rounded border border-ink-600 px-2 py-0.5 text-[10px] text-ink-300 hover:border-amber-500 disabled:opacity-40"
          >
            Loop off
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.cues.map((cue, k) => (
            <button
              key={k}
              disabled={!d.buffer}
              onClick={() => {
                if (cue === null) patchDeck(i, { cues: d.cues.map((c, j) => (j === k ? position(i) : c)) })
                else play(i, cue)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                patchDeck(i, { cues: d.cues.map((c, j) => (j === k ? null : c)) })
              }}
              title={cue === null ? 'Click: set cue here' : `Jump to ${cue.toFixed(1)}s (right-click clears)`}
              className={`rounded px-2 py-0.5 text-[10px] border disabled:opacity-40 ${
                cue === null ? 'border-ink-700 text-ink-500' : 'border-gold-600 text-gold-300'
              }`}
            >
              {k + 1}
            </button>
          ))}
          {(['low', 'mid', 'high'] as const).map((band) => (
            <label key={band} className="flex items-center gap-1 text-[10px] text-ink-400">
              {band.toUpperCase()}
              <input
                type="range"
                min={-18}
                max={12}
                step={1}
                value={d.eq[band]}
                onChange={(e) => patchDeck(i, { eq: { ...d.eq, [band]: Number(e.target.value) } })}
                className="w-14"
              />
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950 p-3 space-y-2">
      <div className="text-xs text-ink-300 font-medium">
        🎛 Dual decks <span className="text-[10px] text-ink-500">— two tracks, EQ, loops, hot cues, crossfader. All on this PC, free.</span>
      </div>
      <div className="flex flex-col md:flex-row gap-3">
        {deckUi(0)}
        {deckUi(1)}
      </div>
      <label className="flex items-center gap-2 text-[10px] text-ink-400">
        <span className="text-sky-300">A</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={cross}
          onChange={(e) => setCross(Number(e.target.value))}
          className="flex-1"
          aria-label="Crossfader"
        />
        <span className="text-gold-300">B</span>
      </label>
      <p className="text-[10px] text-ink-600">
        Cue buttons: click once to set, click to jump, right-click to clear. Loops: mark “Loop in”, then “Loop out” —
        the green region repeats until “Loop off”.
      </p>
    </div>
  )
}
