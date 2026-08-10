/**
 * Five different openings for the script already written, built only from its own
 * sentences.
 *
 * The first fifteen seconds decide whether the other twelve minutes get watched, and they
 * are the hardest part to judge from inside the script. Seeing the same material as a
 * contradiction, as a number, as a question, as what is at stake, and as a mid-scene
 * opening makes the choice obvious in a way staring at the draft never does.
 *
 * Nothing is invented — every option is a sentence from the script, and the sentence it
 * came from is shown, so the writer can check it rather than trust it.
 */
import { useEffect, useState } from 'react'
import { rebuildHooks, summarise, type HookCandidate, type HookForm } from '../../../shared/hookRebuild'

const FORM_LABEL: Record<HookForm, string> = {
  contradiction: 'Contradiction',
  number: 'A number',
  question: 'A question',
  stake: "What's at stake",
  'in-media-res': 'Straight into it'
}

export default function HookRebuildPanel({
  script,
  onUse
}: {
  script: string
  /** Called with the chosen opening, so the writer can drop it into the draft. */
  onUse?: (text: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<HookCandidate[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  // Pure and instant — no AI, no network. Recomputed as the draft changes.
  useEffect(() => {
    setCandidates(open ? rebuildHooks(script) : [])
  }, [script, open])

  if (!script.trim()) return null

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-100 font-medium">Rebuild the first fifteen seconds</div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
          title="Five different openings, built only from sentences already in your script — nothing invented"
        >
          {open ? 'Hide' : '✎ Show 5 openings'}
        </button>
      </div>

      {open && (
        <>
          <p className="text-xs text-ink-400 mt-2">{summarise(candidates)}</p>
          <div className="mt-3 space-y-2">
            {candidates.map((c) => (
              <div key={c.form} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] text-gold-500 font-medium">{FORM_LABEL[c.form]}</span>
                  <span className="text-[11px] text-ink-500">{c.seconds}s spoken</span>
                </div>
                <div className="text-xs text-ink-100 leading-relaxed">{c.text}</div>
                <div className="text-[11px] text-ink-500 mt-1.5">{c.rationale}</div>
                {/* The sentence it came from, so this can be CHECKED rather than trusted. */}
                {c.sourceSentence !== c.text && (
                  <div className="text-[11px] text-ink-600 mt-1 italic">from: “{c.sourceSentence}”</div>
                )}
                <div className="flex gap-2 mt-2">
                  {onUse && (
                    <button
                      onClick={() => onUse(c.text)}
                      className="rounded-md border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 text-[11px] px-2 py-1 transition-colors"
                    >
                      Put it at the top
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(c.text)
                      setCopied(c.form)
                      setTimeout(() => setCopied(null), 1500)
                    }}
                    className="rounded-md border border-ink-700 text-ink-300 hover:bg-ink-800 text-[11px] px-2 py-1 transition-colors"
                  >
                    {copied === c.form ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
