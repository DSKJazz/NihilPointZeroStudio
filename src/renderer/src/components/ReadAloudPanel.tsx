/**
 * Hear the script read out at speed, before you record it.
 *
 * The plan appears instantly — it is arithmetic, not audio — so the user sees what to
 * listen for and how long it will take before deciding to generate anything. Generating
 * the audio is the slow, optional second step.
 */
import { useEffect, useState } from 'react'
import { fileUrl } from '../../../shared/mediaUrl'
import { DEFAULT_SPEED, SPEED_CHOICES, formatDuration, type ProofKind, type ReadAloudPlan } from '../../../shared/readAloud'

const KIND_LABEL: Record<ProofKind, string> = {
  unsayable: 'Too long to say',
  breath: 'One breath',
  repeat: 'Said twice',
  number: 'Hard to say',
  tongue: 'Same sound',
  'mixed-language': 'Two languages'
}

const KIND_COLOUR: Record<ProofKind, string> = {
  unsayable: 'text-red-400',
  breath: 'text-amber-400',
  repeat: 'text-amber-400',
  number: 'text-amber-400',
  tongue: 'text-ink-400',
  'mixed-language': 'text-ink-400'
}

function clock(seconds: number): string {
  const t = Math.max(0, Math.round(seconds))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export default function ReadAloudPanel({ script }: { script: string }): React.JSX.Element {
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED)
  const [plan, setPlan] = useState<ReadAloudPlan | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [engine, setEngine] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The plan is instant, so it refreshes as the script and speed change — no button.
  useEffect(() => {
    let alive = true
    void window.api.readAloud
      .plan(script, speed)
      .then((p) => {
        if (alive) setPlan(p)
      })
      .catch(() => {
        /* an older build without the handler must not break the page */
      })
    return () => {
      alive = false
    }
  }, [script, speed])

  // A speed change invalidates the file that was made at the old speed.
  useEffect(() => {
    setAudioUrl(null)
  }, [speed])

  async function speak(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.readAloud.speak(script, speed, 'natural')
      if (res.ok) {
        // fileUrl() here, in the page — that is what makes this play on the phone too.
        setAudioUrl(`${fileUrl(res.path)}${fileUrl(res.path).includes('?') ? '&' : '?'}t=${Date.now()}`)
        setEngine(res.engineName)
        setPlan(res.plan)
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the script aloud.')
    } finally {
      setBusy(false)
    }
  }

  const hasScript = script.trim().length > 0

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-ink-100 font-medium">Read it to me</div>
        <div className="flex items-center gap-2">
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md bg-ink-950 border border-ink-700 text-ink-200 text-xs px-2 py-1.5"
            title="Double speed is the sweet spot: quick enough to actually do, slow enough that nothing is missed"
          >
            {SPEED_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s}×{s === DEFAULT_SPEED ? ' (best)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => void speak()}
            disabled={busy || !hasScript}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="Speaks the script with the offline voice, then speeds the recording up without making it squeaky"
          >
            {busy ? 'Speaking…' : '🔊 Read it aloud'}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-400">
        {plan?.headline ?? 'Write some script and this will tell you what to listen for.'}
      </p>

      {audioUrl && (
        <div className="mt-3">
          <audio src={audioUrl} controls autoPlay className="w-full h-9" />
          {engine && <div className="text-[11px] text-ink-600 mt-1">Spoken by {engine}.</div>}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}

      {plan && plan.notes.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {plan.notes.map((n, i) => (
            <div key={`${n.sentence}-${n.kind}-${i}`} className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
              <div className="flex items-center gap-2 mb-1">
                {/* The timestamp is in PLAYBACK time, so it matches the audio scrubber. */}
                <span className="text-[11px] text-ink-500 tabular-nums">{clock(n.atSecond / plan.speed)}</span>
                <span className={`text-[11px] font-medium ${KIND_COLOUR[n.kind]}`}>{KIND_LABEL[n.kind]}</span>
              </div>
              <div className="text-xs text-ink-300">{n.note}</div>
              <div className="text-[11px] text-ink-500 mt-1 italic">“{n.text}”</div>
            </div>
          ))}
        </div>
      )}

      {plan && plan.sentences.length > 0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          {plan.sentences.length} sentences · {formatDuration(plan.scriptSeconds)} spoken at normal speed
        </div>
      )}
    </div>
  )
}
