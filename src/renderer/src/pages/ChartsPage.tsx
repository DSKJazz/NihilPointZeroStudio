import { useEffect, useMemo, useRef, useState } from 'react'
import type { PriceSeries } from '../../../shared/types'
import { useAutosave } from '../hooks/useAutosave'

import { lineProgress, progressAtFrame, totalFrames, type AnimationSpec } from '../../../shared/chartAnimation'

/** How the draw-on plays. 25fps to match the render pipeline, so a screen-recorded
 *  chart and a rendered one move at the same speed. */
const DRAW_SPEC: AnimationSpec = { durationSec: 4, fps: 25, holdSec: 1 }

const W = 960
const PRICE_H = 360
const RSI_H = 130
const PAD_L = 56
const PAD_R = 12
const PAD_T = 12
const MAX_BARS = 150

export default function ChartsPage(): React.JSX.Element {
  // Draw-on animation. A chart that appears all at once is a picture; a chart that
  // draws itself while you talk over it is the explanation. `frame` is null when idle,
  // which is what makes the static chart the default — nothing moves unless asked.
  const [frame, setFrame] = useState<number | null>(null)
  const [series, setSeries] = useState<PriceSeries | null>(null)
  const [name, setName] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [symbol, setSymbol] = useState('LUCK')
  // Script designer (optional — only if you want a narration from this chart)
  const [loadedSymbol, setLoadedSymbol] = useState('')
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState('English')
  const [script, setScript] = useState('')
  const [scriptTitle, setScriptTitle] = useState('')
  const [genBusy, setGenBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((stage: string) => setProgress(stage))
    return () => unsub.current?.()
  }, [])

  // Autosave the symbol + narration script so nothing is lost on tab-switch/restart
  // (memoized ref → the hook's status re-render can't cause a save-loop).
  const persisted = useMemo(
    () => ({ symbol, instruction, language, script, scriptTitle }),
    [symbol, instruction, language, script, scriptTitle]
  )
  useAutosave('charts-tab', persisted, (v) => {
    if (v.symbol) setSymbol(v.symbol)
    if (v.instruction != null) setInstruction(v.instruction)
    if (v.language) setLanguage(v.language)
    if (v.script != null) setScript(v.script)
    if (v.scriptTitle != null) setScriptTitle(v.scriptTitle)
  })

  async function loadPsx(): Promise<void> {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.psx.series(sym)
      if (!res.ok) { setError(res.error ?? 'Could not fetch PSX data.'); return }
      setSeries(res.series ?? null)
      setName(res.name ?? sym)
      setLoadedSymbol(sym)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch PSX data')
    } finally {
      setLoading(false)
    }
  }

  async function importFile(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.data.chartPriceFile()
      if (res.canceled) return
      if (res.error) { setError(res.error); return }
      if (res.series?.error) { setError(res.series.error); return }
      setSeries(res.series ?? null)
      setName(res.name ?? '')
      setLoadedSymbol('') // imported file, not a live symbol
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setLoading(false)
    }
  }

  /** Builds a verified figures summary from the currently-charted series (accurate — the
   *  SMA/RSI were computed server-side with the tested math). Used for imported files. */
  function figuresFromSeries(s: PriceSeries): string {
    const closes = s.bars.map((b) => b.close)
    const latest = closes[closes.length - 1]
    const num = (v: number | null | undefined) => (v == null ? 'n/a' : v.toFixed(2))
    return [
      `${name || 'Series'} — ${s.bars.length} bars (${s.bars[0]?.date} → ${s.bars[s.bars.length - 1]?.date})`,
      `Latest close: ${num(latest)}`,
      `Range: ${num(Math.min(...closes))} – ${num(Math.max(...closes))}`,
      `20-SMA: ${num(s.sma20[s.sma20.length - 1])} · 50-SMA: ${num(s.sma50[s.sma50.length - 1])}`,
      `RSI(14): ${num(s.rsi14[s.rsi14.length - 1])}`
    ].join('\n')
  }

  async function generateScript(): Promise<void> {
    if (!series || !series.bars.length) { setError('Load a chart first.'); return }
    setGenBusy('Writing a script from this chart…'); setError(null); setNote(null)
    const directives = { style: 'documentary', instruction: instruction.trim() || undefined, language: language || undefined }
    try {
      // Live PSX symbol → fetch fresh (most accurate); imported file → use the charted series' figures.
      const res = loadedSymbol
        ? await window.api.psx.script(loadedSymbol, directives)
        : await window.api.analysis.script('technical', name || 'this chart', figuresFromSeries(series), directives)
      if (!res.ok) { setError(res.error ?? 'Could not generate the script.'); return }
      setScriptTitle(res.title ?? (name || 'Chart analysis'))
      setScript(res.script ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Script generation failed.')
    } finally {
      setGenBusy(null)
    }
  }

  async function buildVideo(): Promise<void> {
    if (!script.trim()) { setError('Generate or write a script first.'); return }
    setGenBusy('Building narration video…'); setError(null); setNote(null); setProgress(null)
    try {
      await window.api.video.build({ title: scriptTitle || name || 'Chart Analysis', body: script, engine: 'ai-free', style: 'cinematic', template: 'news' })
      setNote('Video built — open Video Studio to preview, voice-over, or export it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video build failed.')
    } finally {
      setGenBusy(null); setProgress(null)
    }
  }

  // Show the most recent MAX_BARS bars for readability.
  const bars = series ? series.bars.slice(-MAX_BARS) : []
  const offset = series ? Math.max(0, series.bars.length - MAX_BARS) : 0
  const sma20 = series ? series.sma20.slice(offset) : []
  const sma50 = series ? series.sma50.slice(offset) : []
  const rsi14 = series ? series.rsi14.slice(offset) : []

  const chartW = W - PAD_L - PAD_R
  const n = bars.length
  const barW = n > 0 ? chartW / n : 0
  const lows = bars.map((b) => b.low)
  const highs = bars.map((b) => b.high)
  const pMin = n ? Math.min(...lows) : 0
  const pMax = n ? Math.max(...highs) : 1
  const pRange = pMax - pMin || 1
  const xCenter = (i: number): number => PAD_L + i * barW + barW / 2
  const yPrice = (p: number): number => PAD_T + (pMax - p) / pRange * (PRICE_H - PAD_T * 2)

  const linePoints = (vals: (number | null)[]): string =>
    vals
      .map((v, i) => (v === null ? null : `${xCenter(i).toFixed(1)},${yPrice(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ')

  const last = n ? bars[n - 1] : null
  const lastRsi = rsi14.length ? rsi14[rsi14.length - 1] : null
  // Live PSX (and close-only files) have no per-bar OHLC → render a close LINE instead of
  // degenerate 1px candles.
  const closeOnly = n > 0 && bars.every((b) => b.open === b.close && b.high === b.low)

  // Frame-indexed rather than time-indexed: the shared module works in frames because
  // the video renderer does, and converting back and forth is where the last frame ends
  // up at 0.98 and the chart sits permanently, subtly unfinished.
  useEffect(() => {
    if (frame === null) return
    const last = totalFrames(DRAW_SPEC)
    if (frame >= last) return
    const id = requestAnimationFrame(() => setFrame((f) => (f === null ? null : f + 1)))
    return () => cancelAnimationFrame(id)
  }, [frame])

  /** How many points of a series to show at the current frame. Everything when idle. */
  function visibleCount(total: number): number {
    if (frame === null) return total
    const { points, partial } = lineProgress(frame, total, DRAW_SPEC)
    return Math.min(total, points + (partial > 0 ? 1 : 0))
  }
  const drawProgress = frame === null ? 1 : progressAtFrame(frame, DRAW_SPEC)

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif text-ink-100">Charts</h1>
          <p className="text-ink-400 text-sm mt-1">
            SMA (20/50) and RSI (14) — computed with the same unit-tested math the analysis engine uses.
            Pull <span className="text-gold-300">live PSX data</span> by symbol, or import your own price file.
            Free, no account.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadPsx() }}
          placeholder="PSX symbol e.g. LUCK"
          className="w-44 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 uppercase"
        />
        <button
          onClick={loadPsx}
          disabled={loading || !symbol.trim()}
          className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
        >
          {loading ? 'Loading…' : '📈 Load live PSX'}
        </button>
        <span className="text-ink-600 text-xs">or</span>
        <button
          onClick={importFile}
          disabled={loading}
          className="rounded-md border border-ink-700 hover:bg-ink-800 disabled:opacity-50 text-ink-200 px-3 py-2 text-sm transition-colors"
        >
          📄 Import price file (CSV/Excel)
        </button>
      </div>

      <p className="text-[11px] text-ink-600 mt-2">
        Live PSX pulls real end-of-day closes straight from the PSX portal (dps.psx.com.pk) and charts them as a line
        with SMA/RSI. Imported files with Open/High/Low columns render as candlesticks.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {series && n > 0 && (
        <div className="mt-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
            <span className="text-sm text-ink-100 font-medium">{name || 'Price'}</span>
            {last && <span className="text-lg text-gold-300">{last.close.toLocaleString()}</span>}
            <span className="text-[11px] text-ink-500">
              {bars[0].date} → {last?.date} · {series.bars.length} bars{series.bars.length > MAX_BARS ? ` (showing last ${MAX_BARS})` : ''}
            </span>
            {lastRsi !== null && (
              <span className={`text-[11px] ${lastRsi >= 70 ? 'text-red-300' : lastRsi <= 30 ? 'text-emerald-300' : 'text-ink-400'}`}>
                RSI {lastRsi.toFixed(1)}{lastRsi >= 70 ? ' (overbought)' : lastRsi <= 30 ? ' (oversold)' : ''}
              </span>
            )}
            <span className="text-[11px] text-gold-400">— SMA20</span>
            <span className="text-[11px] text-sky-400">— SMA50</span>
            {/* A chart that appears all at once is a picture. One that draws itself while
                you talk over it is the explanation — record the screen while it plays. */}
            <button
              onClick={() => setFrame(frame === null ? 0 : null)}
              className="ml-auto rounded-md border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 text-[11px] px-2.5 py-1 transition-colors"
              title="Draws the chart on screen over four seconds, then holds — record the screen while it plays and lay it over your narration"
            >
              {frame === null ? '▶ Draw it on' : `Drawing… ${Math.round(drawProgress * 100)}%`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${PRICE_H + RSI_H + 30}`} className="w-full min-w-[640px]">
              {/* Price grid + axis labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const price = pMax - f * pRange
                const y = yPrice(price)
                return (
                  <g key={f}>
                    <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1e2637" strokeWidth={1} />
                    <text x={4} y={y + 4} fontSize={10} fill="#5b6472">{price.toFixed(2)}</text>
                  </g>
                )
              })}
              {/* Close line (live PSX / close-only) OR candlesticks (OHLC files) */}
              {closeOnly ? (
                <polyline
                  points={linePoints(bars.map((b) => b.close).slice(0, visibleCount(bars.length)))}
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth={1.5}
                />
              ) : (
                bars.slice(0, visibleCount(bars.length)).map((b, i) => {
                  const up = b.close >= b.open
                  const color = up ? '#26a69a' : '#ef5350'
                  const bodyTop = yPrice(Math.max(b.open, b.close))
                  const bodyBot = yPrice(Math.min(b.open, b.close))
                  const cw = Math.max(1, barW * 0.6)
                  return (
                    <g key={i}>
                      <line x1={xCenter(i)} y1={yPrice(b.high)} x2={xCenter(i)} y2={yPrice(b.low)} stroke={color} strokeWidth={1} />
                      <rect x={xCenter(i) - cw / 2} y={bodyTop} width={cw} height={Math.max(1, bodyBot - bodyTop)} fill={color} />
                    </g>
                  )
                })
              )}
              {/* SMA overlays */}
              <polyline points={linePoints(sma20.slice(0, visibleCount(sma20.length)))} fill="none" stroke="#E8B923" strokeWidth={1.5} />
              <polyline points={linePoints(sma50.slice(0, visibleCount(sma50.length)))} fill="none" stroke="#38bdf8" strokeWidth={1.5} />

              {/* RSI panel */}
              {(() => {
                const top = PRICE_H + 24
                const yR = (v: number): number => top + (100 - v) / 100 * RSI_H
                const pts = rsi14
                  .slice(0, visibleCount(rsi14.length))
                  .map((v, i) => (v === null ? null : `${xCenter(i).toFixed(1)},${yR(v).toFixed(1)}`))
                  .filter(Boolean)
                  .join(' ')
                return (
                  <g>
                    <text x={4} y={top + 4} fontSize={10} fill="#5b6472">RSI</text>
                    <line x1={PAD_L} y1={yR(70)} x2={W - PAD_R} y2={yR(70)} stroke="#ef535055" strokeDasharray="4 4" />
                    <line x1={PAD_L} y1={yR(30)} x2={W - PAD_R} y2={yR(30)} stroke="#26a69a55" strokeDasharray="4 4" />
                    <text x={4} y={yR(70) + 3} fontSize={9} fill="#5b6472">70</text>
                    <text x={4} y={yR(30) + 3} fontSize={9} fill="#5b6472">30</text>
                    <polyline points={pts} fill="none" stroke="#c084fc" strokeWidth={1.5} />
                  </g>
                )
              })()}
            </svg>
          </div>
        </div>
      )}

      {/* Also shown when only a RESTORED script exists: `script` is autosaved but
          `series` is not, so after a restart the script was invisible and
          unreachable even though it was still on disk. */}
      {((series && n > 0) || script) && (
        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900 p-3">
          <div className="text-sm text-ink-200 font-medium">Turn this chart into a narration script (optional)</div>
          <div className="text-[11px] text-ink-500 mt-0.5 mb-2">
            Tell the AI what you want covered and how — then pick the language. It writes the script using only the
            figures on this chart (it won't invent numbers). Leave blank if you just want the chart.
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="e.g. Is this a good entry? Explain the RSI and 50/200-day cross simply, cautious tone."
            className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-ink-200"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-400">Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200">
              <option>English</option>
              <option>Roman Urdu</option>
              <option>Urdu</option>
            </select>
            <button
              onClick={generateScript}
              disabled={!!genBusy || !series || n === 0}
              title={!series || n === 0 ? 'Import or load a chart first — the script is written from its figures.' : undefined}
              className="ml-auto rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950"
            >
              ✍ Generate script
            </button>
          </div>
          {genBusy && <div className="mt-2 text-sm text-gold-300">{genBusy}{progress ? ` — ${progress}` : ''}</div>}
          {note && <div className="mt-2 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}
          {script && (
            <div className="mt-3">
              <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={10} className="w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200 font-mono" />
              <div className="mt-2 flex gap-2">
                <button onClick={buildVideo} disabled={!!genBusy} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40">🎬 Build narration video</button>
                <button onClick={() => { navigator.clipboard?.writeText(script); setNote('Script copied.') }} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">Copy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!series && !error && (
        <div className="mt-6 rounded-md border border-dashed border-ink-700 py-12 text-center text-ink-500 text-sm">
          Import a price file to see its candlestick chart, moving averages, and RSI.
        </div>
      )}
    </div>
  )
}
