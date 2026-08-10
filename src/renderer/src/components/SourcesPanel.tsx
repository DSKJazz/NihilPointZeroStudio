/**
 * Every figure in the script, traced back to where it came from — or flagged as having
 * nowhere to trace to.
 *
 * A finance channel lives on its numbers being right. One wrong figure in a video about
 * the reserves is the comment that gets pinned, and there is no way to edit a published
 * video. The "verified data" field in the Writer already holds the numbers the user
 * looked up; nothing was reading it back to check the script against it, so a figure
 * could be pasted in and then mistyped into the narration with nothing noticing.
 *
 * It also produces the sources block for the description, which is the cheapest
 * credibility there is and the thing almost no finance channel bothers to publish.
 */
import { useMemo, useState } from 'react'
import { auditSources, sourcedFromNotes, sourcesList } from '../../../shared/sources'

export default function SourcesPanel({ script, notes }: { script: string; notes: string }): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)

  // Pure and instant — recomputed as either side is edited. No AI: whether a figure in
  // the script matches a figure in the notes has a right answer, and a model that got it
  // wrong would be trusted anyway because it sounded certain.
  const audit = useMemo(() => auditSources(script, sourcedFromNotes(notes)), [script, notes])
  const block = useMemo(() => sourcesList(audit), [audit])

  if (!script.trim()) return null

  const total = audit.cited.length + audit.uncited.length

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-ink-100 font-medium">Where your numbers came from</div>
        {block && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(block)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="The sources block for your description — the cheapest credibility there is"
          >
            {copied ? 'Copied' : 'Copy sources block'}
          </button>
        )}
      </div>

      <p className={`text-xs ${audit.fullyTraceable ? 'text-emerald-300' : total ? 'text-amber-300' : 'text-ink-400'}`}>
        {audit.headline}
      </p>

      {!notes.trim() && total > 0 && (
        <p className="text-[11px] text-ink-500 mt-1.5">
          Nothing to check against yet. Put the numbers you looked up in the “Verified data” box above, one per line
          like <span className="text-ink-300">Reserves, 2026-07-31: 11.2</span> — a <span className="text-ink-300">Source:</span>{' '}
          line applies to everything under it.
        </p>
      )}

      {audit.uncited.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-ink-300 mb-1.5">No source for these</div>
          <div className="space-y-1">
            {audit.uncited.map((u, i) => (
              <div key={`${u.raw}-${i}`} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <div className="text-xs text-amber-200">{u.raw}</div>
                <div className="text-[11px] text-ink-500 mt-0.5 italic">“{u.excerpt}”</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {audit.cited.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-ink-300 cursor-pointer">
            {audit.cited.length} figure{audit.cited.length === 1 ? '' : 's'} traced
          </summary>
          <div className="mt-1.5 space-y-1">
            {audit.cited.map((c, i) => (
              <div key={`${c.written}-${i}`} className="rounded-md border border-ink-800 bg-ink-950 p-2">
                <div className="text-xs text-ink-200">
                  {c.written}
                  {!c.exact && <span className="text-[11px] text-ink-500 ml-1.5">(your own rounding)</span>}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {c.source.label}
                  {c.source.publisher ? ` · ${c.source.publisher}` : ''}
                  {c.source.row ? ` · line ${c.source.row}` : ''}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
