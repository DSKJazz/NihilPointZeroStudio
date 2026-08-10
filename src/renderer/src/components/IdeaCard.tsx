import { useNavigate } from 'react-router-dom'
import { useStudio } from '../store/StudioContext'
import type { VideoIdea } from '../../../shared/types'

const scoreColor = (score: number): string => {
  if (score >= 8) return 'text-emerald-400 border-emerald-400/40'
  if (score >= 5) return 'text-gold-400 border-gold-400/40'
  return 'text-ink-400 border-ink-600'
}

const competitionLabel: Record<VideoIdea['competitionLevel'], string> = {
  low: 'Low competition',
  medium: 'Medium competition',
  high: 'High competition'
}

export default function IdeaCard({ idea }: { idea: VideoIdea }) {
  const navigate = useNavigate()
  const { setWriter } = useStudio()

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-ink-100 font-medium leading-snug">{idea.title}</h3>
        <div
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${scoreColor(
            idea.viewPotentialScore
          )}`}
        >
          {idea.viewPotentialScore}/10
        </div>
      </div>

      <p className="text-sm text-ink-400 italic">&ldquo;{idea.hook}&rdquo;</p>

      <p className="text-sm text-ink-200">{idea.angle}</p>

      <p className="text-xs text-ink-400 border-l-2 border-gold-500/40 pl-2">{idea.viewPotentialReason}</p>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {idea.contentPillars.map((tag) => (
          <span key={tag} className="rounded bg-ink-800 px-2 py-0.5 text-ink-400">
            {tag}
          </span>
        ))}
        <span className="rounded bg-ink-800 px-2 py-0.5 text-ink-400">
          {competitionLabel[idea.competitionLevel]}
        </span>
        <span className="rounded bg-ink-800 px-2 py-0.5 text-ink-400">{idea.suggestedLength}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            setWriter({
              topic: idea.title,
              ideaContext: `${idea.angle}\nHook: ${idea.hook}`,
              length: idea.suggestedLength,
              script: null,
              body: '',
              thumbnailBrief: null
            })
            navigate('/writer', { state: { idea } })
          }}
          className="flex-1 rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-sm font-medium py-1.5 transition-colors"
        >
          Write Script
        </button>
      </div>
    </div>
  )
}
