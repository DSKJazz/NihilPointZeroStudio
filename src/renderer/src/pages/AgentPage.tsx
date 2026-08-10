import { useEffect, useRef, useState } from 'react'
import type { AgentPlan, AgentStep, AgentStepResult, VideoJob, VideoResolution, VideoStyle } from '../../../shared/types'
import { VIDEO_STYLES } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import BusyTimer from '../components/BusyTimer'
import { useAutosave } from '../hooks/useAutosave'
import { toast } from '../components/Toast'

import { fileUrl } from '../../../shared/mediaUrl'
import { releaseAgentRun, tryAcquireAgentRun } from '../store/agentRunLock'

const EXAMPLES = [
  'Write a 2-minute anime-style script about Pakistan\'s rupee and build it in 4K with calm music',
  'Build a cinematic video from my Script Pad at 1080p with sound effects',
  'Make a thumbnail that says MARKET MELTDOWN in a neon style',
  'Give me 5 video ideas about gold vs stocks, then write a short cartoon script on the best one and build it'
]

/** A short, human-readable one-liner describing a planned step. */
function describeStep(step: AgentStep): string {
  switch (step.type) {
    case 'write_script':
      return `📝 Write a script about "${step.topic}"${step.lengthMinutes ? ` (~${step.lengthMinutes} min)` : ''}`
    case 'build_video':
      return `🎬 Build a ${(step.resolution ?? '1080p').toUpperCase()} ${step.style ?? 'cinematic'} video (source: ${step.source}${step.aiVisuals ? ', AI visuals' : ''}${step.musicMood && step.musicMood !== 'none' ? `, ${step.musicMood} music` : ''}${step.soundEffects ? ', SFX' : ''})`
    case 'make_thumbnail':
      return `🖼 Make a ${step.style ?? 'cinematic'} thumbnail${step.aiBackground ? ' with AI background' : ''}: "${step.headline}"`
    case 'generate_image':
      return `🎨 Generate an image: "${step.prompt}"`
    case 'generate_ideas':
      return `💡 Generate ${step.count ?? 5} ideas about "${step.focus}"`
    case 'write_scriptpad':
      return `🗒 ${step.append ? 'Append to' : 'Write'} the Script Pad${step.title ? `: "${step.title}"` : ''}`
    case 'analyze_psx':
      return `📈 Analyze live PSX data for ${step.symbol}${step.makeScript ? ' + write a narration script' : ''}`
    case 'generate_music':
      return `🎵 Generate a ${step.seconds ?? 40}s ${step.mood} music bed`
    case 'plan_scenes':
      return `🎬 Plan the scene breakdown (from ${step.source ?? 'generated'} script)`
    default:
      return 'Unknown step'
  }
}

/**
 * AI Command Panel — the "just tell it what you want" tab. You type a request in plain
 * English; the active AI turns it into a plan of safe steps; you run it and watch the
 * studio write scripts, build videos, make thumbnails and generate ideas, live.
 */
