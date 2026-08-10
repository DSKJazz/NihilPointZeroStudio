import { useState } from 'react'
import IdeaCard from '../components/IdeaCard'
import BusyTimer from '../components/BusyTimer'
import MicButton, { appendDictation } from '../components/MicButton'
import { confirmDialog } from '../components/Confirm'
import { useStudio } from '../store/StudioContext'

export default function IdeasPage() {
  const { ideas: state, setIdeas, clearIdeas } = useStudio()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.ideas.generate({
        focusArea: state.focusArea,
        audienceNote: state.audienceNote,
        count: state.count
      })
      setIdeas({ ideas: result })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate ideas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif text-ink-100">Ideas & Trend Mapping</h1>
          <p className="text-ink-400 text-sm mt-1">
            Generate video ideas scored for view potential, grounded in current finance & economics themes. Every
            generation is saved automatically to your Library.
          </p>
        </div>
        <button
          onClick={() => {
            void confirmDialog({
              title: 'Clear this tab?',
              message: 'This resets the Ideas inputs and clears the generated ideas on this tab. Saved library items are not affected.',
              confirmLabel: 'Clear',
              danger: true
            }).then((ok) => {
              if (ok) clearIdeas()
            })
          }}
          className="shrink-0 rounded-md border border-ink-700 hover:border-ink-500 text-ink-400 text-xs px-3 py-1.5 transition-colors"
        >
          Clear Tab
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">Focus area</label>
            {/* Functional form — a patch from the render-time value overwrote anything
                typed while the transcription ran. */}
            <MicButton onText={(t) => setIdeas((prev) => ({ focusArea: appendDictation(prev.focusArea, t) }))} />
          </div>
          <input
            value={state.focusArea}
            onChange={(e) => setIdeas({ focusArea: e.target.value })}
            placeholder="e.g. crypto for beginners, stock market, inflation, career economics"
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">Audience note (optional)</label>
            <MicButton onText={(t) => setIdeas((prev) => ({ audienceNote: appendDictation(prev.audienceNote, t) }))} />
          </div>
          <input
            value={state.audienceNote}
            onChange={(e) => setIdeas({ audienceNote: e.target.value })}
            placeholder="e.g. young professionals in Karachi/Lahore, new investors"
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-ink-400">How many ideas</label>
            <select
              value={state.count}
              onChange={(e) => setIdeas({ count: Number(e.target.value) })}
              className="mt-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
            >
              {[3, 5, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading || !state.focusArea.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            {loading ? 'Generating…' : 'Generate Ideas'}
          </button>
          {loading && <BusyTimer label="Generating ideas" />}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {state.ideas.length > 0 && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {state.ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      )}
    </div>
  )
}
