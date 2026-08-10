import { useEffect, useState } from 'react'

/**
 * The "is it working or frozen?" answer: a live elapsed-time chip shown during any
 * long AI wait. Seeing the seconds tick is proof the app is alive; the honest hint
 * text sets expectations (free/local AI can take a while). Where a real cancel
 * exists (video builds have ⏹ Stop), the page shows it next to this.
 */
export default function BusyTimer({ label = 'Thinking' }: { label?: string }): React.JSX.Element {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [])

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-[11px] text-ink-300">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold-400" aria-hidden />
      {label}… {seconds}s
      {seconds >= 20 && <span className="text-ink-500">— still working (free/local AI can be slow)</span>}
    </span>
  )
}