export default function AgentPage(): React.JSX.Element {
  const [command, setCommand] = useState('')
  const saveStatus = useAutosave<string>('agent-command', command, (v) => setCommand(v))
  const [plan, setPlan] = useState<AgentPlan | null>(null)
  const [interpreting, setInterpreting] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [results, setResults] = useState<AgentStepResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // Batch mode
  const [batchTopics, setBatchTopics] = useState('')
  const [batchStyle, setBatchStyle] = useState<VideoStyle>('cinematic')
  const [batchRes, setBatchRes] = useState<VideoResolution>('1080p')
  const [batchAi, setBatchAi] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResults, setBatchResults] = useState<{ topic: string; ok: boolean; video?: VideoJob; error?: string }[] | null>(null)
  // "Overnight plan": same batch, but also cuts Shorts and drafts posting text per video —
  // pick topics before bed, wake up to publish-ready material instead of raw builds.
  const [overnight, setOvernight] = useState(false)
  const [shortsPerVideo, setShortsPerVideo] = useState(2)
  const [weeklyResults, setWeeklyResults] = useState<
    { topic: string; ok: boolean; videoId?: string; shorts: number; postingText?: string; error?: string }[] | null
  >(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  async function interpret(): Promise<void> {
    if (!command.trim() || interpreting || running) return
    setInterpreting(true)
    setError(null)
    setResults(null)
    setPlan(null)
    try {
      const p = await window.api.agent.interpret(command.trim())
      setPlan(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not interpret that command.')
    } finally {
      setInterpreting(false)
    }
  }

  async function run(): Promise<void> {
    if (!plan || !plan.steps.length || running) return
    // Same one-at-a-time lock the Producer/Expert widgets use: all three stream
    // over the SAME un-scoped agent:progress channel, so a widget run and a tab
    // run at once interleave stage lines into the wrong chat and race two builds.
    if (!tryAcquireAgentRun()) {
      toast('Another AI run is already in progress — wait for it to finish.', 'error')
      return
    }
    setRunning(true)
    setError(null)
    setResults(null)
    setLog([])
    setPreview(null)
    const unsubscribe = window.api.agent.onProgress((stage) => setLog((prev) => [...prev, stage]))
    // The opening-frame preview arrives on the shared video preview channel.
    const unsubPreview = window.api.video.onPreview((png) => setPreview(`${fileUrl(png)}?t=${Date.now()}`))
    try {
      const res = await window.api.agent.execute(plan)
      setResults(res.results)
      const ok = res.results.filter((r) => r.ok).length
      toast(`Done — ${ok}/${res.results.length} steps completed`, ok === res.results.length ? 'success' : 'info')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while running the plan.')
      toast('The plan failed to run', 'error')
    } finally {
      unsubscribe()
      unsubPreview()
      releaseAgentRun()
      setRunning(false)
    }
  }

  async function runBatch(): Promise<void> {
    const topics = batchTopics.split('\n').map((t) => t.trim()).filter(Boolean)
    if (!topics.length || batchRunning) return
    if (!tryAcquireAgentRun()) {
      toast('Another AI run is already in progress — wait for it to finish.', 'error')
      return
    }
    setBatchRunning(true)
    setError(null)
    setBatchResults(null)
    setWeeklyResults(null)
    setLog([])
    const unsub = window.api.agent.onProgress((stage) => setLog((prev) => [...prev, stage]))
    try {
      if (overnight) {
        const res = await window.api.weekly.planRun(topics, {
          style: batchStyle,
          resolution: batchRes,
          aiVisuals: batchAi,
          shortsPerVideo
        })
        setWeeklyResults(res.report)
        const ok = res.report.filter((r) => r.ok).length
        const shorts = res.report.reduce((n, r) => n + r.shorts, 0)
        toast(`Overnight plan done — ${ok}/${res.report.length} videos, ${shorts} short(s)`, ok ? 'success' : 'error')
      } else {
        const res = await window.api.agent.batch(topics, batchStyle, batchRes, batchAi)
        setBatchResults(res.results)
        const ok = res.results.filter((r) => r.ok).length
        toast(`Batch done — ${ok}/${res.results.length} videos built`, ok ? 'success' : 'error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch failed.')
      toast('Batch failed', 'error')
    } finally {
      unsub()
      releaseAgentRun()
      setBatchRunning(false)
    }
  }

  function copyPostingText(text: string): void {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast('Posting text copied ✓', 'success'))
        .catch(() => toast('Could not copy — select the text and press Ctrl+C', 'error'))
    } else {
      toast('Could not copy — select the text and press Ctrl+C', 'error')
    }
  }

  const busy = interpreting || running || batchRunning

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-serif text-gold-400">AI Command</h1>
        <p className="text-ink-400 text-sm mt-1">
          Tell the studio what you want in plain English. It plans the work with your active AI brain
          (free Ollama or a paid key in Settings), then does it — writing scripts, building videos, making
          thumbnails and ideas — and shows every step as it happens.
        </p>
      </header>

      <div className="rounded-lg border border-ink-800 bg-ink-900 p-4">
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void interpret()
          }}
          placeholder="e.g. Write a 90-second anime script about oil prices and build it in 4K with tense music, then make a thumbnail that says CRUDE SHOCK"
          rows={3}
          disabled={busy}
          className="w-full resize-y rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-gold-500 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void interpret()}
            disabled={busy || !command.trim()}
            className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40"
          >
            {interpreting ? 'Thinking…' : 'Plan it'}
          </button>
          {plan && plan.steps.length > 0 && (
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {running ? 'Running…' : '▶ Run it'}
            </button>
          )}
          <MicButton onText={(t) => setCommand((prev) => appendDictation(prev, t))} className="px-3 py-1" />
          {interpreting && <BusyTimer label="Planning" />}
          <span className="text-[11px] text-ink-600">Ctrl+Enter to plan · 🎤 to speak</span>
          <span className="ml-auto text-[11px] text-ink-500">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? '! not saved (disk error)' : ''}
          </span>
        </div>

        {!plan && !busy && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">Try one of these</div>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setCommand(ex)}
                  className="text-left text-xs text-ink-400 hover:text-gold-400 rounded px-2 py-1 hover:bg-ink-800"
                >
                  “{ex}”
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {/* Batch mode */}
      <details className="mt-4 rounded-lg border border-ink-800 bg-ink-900">
        <summary className="cursor-pointer px-4 py-2 text-sm text-gold-400 select-none">📦 Batch — make many videos at once</summary>
        <div className="px-4 pb-4 pt-1 space-y-2">
          <textarea
            value={batchTopics}
            onChange={(e) => setBatchTopics(e.target.value)}
            placeholder={'One topic per line — e.g.\nGold vs stocks in 2026\nWhy the rupee is falling\nHow to start investing with 10,000'}
            rows={4}
            disabled={batchRunning}
            className="w-full resize-y rounded-md bg-ink-950 border border-ink-800 px-3 py-2 text-sm text-ink-100"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
            <label className="flex items-center gap-1">
              Style
              <select value={batchStyle} onChange={(e) => setBatchStyle(e.target.value as VideoStyle)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1 capitalize">
                {VIDEO_STYLES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Resolution
              <select value={batchRes} onChange={(e) => setBatchRes(e.target.value as VideoResolution)} className="rounded bg-ink-800 border border-ink-700 px-2 py-1">
                <option value="1080p">1080p</option>
                <option value="1440p">1440p</option>
                <option value="4k">4K</option>
              </select>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={batchAi} onChange={(e) => setBatchAi(e.target.checked)} className="accent-gold-500" />
              Free AI visuals
            </label>
            <button
              onClick={() => void runBatch()}
              disabled={busy || !batchTopics.trim()}
              className="ml-auto rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40"
            >
              {batchRunning ? (overnight ? 'Running overnight plan…' : 'Making videos…') : overnight ? '🌙 Run overnight plan' : '▶ Make all'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300 rounded-md border border-gold-500/30 bg-ink-950/60 px-2 py-1.5">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={overnight} onChange={(e) => setOvernight(e.target.checked)} className="accent-gold-500" />
              <span className="text-gold-300">🌙 Overnight plan</span>
            </label>
            {overnight && (
              <label className="flex items-center gap-1">
                Shorts per video
                <select
                  value={shortsPerVideo}
                  onChange={(e) => setShortsPerVideo(Number(e.target.value))}
                  className="rounded bg-ink-800 border border-ink-700 px-2 py-1"
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <span className="text-ink-500">
              Also cuts Shorts and writes posting text for each video — pick topics, walk away, come back to
              publish-ready material.
            </span>
          </div>
          <p className="text-[10px] text-ink-600">
            Writes a script and builds a video for each line (up to 25). Each is saved in Video Studio. One failure
            won’t stop the rest.
          </p>
          {batchResults && (
            <div className="space-y-1">
              {batchResults.map((r, i) => (
                <div key={i} className={`text-xs ${r.ok ? 'text-ink-200' : 'text-red-300'}`}>
                  {r.ok ? '✓' : '✗'} {r.topic}
                  {r.error ? ` — ${r.error}` : ''}
                </div>
              ))}
            </div>
          )}
          {weeklyResults && (
            <div className="space-y-2">
              {weeklyResults.map((r, i) => (
                <div key={i} className="rounded-md border border-ink-800 bg-ink-950/60 p-2">
                  <div className={`text-xs ${r.ok ? 'text-ink-200' : 'text-red-300'}`}>
                    {r.ok ? '✓' : '✗'} {r.topic}
                    {r.ok ? ` — ${r.shorts} short(s) cut` : r.error ? ` — ${r.error}` : ''}
                  </div>
                  {r.postingText && (
                    <div className="mt-1 flex items-start gap-2">
                      <pre className="flex-1 whitespace-pre-wrap text-[11px] text-ink-400 font-sans">{r.postingText}</pre>
                      <button
                        onClick={() => copyPostingText(r.postingText as string)}
                        className="shrink-0 text-[11px] text-gold-300 hover:text-gold-200"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {plan && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-900 p-4">
          <div className="text-sm text-ink-200">{plan.reply}</div>
          {plan.steps.length > 0 ? (
            <ol className="mt-3 space-y-1.5">
              {plan.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-300">
                  <span className="text-ink-600 tabular-nums">{i + 1}.</span>
                  <span>{describeStep(step)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 text-xs text-ink-500">
              No actions were detected — the reply above is the AI's answer. Rephrase as a request
              (e.g. “write…”, “build…”, “make a thumbnail…”) to have it do something.
            </div>
          )}
        </div>
      )}

      {(running || log.length > 0) && (
        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-950 p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">
            {running ? 'Working…' : 'Progress'}
          </div>
          {preview && (
            <div className="mb-3">
              <div className="text-[11px] text-ink-500 mb-1">Live preview (opening frame):</div>
              <img src={preview} alt="preview" className="w-full max-w-sm rounded-md border border-ink-800" />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto font-mono text-xs text-ink-400 space-y-0.5">
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {results && (
        <div className="mt-6 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">Results</div>
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border p-4 ${r.ok ? 'border-ink-800 bg-ink-900' : 'border-red-900 bg-red-950/30'}`}
            >
              <div className={`text-sm font-medium ${r.ok ? 'text-ink-100' : 'text-red-300'}`}>
                {r.ok ? '✓ ' : '✗ '}
                {r.label}
              </div>
              {r.error && <div className="mt-1 text-xs text-red-400">{r.error}</div>}
              {r.detail && <div className="mt-1 text-xs text-ink-500 whitespace-pre-line">{r.detail}</div>}
              {r.type === 'generate_music' && r.path && (
                <div className="mt-3">
                  <audio src={fileUrl(r.path)} controls className="w-full max-w-md" />
                  <button
                    onClick={() => void window.api.video.reveal(r.path!)}
                    className="mt-2 rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
                  >
                    Show file
                  </button>
                </div>
              )}
              {r.video && (
                <div className="mt-3">
                  <video src={fileUrl(r.video.path)} controls className="w-full max-w-xl rounded-md bg-black" />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void window.api.video.reveal(r.video!.path)}
                      className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
                    >
                      Show file
                    </button>
                    <span className="text-[11px] text-ink-600 self-center">Also saved in Video Studio.</span>
                  </div>
                </div>
              )}
              {(r.type === 'make_thumbnail' || r.type === 'generate_image') && r.path && (
                <div className="mt-3">
                  <img src={`${fileUrl(r.path)}?t=${Date.now()}`} alt="thumbnail" className="w-full max-w-md rounded-md" />
                  <button
                    onClick={() => void window.api.video.reveal(r.path!)}
                    className="mt-2 rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
                  >
                    Show file
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
