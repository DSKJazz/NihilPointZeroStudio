import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { GeneratedScript, LanguageMix, ScriptLength, ScriptStyle, VideoIdea, VideoStyle } from '../../../shared/types'
import { VIDEO_STYLES } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import BusyTimer from '../components/BusyTimer'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Confirm'
import { useStudio } from '../store/StudioContext'
import { useProducerTarget } from '../store/ProducerContext'

import { fileUrl } from '../../../shared/mediaUrl'
import HookRebuildPanel from '../components/HookRebuildPanel'
import SourcesPanel from '../components/SourcesPanel'
import DualLanguagePanel from '../components/DualLanguagePanel'
import ThumbnailTestPanel from '../components/ThumbnailTestPanel'
import ReadAloudPanel from '../components/ReadAloudPanel'
import RepurposePanel from '../components/RepurposePanel'

const lengthOptions: { value: ScriptLength; label: string }[] = [
  { value: 'short', label: 'Short (6-8 min)' },
  { value: 'long', label: 'Long-form (12-17 min)' },
  { value: 'deep-dive', label: 'Deep dive (20-28 min)' },
  { value: 'feature-90', label: 'Feature (~90 min)' },
  { value: 'feature-180', label: 'Masterclass (~180 min)' }
]

const FEATURE_LENGTHS: ScriptLength[] = ['feature-90', 'feature-180']

const languageOptions: { value: LanguageMix; label: string }[] = [
  { value: 'balanced', label: 'Balanced Roman Urdu + English' },
  { value: 'mostly-english', label: 'Mostly English' },
  { value: 'mostly-roman-urdu', label: 'Mostly Roman Urdu' },
  { value: 'formal-urdu', label: 'Formal Urdu (script)' }
]

const styleOptions: { value: ScriptStyle; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'deep-dive', label: 'Deep Dive' },
  { value: 'masterclass', label: 'Masterclass' },
  { value: 'institutional-framework', label: 'Institutional Framework' },
  { value: 'financial-research', label: 'Financial Research' },
  { value: 'technical-charting', label: 'Technical Charting' },
  { value: 'fundamental-deep-dive', label: 'Fundamental Deep Dive' },
  { value: 'infotainment', label: 'Infotainment' },
  { value: 'normal', label: 'Normal' },
  { value: 'hooking', label: 'Hooking' }
]

