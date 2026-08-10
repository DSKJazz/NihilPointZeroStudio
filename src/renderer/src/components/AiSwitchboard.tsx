/**
 * The AI switchboard — every brain the studio can use, each with a plain ON/OFF switch
 * and one "use this one" button.
 *
 * WHY IT EXISTS. The old page only let you pick the ACTIVE brain; whether the others
 * could still be contacted as fallbacks was invisible and not yours to decide. Then the
 * hosted "free" service started demanding payment, and the only way to truly silence it
 * was a code change. The user's instruction (2026-08-07): *"in the settings, I want
 * simple buttons through which I can turn on and turn off the ones that I wanna use."*
 *
 * OFF MEANS OFF. A switched-off brain is never contacted — not as a fallback, not as a
 * safety net, not once. The active brain's switch is locked on, because choosing it is
 * the clearest possible "on".
 *
 * ChatGPT and Grok are here as honest DOORS, not integrations: they offer no free API,
 * and wiring their websites in would mean storing passwords and scraping pages that
 * change weekly. The buttons open them in the browser where the user is already signed
 * in. Gemini is the real integration — Google's AI-Studio key is genuinely free.
 */
import type { LLMProviderId, ProviderSettings } from '../../../shared/types'
import { toast } from './Toast'

const ROWS: { id: LLMProviderId; label: string; note: string }[] = [
  { id: 'ollama', label: 'Ollama — local, free forever', note: 'Runs on this PC. No internet, no account, no limit. Slower on a CPU-only machine.' },
  { id: 'gemini', label: 'Gemini — free Google key', note: 'Needs the free AI Studio key (walkthrough below). Generous free daily allowance.' },
  { id: 'free', label: 'Free online AI', note: 'The hosted service that went paid in 2026. Off unless it becomes free again.' },
  { id: 'anthropic', label: 'Claude (Anthropic) — paid', note: 'Asleep until you switch it on yourself. Never contacted while off.' },
  { id: 'openai', label: 'OpenAI — paid', note: 'Asleep until you switch it on yourself. Never contacted while off.' }
]

/** Where the free chat websites live — doors, not integrations. */
const BROWSER_DOORS = [
  { label: 'Gemini (web)', href: 'https://gemini.google.com/' },
  { label: 'ChatGPT', href: 'https://chatgpt.com/' },
  { label: 'Grok', href: 'https://grok.com/' }
]

export default function AiSwitchboard({
  settings,
  onChanged
}: {
  settings: ProviderSettings
  onChanged: (s: ProviderSettings) => void
}): React.JSX.Element {
  async function toggle(id: LLMProviderId, on: boolean): Promise<void> {
    onChanged(await window.api.settings.setProviderEnabled(id, on))
    toast(on ? `${id} switched ON.` : `${id} switched OFF — it will not be contacted at all.`, 'info')
  }

  async function makeActive(id: LLMProviderId): Promise<void> {
    // Making a brain active also switches it on — an active brain that is off would be
    // a contradiction, and the store locks the active one to ON anyway.
    await window.api.settings.setProviderEnabled(id, true)
    onChanged(await window.api.settings.setProvider(id))
    toast(`${id} is now your active brain.`, 'success')
  }

  return (
    <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
      <div>
        <div className="text-sm text-ink-100 font-medium">AI switchboard</div>
        <p className="text-xs text-ink-500 mt-0.5">
          OFF means off: a switched-off brain is never contacted, not even as a backup. The brain marked ACTIVE is
          the one that answers first; anything else that is ON may step in if it fails.
        </p>
      </div>

      <div className="space-y-2">
        {ROWS.map((row) => {
          const isActive = settings.activeProvider === row.id
          const isOn = isActive || settings.providerEnabled[row.id]
          return (
            <div key={row.id} className="rounded-md border border-ink-800 bg-ink-950 p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink-100 font-medium">
                  {row.label}
                  {isActive && <span className="ml-2 rounded bg-gold-500/20 text-gold-300 px-1.5 py-0.5 text-[10px]">ACTIVE</span>}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5">{row.note}</div>
              </div>
              {!isActive && (
                <button
                  onClick={() => void makeActive(row.id)}
                  className="shrink-0 rounded-md border border-ink-700 hover:border-gold-500/60 text-ink-300 hover:text-gold-300 text-[11px] px-2.5 py-1.5 transition-colors"
                >
                  Use this one
                </button>
              )}
              <button
                onClick={() => void toggle(row.id, !isOn)}
                disabled={isActive}
                title={isActive ? 'The active brain is always on — pick a different active brain first.' : undefined}
                className={`shrink-0 rounded-full w-14 py-1.5 text-[11px] font-medium transition-colors ${
                  isOn ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-ink-800 text-ink-500 border border-ink-700'
                } ${isActive ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {isOn ? 'ON' : 'OFF'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-md border border-ink-800 bg-ink-950 p-3">
        <div className="text-xs text-ink-100 font-medium">The free chat websites — open in your browser</div>
        <p className="text-[11px] text-ink-500 mt-0.5">
          ChatGPT and Grok give away their websites but not their machinery, so the studio cannot use them as a brain
          without storing your passwords — which it will never do. These buttons open each one in your browser, signed
          in as you.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {BROWSER_DOORS.map((d) => (
            <a
              key={d.label}
              href={d.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gold-500/50 bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 text-xs font-medium px-3 py-1.5 transition-colors"
            >
              {d.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
