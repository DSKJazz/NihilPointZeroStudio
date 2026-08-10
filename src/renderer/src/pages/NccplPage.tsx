import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutosave } from '../hooks/useAutosave'

/**
 * NCCPL tab. NCCPL's portal blocks automated access (HTTP 403), so — honestly — the app
 * can't scrape it. Instead: you download the FIPI/LIPI (or any market) file from NCCPL
 * yourself, UPLOAD it here, and the app analyses it (auto-detecting flow / technical /
 * fundamentals), then writes a reasoned narration script in the language you choose and
 * can build a video from it. All figures are computed in-app from YOUR file.
 */
type Kind = 'technical' | 'fundamental' | 'flow' | 'document'
const KIND_MAP: Record<Kind, 'technical' | 'financial' | 'flow'> = {
  technical: 'technical',
  fundamental: 'financial',
  flow: 'flow',
  document: 'financial'
}

export default function NccplPage(): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [kind, setKind] = useState<Kind | null>(null)
  const [summary, setSummary] = useState('')
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState('English')
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('')
  const [progress, setProgress] = useState<string | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  useEffect(() => {
    unsub.current = window.api.video.onProgress((stage: string) => setProgress(stage))
    return () => unsub.current?.()
  }, [])

  // Autosave the whole tab (uploaded-file analysis + your prompt/language + generated
  // script) so nothing is lost on close/restart. Memoized ref → no save-loop.
  const persisted = useMemo(
    () => ({ fileName, kind, summary, instruction, language, title, script }),
    [fileName, kind, summary, instruction, language, title, script]
  )
  const saveStatus = useAutosave('nccpl-tab', persisted, (v) => {
    if (v.fileName != null) setFileName(v.fileName)
    if (v.kind) setKind(v.kind)
    if (v.summary != null) setSummary(v.summary)
    if (v.instruction != null) setInstruction(v.instruction)
    if (v.language) setLanguage(v.language)
    if (v.title != null) setTitle(v.title)
    if (v.script != null) setScript(v.script)
  })

  async function upload(): Promise<void> {
    // Do NOT clear the existing analysis/script before the dialog: pressing Cancel
    // in the file picker used to wipe them (and autosave then persisted the loss).
    // The old state is replaced only once a new file has actually been read.
    setBusy('Reading your NCCPL file…'); setError(null); setNote(null)
    try {
      const res = await window.api.data.importFile()
      if (res.canceled) return
      if (res.error) { setError(res.error); return }
      if (res.analysis) {
        setScript('')
        setKind(res.analysis.kind as Kind)
        setSummary(res.analysis.summary)
        setFileName(res.analysis.fileName)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.')
    } finally {
      setBusy(null)
    }
  }

  async function generateScript(): Promise<void> {
    if (!summary) { setError('Upload and analyze a file first.'); return }
    setBusy('Writing a reasoned narration from your figures…'); setError(null); setNote(null)
    try {
      const subject = kind === 'flow' ? 'NCCPL FIPI/LIPI institutional flows' : fileName || 'this NCCPL data'
      const res = await window.api.analysis.script(KIND_MAP[kind ?? 'document'], subject, summary, {
        style: 'documentary',
        instruction: instruction.trim() || undefined,
        language: language || undefined
      })
      if (!res.ok) { setError(res.error ?? 'Could not generate the script.'); return }
      setTitle(res.title ?? subject)
      setScript(res.script ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Script generation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function buildVideo(): Promise<void> {
    if (!script.trim()) { setError('Generate or write a script first.'); return }
    setBusy('Building narration video…'); setError(null); setNote(null); setProgress(null)
    try {
      await window.api.video.build({ title: title || 'NCCPL Analysis', body: script, engine: 'ai-free', style: 'cinematic', template: 'news' })
      setNote('Video built — open Video Studio to preview, voice-over, or export it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video build failed.')
    } finally {
      setBusy(null); setProgress(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-gold-400">NCCPL Analysis
        <span className="ml-3 align-middle text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
      </h1>
      <p className="text-ink-400 text-sm mt-1">
        NCCPL's portal blocks automated access, so download the FIPI/LIPI (or market) file from NCCPL
        yourself and upload it here. The app auto-detects and analyzes it (foreign vs local net flow,
        or price/fundamentals), then writes a narration script in your language. All figures are computed
        in-app from your file.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => window.open('https://www.nccpl.com.pk', '_blank')}
          className="rounded-md border border-ink-700 hover:bg-ink-800 px-4 py-2 text-sm text-ink-200"
          title="Opens NCCPL's website in your browser so you can download the FIPI/LIPI file, then upload it here."
        >
          🌐 Open NCCPL site to download the file
        </button>
        <button onClick={upload} disabled={!!busy} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-40 px-4 py-2 text-sm font-medium text-ink-950">
          ⬆ Upload NCCPL file (CSV/Excel)
        </button>
        {kind && <span className="text-xs text-ink-500">{fileName} · detected: <span className="text-ink-300">{kind}</span></span>}
      </div>

      {busy && <div className="mt-3 text-sm text-gold-300">{busy}{progress ? ` — ${progress}` : ''}</div>}
      {error && <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <div className="mt-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{note}</div>}

      {summary && (
        <div className="mt-5">
          <pre className="whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950 p-4 text-xs text-ink-300">{summary}</pre>

          <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900 p-3">
            <div className="text-[11px] text-ink-500 mb-2">Tell the AI what & how to narrate (optional), and the language — then generate.</div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="e.g. Explain what foreign selling means for retail investors, cautious tone."
              className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-ink-200"
            />
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-ink-400">Language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200">
                <option>English</option>
                <option>Roman Urdu</option>
                <option>Urdu</option>
              </select>
              <button onClick={generateScript} disabled={!!busy} className="ml-auto rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800 disabled:opacity-40">✍ Generate script</button>
            </div>
          </div>
        </div>
      )}

      {script && (
        <div className="mt-6">
          <div className="text-sm text-ink-200 font-medium mb-2">Narration script (editable)</div>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={12} className="w-full rounded-md border border-ink-700 bg-ink-950 p-3 text-sm text-ink-200 font-mono" />
          <div className="mt-2 flex gap-2">
            <button onClick={buildVideo} disabled={!!busy} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40">🎬 Build narration video</button>
            <button onClick={() => { navigator.clipboard?.writeText(script); setNote('Script copied.') }} className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">Copy</button>
          </div>
        </div>
      )}
    </div>
  )
}
