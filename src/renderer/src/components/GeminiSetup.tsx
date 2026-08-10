/**
 * Connecting Gemini — the same shape as the YouTube walkthrough, two minutes shorter.
 *
 * Google gives Gemini away through AI Studio: a free key, no card, a generous daily
 * allowance that resets by itself. The steps that live inside the user's Google account
 * become one button each; everything after the paste is automated — the key is tested
 * for real against Google, saved only on a confirmed pass (verify-then-save, never
 * save-then-hope), and every failure is one plain sentence with the page that fixes it.
 */
import { useState } from 'react'
import { cleanPastedKey, type KeyVerdict } from '../../../shared/youtubeKeySetup'
import { toast } from './Toast'

const STEPS = [
  {
    n: 1,
    title: 'Open Google AI Studio and sign in',
    detail: 'Any Google account works. This is free — no card, ever. The page may ask you to accept its terms once.',
    url: 'https://aistudio.google.com/apikey',
    buttonLabel: 'Open the key page'
  },
  {
    n: 2,
    title: 'Click "Create API key" and copy it',
    detail: 'One click makes the key; it starts with AIza. Copy it with the copy button beside it.'
  },
  {
    n: 3,
    title: 'Paste it below and press Check',
    detail: 'The app makes one real request with it and tells you plainly whether it works — and what fixes it if not.'
  }
]

function Verdict({ v }: { v: KeyVerdict }): React.JSX.Element {
  if (v.state === 'working') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
        <div className="text-xs text-emerald-300 font-medium">✓ {v.message}</div>
      </div>
    )
  }
  if (v.state === 'unknown') {
    // Amber: the app does not know, and says so — never a pass, never a fault.
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
        <div className="text-xs text-amber-300 font-medium">? {v.title}</div>
        <div className="text-[11px] text-ink-400">{v.message}</div>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 space-y-1.5">
      <div className="text-xs text-red-300 font-medium">✗ {v.title}</div>
      <div className="text-[11px] text-ink-400">{v.message}</div>
      <div className="text-[11px] text-ink-200">
        <span className="text-ink-500">What fixes it: </span>
        {v.fix}
      </div>
      {v.fixUrl && (
        <a
          href={v.fixUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md border border-gold-500/50 bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          Open the page that fixes this ↗
        </a>
      )}
    </div>
  )
}

export default function GeminiSetup({
  hasKey,
  onSaved
}: {
  hasKey: boolean
  onSaved: () => void | Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [verdict, setVerdict] = useState<KeyVerdict | null>(null)
  const [checking, setChecking] = useState(false)

  async function check(): Promise<void> {
    setChecking(true)
    setVerdict(null)
    // One cleaning, one string, used for both the check and the save — the two can
    // never disagree (the YouTube walkthrough learned this the hard way).
    const candidate = cleanPastedKey(key)
    if (key.trim() && !candidate) {
      setVerdict({
        state: 'broken',
        title: 'There is nothing usable in that box',
        message: 'What was pasted is punctuation and spaces with no key in it.',
        fix: 'Copy the key again from AI Studio — one unbroken run of letters and digits starting with AIza.'
      })
      setChecking(false)
      return
    }
    try {
      const v = await window.api.youtube.verifyGeminiKey(candidate || undefined)
      setVerdict(v)
      if (v.state === 'working' && candidate) {
        await window.api.settings.setApiKey('gemini', candidate)
        setKey('')
        await onSaved()
        toast('Gemini key saved and working — Gemini is switched on.', 'success')
      }
    } catch (err) {
      setVerdict({
        state: 'unknown',
        title: 'Could not tell',
        message: err instanceof Error ? err.message : 'The check itself failed. Nothing has been changed.'
      })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div id="gemini-setup" className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink-100 font-medium">Connect Gemini — free, about 2 minutes</div>
          <div className="text-xs text-ink-500 mt-0.5">
            Google&rsquo;s AI as a brain for the studio, through a key Google gives away free. A generous daily
            allowance, renewed automatically. No card, ever.
          </div>
        </div>
        <span className={`shrink-0 text-xs ${hasKey ? 'text-emerald-400' : 'text-amber-400'}`}>
          {hasKey ? '✓ Key saved' : 'Not set up'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          {open ? 'Hide the steps' : hasKey ? 'Change or re-check' : 'Show me how (2 minutes)'}
        </button>
        {hasKey && (
          <button
            onClick={() => void check()}
            disabled={checking}
            className="rounded-md border border-ink-700 hover:border-ink-600 disabled:opacity-50 text-ink-300 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            {checking ? 'Checking…' : 'Check the saved key'}
          </button>
        )}
      </div>

      {!open && verdict && <Verdict v={verdict} />}

      {open && (
        <div className="space-y-3 pt-1">
          <ol className="space-y-2.5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="text-xs text-ink-100 font-medium">
                  {s.n}. {s.title}
                </div>
                <div className="text-[11px] text-ink-400 mt-1 leading-relaxed">{s.detail}</div>
                {s.url && (
                  <div className="mt-2">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block rounded-md border border-gold-500/50 bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 text-xs font-medium px-3 py-1.5 transition-colors"
                    >
                      {s.buttonLabel} ↗
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value)
                  // A verdict about the previous key must not sit beside a new one.
                  setVerdict(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && key.trim() && !checking) void check()
                }}
                placeholder="Paste the key here — it starts with AIza"
                className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
              <button
                onClick={() => void check()}
                disabled={checking || (!key.trim() && !hasKey)}
                className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
              >
                {checking ? 'Checking…' : 'Check'}
              </button>
            </div>
            <div className="text-[11px] text-ink-600">
              Tested against Google before it is saved; stored encrypted on this PC only. Saving the key switches
              Gemini ON in the switchboard above.
            </div>
            {verdict && <Verdict v={verdict} />}
          </div>
        </div>
      )}
    </div>
  )
}
