import { useEffect, useMemo, useRef, useState } from 'react'
import type { PsxLiveAnalysis } from '../../../shared/types'
import { useAutosave } from '../hooks/useAutosave'

/**
 * Live PSX data tool: type a symbol → fetch REAL end-of-day data from the PSX portal →
 * accurate in-app analysis → download Excel → generate a reasoned narration script →
 * build a video from it. All figures are computed in-app from portal data.
 */
export default function PsxPage(): React.JSX.Element {
  const [symbol, setSymbol] = useState('LUCK')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<PsxLiveAnalysis | null>(null)
  const [summary, setSummary] = useState('')
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState<string | null>(null)
  // Set when the PSX portal was unreachable and the shown numbers are the last SAVED
  // fetch (YYYY-MM-DD) — displayed as a clear banner so it's never mistaken for live data.
  const [staleAsOf, setStaleAsOf] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState('English')

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((stage: string) => setProgress(stage))
    return () => unsub.current?.()
  }, [])

  // Autosave the whole tab so nothing is lost on close/restart (memoized ref so the
  // hook's own status re-render can't trigger a save-loop). Only overwritten by your edits.
  const persisted = useMemo(
    () => ({ symbol, instruction, language, title, script, summary, analysis }),
    [symbol, instruction, language, title, script, summary, analysis]
  )
  const saveStatus = useAutosave('psx-tab', persisted, (v) => {
    if (v.symbol) setSymbol(v.symbol)
    if (v.instruction != null) setInstruction(v.instruction)
    if (v.language) setLanguage(v.language)
    if (v.title != null) setTitle(v.title)
    if (v.script != null) setScript(v.script)
    if (v.summary != null) setSummary(v.summary)
    if (v.analysis) setAnalysis(v.analysis)
  })

  const sym = symbol.trim().toUpperCase()

  async function analyze(): Promise<void> {
    setBusy('Fetching live data from the PSX portal…')
    setError(null); setNote(null)
    try {
      const res = await window.api.psx.analyze(sym)
      if (!res.ok) { setError(res.error ?? 'Could not fetch PSX data.'); return }
      // Replace the old analysis/script only AFTER a successful fetch — clearing
      // them up front meant a typo'd symbol (or a portal hiccup) destroyed the
      // current analysis, and autosave immediately persisted the empty state.
      setScript('')
      setAnalysis(res.analysis ?? null)
      setSummary(res.summary ?? '')
      setStaleAsOf(res.staleAsOf ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed.')
    } finally {
      setBusy(null)
    }
  }

  // Excel/Script act on the symbol whose figures are ON SCREEN — not whatever is
  // currently typed in the box, which may have changed since the last Analyze.
  const analyzedSym = analysis?.symbol || sym

  async function downloadExcel(): Promise<void> {
    setBusy('Building Excel workbook…'); setError(null); setNote(null)
    try {
      const res = await window.api.psx.excel(analyzedSym)
      if (res.saved) setNote(`Excel saved: ${res.path}`)
      else if (res.error) setError(res.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Excel export failed.')
    } finally {
      setBusy(null)
    }
  }

  async function generateScript(): Promise<void> {
    setBusy('Writing a reasoned narration script from the figures…'); setError(null); setNote(null)
    try {
      const res = await window.api.psx.script(analyzedSym, { style: 'documentary', instruction: instruction.trim() || undefined, language: language || undefined })
      if (!res.ok) { setError(res.error ?? 'Could not generate the script.'); return }
      setTitle(res.title ?? `${analyzedSym} — PSX Analysis`)
      setScript(res.script ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Script generation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function buildVideo(): Promise<void> {
    if (!script.trim()) { setError('Generate or write a script first.'); return }
    setBusy('Building narration video (AI visuals)…'); setError(null); setNote(null); setProgress(null)
    try {
      await window.api.video.build({ title: title || `${analyzedSym} — PSX Analysis`, body: script, engine: 'ai-free', style: 'cinematic', template: 'news' })
      setNote('Video built — open Video Studio to preview, voice-over, or export it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video build failed.')
    } finally {
      setBusy(null); setProgress(null)
    }
  }

  const metrics: [string, string][] = analysis
    ? [
        ['Latest close', `${analysis.latest.toFixed(2)} PKR`],
        ['Change (1d)', analysis.changePct === null ? 'n/a' : `${analysis.changePct >= 0 ? '+' : ''}${analysis.changePct.toFixed(2)}%`],
        ['1-year', analysis.yearChangePct === null ? 'n/a' : `${analysis.yearChangePct >= 0 ? '+' : ''}${analysis.yearChangePct.toFixed(2)}%`],
        ['52-week range', `${analysis.low52w.toFixed(0)}–${analysis.high52w.toFixed(0)}`],
        ['20-DMA', analysis.sma20 === null ? 'n/a' : analysis.sma20.toFixed(2)],
        ['50-DMA', analysis.sma50 === null ? 'n/a' : analysis.sma50.toFixed(2)],
        ['200-DMA', analysis.sma200 === null ? 'n/a' : analysis.sma200.toFixed(2)],
        ['RSI(14)', analysis.rsi14 === null ? 'n/a' : analysis.rsi14.toFixed(1)]
      ]
    : []

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-gold-400">Live PSX Data
        <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
      </h1>
      <p className="text-ink-400 text-sm mt-1">
        Real end-of-day data straight from the PSX portal (dps.psx.com.pk). Figures (SMA/RSI/returns) are
        computed in-app with standard formulas — download them as Excel or turn them into a narrated video.
      </p>

      <div className="mt-5 flex items-center gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') analyze() }}
          placeholder="Symbol e.g. LUCK, HUBC, ENGRO"
          className="w-64 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 uppercase"
        />
        <button onClick={analyze} disabled={!!busy || !sym} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40">
          Analyze
        </button>
        {analysis && (
          <>
            <button onClick={downloadExcel} disabled={!!busy} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">⬇ Excel</button>
            <button onClick={generateScript} disabled={!!busy} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">✍ Script</button>
          </>
        )}
      </div>

      {busy && <div className="mt-3 text-sm text-gold-300">{busy}{progress ? ` — ${progress}` : ''}</div>}
      {error && <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <div className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}
      {staleAsOf && (
        <div className="mt-3 rounded-md border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          ⚠ The PSX portal is unreachable right now — showing the last SAVED data (fetched {staleAsOf}). These
          are not live prices. Try again once you&apos;re back online.
        </div>
      )}

      {analysis && (
        <div className="mt-5">
          <div className="text-xs text-ink-500">
            {analysis.symbol} · {analysis.points} trading days · {analysis.from} → {analysis.to} · <span className="text-ink-300">{analysis.trend}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {metrics.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="text-[11px] text-ink-500">{k}</div>
                <div className="text-lg text-ink-100 mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          {summary && <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950 p-4 text-xs text-ink-300">{summary}</pre>}

          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900 p-3">
            <div className="text-[11px] text-ink-500 mb-2">Tell the AI what & how to narrate (optional), and the language — then click ✍ Script.</div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="e.g. Focus on whether this is a good long-term hold; explain RSI simply for beginners."
              className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-ink-200"
            />
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-ink-400">Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200">
                <option>English</option>
                <option>Roman Urdu</option>
                <option>Urdu</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {script && (
        <div className="mt-6">
          <div className="text-sm text-ink-200 font-medium mb-2">Narration script (editable)</div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200 font-mono"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={buildVideo} disabled={!!busy} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40">🎬 Build narration video</button>
            <button onClick={() => { navigator.clipboard?.writeText(script); setNote('Script copied.') }} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">Copy</button>
          </div>
        </div>
      )}
    </div>
  )
}