export default function WriterPage() {
  const location = useLocation()
  const incomingIdea = (location.state as { idea?: VideoIdea } | null)?.idea
  const { writer, setWriter, clearWriter, setScene, saveStatus } = useStudio()

  // Expose the script body to the global YouTube Producer for grounded suggestions/rewrites.
  useProducerTarget({
    label: 'Script Writer',
    kind: 'script',
    text: writer.body,
    apply: (next) => setWriter({ body: next })
  })

  // When arriving via an idea's "Write Script" button, seed the writer fields from it.
  useEffect(() => {
    if (incomingIdea) {
      setWriter({
        topic: incomingIdea.title,
        ideaContext: `${incomingIdea.angle}\nHook: ${incomingIdea.hook}`,
        length: incomingIdea.suggestedLength
      })
      setScene((prev) => ({
        title: incomingIdea.title,
        body: prev.body || ''
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingIdea?.id])

  useEffect(() => {
    setScene((prev) => {
      const shouldUpdateTitle =
        prev.title === '' || prev.title === writer.topic || prev.title === writer.script?.title
      const shouldUpdateBody = prev.body === '' || prev.body === writer.body
      if (!shouldUpdateTitle && !shouldUpdateBody) return prev
      return {
        title: shouldUpdateTitle ? writer.script?.title || writer.topic : prev.title,
        body: shouldUpdateBody ? writer.body : prev.body
      }
    })
  }, [writer.body, writer.script?.title, writer.topic, setScene])

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiceoverStatus, setVoiceoverStatus] = useState<string | null>(null)
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false)
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false)
  const [thumbHeadline, setThumbHeadline] = useState('')
  const [thumbStyle, setThumbStyle] = useState<VideoStyle>('cinematic')
  const [thumbImage, setThumbImage] = useState<string | null>(null)
  const [renderingThumb, setRenderingThumb] = useState(false)
  const [thumbSaveNote, setThumbSaveNote] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [psxUrl, setPsxUrl] = useState('')
  const [psxStatus, setPsxStatus] = useState<string | null>(null)
  const [fetchingPsx, setFetchingPsx] = useState(false)
  const [correlateStatus, setCorrelateStatus] = useState<string | null>(null)
  const [correlating, setCorrelating] = useState(false)

  function toggleStyle(style: ScriptStyle): void {
    const has = writer.styles.includes(style)
    const next = has ? writer.styles.filter((s) => s !== style) : [...writer.styles, style]
    setWriter({ styles: next.length ? next : ['standard'] })
  }

  function appendVerified(block: string): void {
    setWriter({ verifiedData: writer.verifiedData.trim() ? `${writer.verifiedData.trim()}\n\n${block}` : block })
  }

  async function handleGenerate(): Promise<void> {
    setLoading(true)
    setError(null)
    setProgress(null)
    // Feature-length runs emit chaptering stages (outline → section N/total) over IPC.
    // Subscribe for the duration of this generation and tear it down in finally.
    const unsubscribe = window.api.script.onProgress((stage) => setProgress(stage))
    try {
      const result: GeneratedScript = await window.api.script.generate({
        topic: writer.topic,
        ideaContext: writer.ideaContext || undefined,
        audienceNote: writer.audienceNote || undefined,
        verifiedData: writer.verifiedData || undefined,
        length: writer.length,
        languageMix: writer.languageMix,
        styles: writer.styles
      })
      setWriter({ script: result, body: result.body, thumbnailBrief: null })
      setScene({ title: result.title || writer.topic, body: result.body })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate script')
    } finally {
      unsubscribe()
      setLoading(false)
      setProgress(null)
    }
  }

  async function handleExport(): Promise<void> {
    if (!writer.script) return
    const fileName = `${writer.script.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`
    try {
      const res = await window.api.exportText(fileName, `${writer.script.title}\n\n${writer.body}`)
      if (res.saved) toast(`Exported to ${res.path}`, 'success')
      else if (res.error) toast(`Export failed: ${res.error}`, 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    }
  }

  async function handleImportFile(): Promise<void> {
    setImporting(true)
    setImportStatus(null)
    try {
      const result = await window.api.data.importFile()
      if (result.canceled) return
      if (result.error) {
        setImportStatus(result.error)
        return
      }
      if (result.analysis) {
        appendVerified(`--- ${result.analysis.fileName} (${result.analysis.kind} analysis) ---\n${result.analysis.summary}`)
        setImportStatus(`Imported and analyzed ${result.analysis.fileName}.`)
      }
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function handleFetchPsx(): Promise<void> {
    if (!psxUrl.trim()) return
    setFetchingPsx(true)
    setPsxStatus(null)
    try {
      const result = await window.api.data.fetchPsxDocument(psxUrl.trim())
      if (result.canceled) return
      if (result.error) {
        setPsxStatus(result.error)
        return
      }
      if (result.analysis) {
        appendVerified(
          `--- ${result.analysis.fileName} (${result.analysis.kind} analysis, fetched from PSX) ---\n${result.analysis.summary}`
        )
        setPsxStatus(`Fetched and analyzed ${result.analysis.fileName}.`)
      } else {
        setPsxStatus(`Saved to ${result.savedPath}. (Not a spreadsheet, so no automatic analysis — open it directly.)`)
      }
      setPsxUrl('')
    } catch (err) {
      setPsxStatus(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setFetchingPsx(false)
    }
  }

  async function handleCorrelate(): Promise<void> {
    setCorrelating(true)
    setCorrelateStatus(null)
    try {
      const result = await window.api.data.correlateFlowPrice()
      if (result.canceled) return
      if (result.error) {
        setCorrelateStatus(result.error)
        return
      }
      if (result.summary) {
        appendVerified(`--- NCCPL flow vs PSX price correlation ---\n${result.summary}`)
        setCorrelateStatus('Correlation computed and added to verified data below.')
      }
    } catch (err) {
      setCorrelateStatus(err instanceof Error ? err.message : 'Correlation failed')
    } finally {
      setCorrelating(false)
    }
  }

  async function handleGenerateThumbnail(): Promise<void> {
    if (!writer.script) return
    setGeneratingThumbnail(true)
    setWriter({ thumbnailBrief: null })
    try {
      const brief = await window.api.script.generateThumbnail(writer.script.topic, writer.script.title)
      setWriter({ thumbnailBrief: brief })
    } catch (err) {
      setWriter({ thumbnailBrief: err instanceof Error ? err.message : 'Thumbnail brief generation failed' })
    } finally {
      setGeneratingThumbnail(false)
    }
  }

  async function handleRenderThumbnail(): Promise<void> {
    const headline = (thumbHeadline.trim() || writer.script?.title || '').trim()
    if (!headline) return
    setRenderingThumb(true)
    setThumbSaveNote(null)
    setThumbImage(null)
    try {
      const path = await window.api.script.renderThumbnail(headline, thumbStyle)
      // Cache-bust so the <img> reloads even if the path is reused.
      setThumbImage(`${fileUrl(path)}?t=${Date.now()}`)
    } catch (err) {
      setThumbSaveNote(err instanceof Error ? err.message : 'Thumbnail render failed')
    } finally {
      setRenderingThumb(false)
    }
  }

  async function handleSaveThumbnail(): Promise<void> {
    if (!thumbImage) return
    const src = decodeURI(thumbImage.replace(/^file:\/\/\//, '').replace(/\?t=\d+$/, ''))
    try {
      const res = await window.api.script.saveThumbnail(src)
      // Cancel and failure must not look identical to "the button did nothing".
      setThumbSaveNote(res.saved ? `Saved to ${res.path}` : 'Save cancelled.')
    } catch (err) {
      setThumbSaveNote(err instanceof Error ? err.message : 'Could not save the thumbnail.')
    }
  }

  async function handleGenerateVoiceover(): Promise<void> {
    if (!writer.script) return
    setGeneratingVoiceover(true)
    setVoiceoverStatus(null)
    try {
      const fileName = `${writer.script.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`
      const result = await window.api.script.generateVoiceover(writer.body, fileName)
      setVoiceoverStatus(result.saved ? `Saved to ${result.path}` : 'Cancelled')
    } catch (err) {
      setVoiceoverStatus(err instanceof Error ? err.message : 'Voiceover generation failed')
    } finally {
      setGeneratingVoiceover(false)
    }
  }

  const liveWordCount = writer.body.trim() ? writer.body.trim().split(/\s+/).length : 0

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-serif text-ink-100">Script Writer</h1>
            <span className="text-[11px] text-ink-500">{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}</span>
          </div>
          <p className="text-ink-400 text-sm mt-1">
            Institutional-grade scripts, multi-style. Your work auto-saves and survives restart.
          </p>
        </div>
        <button
          onClick={() => {
            void confirmDialog({
              title: 'Clear this tab?',
              message: 'This resets the Writer inputs and clears the current script draft on this tab. Anything you saved to the Library is not affected.',
              confirmLabel: 'Clear',
              danger: true
            }).then((ok) => {
              if (ok) clearWriter()
            })
          }}
          className="shrink-0 rounded-md border border-ink-700 hover:border-ink-500 text-ink-400 text-xs px-3 py-1.5 transition-colors"
        >
          Clear Tab
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Topic</label>
                {/* Functional form: the transcript arrives async, so a patch built from
                    the render-time value overwrote anything typed while the mic ran. */}
                <MicButton onText={(t) => setWriter((prev) => ({ topic: appendDictation(prev.topic, t) }))} />
              </div>
              <textarea
                value={writer.topic}
                onChange={(e) => setWriter({ topic: e.target.value })}
                rows={2}
                placeholder="e.g. Why Pakistan's rupee keeps devaluing"
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Angle / context (optional)</label>
                <MicButton onText={(t) => setWriter((prev) => ({ ideaContext: appendDictation(prev.ideaContext, t) }))} />
              </div>
              <textarea
                value={writer.ideaContext}
                onChange={(e) => setWriter({ ideaContext: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Audience note (optional)</label>
                <MicButton onText={(t) => setWriter((prev) => ({ audienceNote: appendDictation(prev.audienceNote, t) }))} />
              </div>
              <input
                value={writer.audienceNote}
                onChange={(e) => setWriter({ audienceNote: e.target.value })}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-ink-400">Verified numbers / sources (optional)</label>
                <MicButton onText={(t) => setWriter((prev) => ({ verifiedData: appendDictation(prev.verifiedData, t) }))} />
              </div>
              <textarea
                value={writer.verifiedData}
                onChange={(e) => setWriter({ verifiedData: e.target.value })}
                rows={3}
                placeholder={'e.g. USD/PKR = 278.5 (SBP, July 2026)\nPolicy rate = 11%\nPaste real figures you\'ve checked yourself — the AI will only use these specific numbers instead of guessing.'}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
              <button
                onClick={handleImportFile}
                disabled={importing}
                className="mt-1.5 w-full rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'Analyzing…' : 'Import & Analyze File (CSV/Excel, technical + fundamental)'}
              </button>
              {importStatus && <p className="text-[11px] text-ink-500 mt-1">{importStatus}</p>}

              <div className="mt-2 flex gap-1.5">
                <input
                  value={psxUrl}
                  onChange={(e) => setPsxUrl(e.target.value)}
                  placeholder="Paste a psx.com.pk document link…"
                  className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-2 py-1.5 text-xs text-ink-100 outline-none focus:border-gold-500"
                />
                <button
                  onClick={handleFetchPsx}
                  disabled={fetchingPsx || !psxUrl.trim()}
                  className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {fetchingPsx ? 'Fetching…' : 'Fetch from PSX'}
                </button>
              </div>
              <p className="text-[10px] text-ink-600 mt-1">
                Fetches exactly the one document you link to (psx.com.pk only) — for personal reference, per PSX's
                own terms. Not a crawler; it won't browse the site on its own.
              </p>
              {/* break-all: this can contain a full absolute Windows path, which is one
                  unbreakable token — without it the ~315px column forced the whole
                  page to scroll horizontally. */}
              {psxStatus && <p className="text-[11px] text-ink-500 mt-1 break-all">{psxStatus}</p>}

              <button
                onClick={handleCorrelate}
                disabled={correlating}
                className="mt-2 w-full rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {correlating ? 'Correlating…' : 'Correlate NCCPL Flow vs PSX Price (Backtest)'}
              </button>
              <p className="text-[10px] text-ink-600 mt-1">
                Prompts for a flow file (NCCPL FIPI/LIPI, downloaded by you) then a price file — computes real
                correlation and hit-rate statistics between them.
              </p>
              {correlateStatus && <p className="text-[11px] text-ink-500 mt-1">{correlateStatus}</p>}
            </div>

            <div>
              <label className="text-xs text-ink-400">Styles (select one or more — they blend)</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {styleOptions.map((opt) => {
                  const active = writer.styles.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleStyle(opt.value)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        active
                          ? 'border-gold-500 bg-gold-500/15 text-gold-400'
                          : 'border-ink-700 text-ink-400 hover:border-ink-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-ink-400">Length</label>
              <select
                value={writer.length}
                onChange={(e) => setWriter({ length: e.target.value as ScriptLength })}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                {lengthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {FEATURE_LENGTHS.includes(writer.length) && (
                <p className="text-[10px] text-gold-400/80 mt-1">
                  Feature-length writes chapter-by-chapter (outline → sections → stitched). On the free local model
                  this can take a long time (many minutes to well over an hour on a CPU-only machine). A cloud
                  provider in Settings is far faster for these.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-ink-400">Language mix</label>
              <select
                value={writer.languageMix}
                onChange={(e) => setWriter({ languageMix: e.target.value as LanguageMix })}
                className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              >
                {languageOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !writer.topic.trim()}
              className="w-full rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
            >
              {loading ? 'Writing…' : 'Generate Script'}
            </button>
            {loading && progress && (
              <div className="flex items-center gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold-400" />
                <span className="text-[11px] text-gold-300/90 leading-snug">{progress}</span>
              </div>
            )}
            {loading && !progress && <BusyTimer label="Writing the script" />}
          </div>
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {writer.script ? (
            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 flex flex-col h-full">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-medium text-ink-100">{writer.script.title}</h2>
                <div className="text-xs text-ink-400 shrink-0 text-right">
                  {liveWordCount} words · ~{Math.round((liveWordCount / 150) * 10) / 10} min
                </div>
              </div>
              <textarea
                value={writer.body}
                onChange={(e) => setWriter({ body: e.target.value })}
                className="mt-3 flex-1 min-h-[420px] w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-3 text-sm text-ink-100 leading-relaxed outline-none focus:border-gold-500 font-serif"
              />
              <div className="flex flex-wrap gap-2 mt-3 items-center">
                {/* Honest label: only the ORIGINAL generated script is in the Library;
                    edits made in this box live in this tab's autosave, not the Library.
                    The old "Auto-saved to Library ✓" claimed edits were saved there too. */}
                <span className="text-xs text-emerald-400" title="The original generated script is in the Library. Edits you make here are kept in this tab's autosave (they survive restart) but do not update the Library copy.">
                  Original in Library ✓ · edits kept here
                </span>
                <button
                  onClick={handleExport}
                  className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors"
                >
                  Export .txt
                </button>
                <button
                  onClick={handleGenerateVoiceover}
                  disabled={generatingVoiceover}
                  className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingVoiceover ? 'Generating audio…' : 'Generate Voiceover (Free)'}
                </button>
                <button
                  onClick={handleGenerateThumbnail}
                  disabled={generatingThumbnail}
                  className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-sm px-4 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingThumbnail ? 'Designing…' : 'Thumbnail Brief'}
                </button>
              </div>

              {/* One wrong figure is the comment that gets pinned, and a published video
                  cannot be edited. This reads the "Verified data" box back against the
                  script — the field existed, nothing was checking against it. */}
              <div className="mt-3">
                <SourcesPanel script={writer.body} notes={writer.verifiedData ?? ''} />
              </div>

              {/* The first fifteen seconds decide whether the rest gets watched, and they
                  are the hardest part to judge from inside the draft. */}
              <div className="mt-3">
                <HookRebuildPanel
                  script={writer.body}
                  onUse={(hook) => setWriter({ body: `${hook}\n\n${writer.body}` })}
                />
              </div>

              {/* Proof it by ear before recording it. A script is spoken, not read, and
                  silent reading hides exactly the faults that cost a retake. */}
              <div className="mt-3">
                <ReadAloudPanel script={writer.body} />
              </div>

              {/* Thumbnail variants, plus the arithmetic that tells a real difference from
                  noise. An automated A/B test is not possible — YouTube exposes no
                  per-thumbnail figure — and the panel says so rather than pretending. */}
              <div className="mt-3">
                <ThumbnailTestPanel
                  title={writer.script?.title ?? ''}
                  headline={thumbHeadline}
                  script={writer.body}
                />
              </div>

              {/* Both languages, with the codes right. Roman Urdu is ur-Latn, not en and
                  not ur, and getting that wrong quietly costs reach. */}
              <div className="mt-3">
                <DualLanguagePanel title={writer.script?.title ?? ''} description={writer.body} />
              </div>

              {/* One script, everywhere it needs to go. Runs in the page — no AI, no
                  internet, instant. See components/RepurposePanel.tsx. */}
              <RepurposePanel title={writer.script.title} body={writer.body} />
              <p className="text-[11px] text-ink-500 mt-2">
                Want a narrated video of this script? Head to the <span className="text-gold-400">Video Studio</span>{' '}
                tab — this draft is available there.
              </p>
              {voiceoverStatus && <p className="text-xs text-ink-400 mt-2">{voiceoverStatus}</p>}
              {writer.thumbnailBrief && (
                <div className="mt-3 rounded-md border border-ink-700 bg-ink-800 p-3">
                  <div className="text-xs text-gold-400 font-medium mb-1">Thumbnail Brief (AI idea)</div>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-ink-200 leading-relaxed">
                    {writer.thumbnailBrief}
                  </pre>
                </div>
              )}

              {/* Real, downloadable thumbnail IMAGE generator (free, offline). */}
              <div className="mt-3 rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gold-400 font-medium">Thumbnail Image (free, downloadable)</div>
                  <MicButton onText={(t) => setThumbHeadline((prev) => appendDictation(prev, t))} />
                </div>
                <input
                  value={thumbHeadline}
                  onChange={(e) => setThumbHeadline(e.target.value)}
                  placeholder={writer.script?.title || 'Punchy thumbnail headline'}
                  className="w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={thumbStyle}
                    onChange={(e) => setThumbStyle(e.target.value as VideoStyle)}
                    className="rounded-md bg-ink-900 border border-ink-700 px-2 py-1.5 text-xs text-ink-100 outline-none focus:border-gold-500 capitalize"
                  >
                    {VIDEO_STYLES.map((s) => (
                      <option key={s} value={s} className="capitalize">
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleRenderThumbnail}
                    disabled={renderingThumb}
                    className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
                  >
                    {renderingThumb ? 'Rendering…' : '🖼 Generate image'}
                  </button>
                  {thumbImage && (
                    <button
                      onClick={handleSaveThumbnail}
                      className="rounded-md border border-ink-600 hover:border-ink-400 text-ink-200 text-xs px-3 py-1.5 transition-colors"
                    >
                      ⬇ Download PNG
                    </button>
                  )}
                </div>
                {thumbImage && (
                  <img src={thumbImage} alt="Generated thumbnail" className="w-full rounded-md border border-ink-700" />
                )}
                {thumbSaveNote && <p className="text-[11px] text-emerald-400 break-all">{thumbSaveNote}</p>}
                <p className="text-[10px] text-ink-600">
                  Leave the headline blank to use your title. This makes a real 1280×720 PNG (styled text on a themed
                  background) you can upload to YouTube — free and offline.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-ink-700 h-full min-h-[420px] flex items-center justify-center text-ink-600 text-sm">
              Your generated script will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
