import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  DirectorAction,
  DirectorInterpretation,
  LLMProviderId,
  ProviderSettings,
  VideoJob
} from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'

const BRAIN_LABEL: Record<LLMProviderId, string> = {
  free: 'Free online AI (no key)',
  ollama: 'Free local AI (Ollama)',
  gemini: 'Gemini (free key)',
  anthropic: 'Claude (paid)',
  openai: 'OpenAI (paid)'
}

import { fileUrl } from '../../../shared/mediaUrl'

const EXAMPLES = [
  'Keep only the first 90 seconds.',
  'Remove the part from 0:20 to 0:35 and add a whoosh right there.',
  'Put a calm music bed under the whole thing, quiet.',
  'Add a riser at 5 seconds and an impact at 12 seconds.'
]

/** One-line human summary of a planned action. */
function describe(a: DirectorAction): string {
  switch (a.type) {
    case 'keep':
      return `Keep only ${a.startSec.toFixed(1)}s–${a.endSec.toFixed(1)}s`
    case 'remove':
      return `Cut out ${a.startSec.toFixed(1)}s–${a.endSec.toFixed(1)}s`
    case 'music':
      return `Add ${a.mood} music at ${a.atSec.toFixed(1)}s`
    case 'sfx':
      return `Add ${a.kind} sound at ${a.atSec.toFixed(1)}s`
  }
}

export default function DirectorPage({ embedded = false }: { embedded?: boolean } = {}): React.JSX.Element {
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [videoId, setVideoId] = useState('')
  const [instruction, setInstruction] = useState('')
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [plan, setPlan] = useState<DirectorInterpretation | null>(null)
  const [thinking, setThinking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [vids, s] = await Promise.all([window.api.video.list(), window.api.settings.get()])
      setJobs(vids as VideoJob[])
      setSettings(s as ProviderSettings)
      if ((vids as VideoJob[])[0]) setVideoId((vids as VideoJob[])[0].id)
    })()
  }, [])

  // The video the current plan was interpreted FOR. apply() must edit THIS one:
  // it used to send whatever the dropdown pointed at by apply-time, so changing
  // the selection after interpreting silently edited the wrong video.
  const planVideoIdRef = useRef<string | null>(null)

  async function interpret(): Promise<void> {
    if (!videoId || !instruction.trim()) return
    setThinking(true)
    setError(null)
    setNote(null)
    setPlan(null)
    try {
      setPlan(await window.api.director.interpret(videoId, instruction.trim()))
      planVideoIdRef.current = videoId
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI could not process that.')
    } finally {
      setThinking(false)
    }
  }

  async function apply(): Promise<void> {
    if (!plan || plan.kind !== 'edit') return
    const targetId = planVideoIdRef.current
    if (!targetId) return
    if (targetId !== videoId) {
      setError('This plan was made for a different video. Interpret again for the one now selected.')
      setPlan(null)
      return
    }
    setApplying(true)
    setError(null)
    setStage('Starting…')
    const unsub = window.api.video.onProgress((s) => setStage(s))
    try {
      const job = await window.api.director.execute(targetId, plan.actions)
      setNote(`Done — created “${job.title}”. Find it in the Video Studio tab (with Download & Trim).`)
      setPlan(null)
      setInstruction('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Applying the edits failed.')
    } finally {
      unsub()
      setApplying(false)
      setStage(null)
    }
  }

  const brain = settings ? BRAIN_LABEL[settings.activeProvider] : '…'
  // Both the local (Ollama) AND the default free online provider are free — only the
  // paid cloud providers (anthropic/openai) should read "· paid".
  const isFreeBrain = settings?.activeProvider === 'ollama' || settings?.activeProvider === 'free'

  const selectedJob = jobs.find((j) => j.id === videoId)

  return (
    <div className={embedded ? '' : 'max-w-3xl mx-auto p-8'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-serif text-ink-100">AI Director</h1>
          <p className="text-ink-400 text-sm mt-1">
            Tell it what to do to a video in plain English — cut parts out, keep a section, add music or sound effects —
            and it does the editing for you. It reads your instruction, shows you the plan, then applies it.
          </p>
        </div>
      )}

      <div className={`${embedded ? '' : 'mt-4 '}flex items-center gap-2 text-[11px]`}>
        <span className={`rounded-full px-2 py-0.5 ${isFreeBrain ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gold-500/15 text-gold-300'}`}>
          Brain: {brain}{isFreeBrain ? ' · free' : ' · paid'}
        </span>
        <Link to="/settings" className="text-ink-400 hover:text-ink-200 underline">
          Change brain in Settings
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div>
          <label className="text-xs text-ink-400">Which video?</label>
          {jobs.length ? (
            <select
              value={videoId}
              onChange={(e) => setVideoId(e.target.value)}
              className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 text-[11px] text-ink-500">
              No built videos yet. Make one in the Video Studio tab, then come back here to edit it by voice/text.
            </p>
          )}
          {selectedJob && (
            <video
              key={selectedJob.id}
              src={fileUrl(selectedJob.path)}
              controls
              preload="metadata"
              className="mt-2 w-full max-h-56 rounded-md bg-black"
            />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">Your instruction</label>
            <MicButton onText={(t) => setInstruction((prev) => appendDictation(prev, t))} />
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="e.g. Remove 0:20 to 0:35, add a whoosh there, and put calm music underneath."
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setInstruction(ex)}
                className="rounded border border-ink-700 hover:border-ink-500 text-[10px] text-ink-400 px-1.5 py-0.5"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={interpret}
          disabled={thinking || !videoId || !instruction.trim()}
          className="w-full rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
        >
          {thinking ? 'Thinking…' : '🧠 Interpret my instruction'}
        </button>

        {plan && (
          <div className="rounded-md border border-ink-700 bg-ink-800 p-3 space-y-2">
            <p className="text-sm text-ink-200">{plan.explanation}</p>
            {plan.kind === 'edit' ? (
              <>
                <ul className="text-[12px] text-ink-300 list-disc pl-5 space-y-0.5">
                  {plan.actions.map((a, i) => (
                    <li key={i}>{describe(a)}</li>
                  ))}
                </ul>
                <button
                  onClick={apply}
                  disabled={applying}
                  className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-4 py-2 text-sm transition-colors"
                >
                  {applying ? 'Applying…' : '✅ Do it (creates a new video)'}
                </button>
              </>
            ) : (
              <p className="text-[11px] text-ink-500">
                (No edit was detected — that was answered as a question. Rephrase as a command to edit the video.)
              </p>
            )}
          </div>
        )}

        {applying && stage && (
          <div className="flex items-center gap-2 rounded-md border border-gold-500/30 bg-gold-500/5 px-3 py-2">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold-400" />
            <span className="text-[11px] text-gold-300/90">{stage}</span>
          </div>
        )}
        {note && <p className="text-[11px] text-emerald-400">{note}</p>}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
            {settings?.activeProvider === 'ollama' && (
              <span className="block mt-1 text-ink-500">
                Tip: the free brain needs Ollama running (see the guide). Or switch to a paid brain in Settings.
              </span>
            )}
          </div>
        )}
        <p className="text-[10px] text-ink-600">
          The AI only chooses from safe, tested actions (cut / keep / add music / add sound). Your original video is
          always kept — edits create a new video.
        </p>
      </div>
    </div>
  )
}
