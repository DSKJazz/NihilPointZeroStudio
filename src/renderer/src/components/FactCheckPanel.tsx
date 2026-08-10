import { useState } from 'react'
import { flagUnverifiedClaims, type FactFlag } from '../../../shared/factFlags'

const KIND_LABEL: Record<FactFlag['kind'], string> = {
  figure: '💰 Figure',
  percentage: '％ Percentage',
  date: '📅 Year/Date',
  superlative: '🥇 Superlative',
  attribution: '🗣 Vague source'
}

/**
 * The fact-check flag pass: sweeps the script for claims that need a source before
 * recording — figures, percentages, dates, superlatives, "experts say". Pure and
 * offline (see shared/factFlags.ts, unit-tested); it flags, it never "verifies".
 * This channel's standard — never present unverified figures as fact — made visible.
 */
export default function FactCheckPanel({ text }: { text: string }): React.JSX.Element {
  const [flags, setFlags] = useState<FactFlag[] | null>(null)

  return (
    <details className="rounded-md border border-ink-700 bg-ink-800/60">
      <summary
        className="cursor-pointer px-3 py-1.5 text-xs text-gold-400 select-none"
        onClick={() => setFlags(flagUnverifiedClaims(text))}
      >
        🔍 Flag unverified claims{flags ? ` (${flags.length})` : ''} — check before recording
      </summary>
      <div className="p-3 space-y-1.5">
        {flags && flags.length === 0 && (
          <p className="text-[11px] text-emerald-400">
            No figures, dates, superlatives or vague attributions found. If the script SHOULD contain hard numbers,
            that itself is worth a second look.
          </p>
        )}
        {flags?.map((f, i) => (
          <div key={i} className="rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] text-amber-300">{KIND_LABEL[f.kind]}</span>
              <span className="truncate text-[11px] text-ink-200">{f.excerpt}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-ink-500">{f.advice}</p>
          </div>
        ))}
        <p className="text-[10px] text-ink-600">
          This list is a checklist, not a verdict — it finds what needs a source; only you (and the source) can
          confirm it. Re-open this panel after editing to re-scan.
        </p>
      </div>
    </details>
  )
}
