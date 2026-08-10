import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  ollama: 'Ollama (local)'
}

const noticeKey = (n: { provider: string; detail: string }): string =>
  `${n.provider}|${n.detail.slice(0, 80)}`

/**
 * Mounted once in App. Shows a warning strip whenever the chosen paid/local AI
 * failed and the free fallback answered — so the downgrade is never silent
 * (a silent downgrade just looks like "the AI got dumb").
 */
export default function FallbackBanner(): React.JSX.Element | null {
  const [notice, setNotice] = useState<{ provider: string; detail: string } | null>(null)
  // Remembers the last dismissed failure so a long batch run (which can emit one
  // event per scene) doesn't resurrect the banner the user just closed. A DIFFERENT
  // failure still shows immediately; the same one shows again after 10 minutes.
  const dismissed = useRef<{ key: string; at: number } | null>(null)

  useEffect(() => {
    const off = window.api.ai.onFallback((n) => {
      const d = dismissed.current
      if (d && d.key === noticeKey(n) && Date.now() - d.at < 10 * 60_000) return
      setNotice(n)
    })
    return () => {
      off()
    }
  }, [])

  if (!notice) return null
  const dismiss = (): void => {
    dismissed.current = { key: noticeKey(notice), at: Date.now() }
    setNotice(null)
  }
  const label = PROVIDER_LABEL[notice.provider] ?? notice.provider
  const hint =
    notice.provider === 'ollama'
      ? 'Is Ollama installed and running on this computer?'
      : 'Usually a wrong, expired, or out-of-credit API key.'
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] w-full max-w-2xl rounded-md border border-amber-600 bg-amber-950/95 px-4 py-2 text-sm text-amber-100 shadow-lg">
      <div className="flex items-start gap-3">
        <span aria-hidden>⚠</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            Your {label} AI failed — this answer came from the free AI instead.
          </div>
          <div className="mt-0.5 break-all text-xs text-amber-300/80">
            {notice.detail.length > 200 ? notice.detail.slice(0, 200) + '…' : notice.detail}
          </div>
          <div className="mt-1 text-xs">
            {hint}{' '}
            <Link to="/settings" className="underline" onClick={dismiss}>
              Open Settings
            </Link>{' '}
            to fix it. Details are kept in the Activity Log.
          </div>
        </div>
        <button
          onClick={dismiss}
          className="rounded px-2 py-0.5 text-amber-300 hover:bg-amber-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
