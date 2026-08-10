/**
 * Thumbnail variants, and the one thing you cannot do by eye.
 *
 * An automated A/B test is not possible from here: YouTube exposes click-through per VIDEO
 * behind an OAuth login, never per thumbnail, and swapping the image overwrites the old
 * number. So this does the parts that ARE possible — genuinely different variants, the
 * checks that need no analytics, and the arithmetic that separates a real difference from
 * noise once the user has read two numbers off YouTube Studio.
 *
 * That last part is the reason the panel exists. "4.1% against 3.8%" looks like a result
 * and usually is not, and acting on it means changing every future thumbnail on a coin flip.
 */
import { useMemo, useState } from 'react'
import { compareVariants, testPlan } from '../../../shared/thumbnailTest'

export default function ThumbnailTestPanel({
  title,
  headline,
  script
}: {
  title: string
  headline?: string
  script?: string
}): React.JSX.Element | null {
  const [impressionsA, setImpressionsA] = useState('')
  const [clicksA, setClicksA] = useState('')
  const [impressionsB, setImpressionsB] = useState('')
  const [clicksB, setClicksB] = useState('')

  const plan = useMemo(() => testPlan({ title, headline, script }), [title, headline, script])

  const comparison = useMemo(() => {
    const nums = [impressionsA, clicksA, impressionsB, clicksB].map((v) => Number(v.replace(/[^\d]/g, '')))
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null
    return compareVariants(
      { variantId: 'the first', impressions: nums[0], clicks: nums[1] },
      { variantId: 'the second', impressions: nums[2], clicks: nums[3] }
    )
  }, [impressionsA, clicksA, impressionsB, clicksB])

  if (!title.trim()) return null

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="text-sm text-ink-100 font-medium mb-2">Test two thumbnails properly</div>

      <div className="space-y-2">
        {plan.variants.map((v) => (
          <div key={v.id} className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
            <div className="text-xs text-ink-100 font-medium">{v.headline}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">{v.why}</div>
            {v.problems.map((p) => (
              <div key={p} className="text-[11px] text-amber-300 mt-1">
                {p}
              </div>
            ))}
          </div>
        ))}
      </div>

      <details className="mt-3">
        <summary className="text-xs text-gold-500 cursor-pointer">How to run the test so the answer means something</summary>
        <ol className="mt-1.5 space-y-1 list-decimal list-inside">
          {plan.steps.map((s) => (
            <li key={s} className="text-[11px] text-ink-400">
              {s}
            </li>
          ))}
        </ol>
        {/* The trap that ruins most home-made thumbnail tests. */}
        <p className="text-[11px] text-amber-300 mt-2">{plan.warning}</p>
      </details>

      <div className="mt-3 rounded-md border border-ink-800 bg-ink-950 p-2.5">
        <div className="text-[11px] text-ink-400 mb-1.5">
          Paste the two sets of numbers from YouTube Studio → Reach and it will tell you whether the difference is real.
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['First: times shown', impressionsA, setImpressionsA],
            ['First: clicks', clicksA, setClicksA],
            ['Second: times shown', impressionsB, setImpressionsB],
            ['Second: clicks', clicksB, setClicksB]
          ].map(([label, value, set]) => (
            <input
              key={label as string}
              value={value as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder={label as string}
              inputMode="numeric"
              className="rounded-md bg-ink-900 border border-ink-700 text-ink-200 text-xs px-2 py-1.5"
            />
          ))}
        </div>
        {comparison && (
          <div
            className={`mt-2 text-xs ${
              comparison.meaningful ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {comparison.headline}
          </div>
        )}
      </div>
    </div>
  )
}
