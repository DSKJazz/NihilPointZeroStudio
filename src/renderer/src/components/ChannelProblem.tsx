/**
 * The one card that explains an empty channel result — and offers the fix.
 *
 * Before this, all three panels on Your Channel printed the same line whatever had
 * happened: *"No videos could be read. Check the YouTube key and channel ID in
 * Settings."* That sentence is wrong four times out of five. There is no key at all;
 * there is a key but no channel; Google refused it; the internet is down; or the channel
 * really is empty and everything is working perfectly. Only one of those is "check your
 * settings", and one of them is not a fault to begin with.
 *
 * The wording lives in `shared/youtubeKeySetup.ts` (with tests) so the same explanation
 * can be reused anywhere else that reads the channel, rather than being retyped slightly
 * differently in each page — which is how the five cases collapsed into one line in the
 * first place.
 */
import { Link } from 'react-router-dom'
import { describeChannelProblem, type ChannelReadProblem } from '../../../shared/youtubeKeySetup'

const TONE = {
  setup: { border: 'border-gold-500/40', bg: 'bg-gold-500/5', text: 'text-gold-300', mark: '→' },
  error: { border: 'border-red-500/40', bg: 'bg-red-500/5', text: 'text-red-300', mark: '✗' },
  // Amber, never green and never red: the app genuinely does not know.
  unknown: { border: 'border-amber-500/40', bg: 'bg-amber-500/5', text: 'text-amber-300', mark: '?' },
  info: { border: 'border-ink-700', bg: 'bg-ink-950', text: 'text-ink-200', mark: 'ℹ' }
} as const

export default function ChannelProblem({ problem }: { problem: ChannelReadProblem | null }): React.JSX.Element | null {
  if (!problem) return null
  const notice = describeChannelProblem(problem)
  const tone = TONE[notice.tone]
  return (
    <div className={`rounded-md border ${tone.border} ${tone.bg} p-3 space-y-2`}>
      <div className={`text-xs font-medium ${tone.text}`}>
        {tone.mark} {notice.title}
      </div>
      <div className="text-[11px] text-ink-400 leading-relaxed">{notice.message}</div>
      {notice.offerSetup && (
        <Link
          // The hash is not decoration: Settings is a very long page and the walkthrough is
          // far down it. Landing at the top and saying "scroll until you see it" is the
          // sort of half-step this whole change exists to delete. SettingsPage scrolls to
          // this id on arrival.
          to="/settings#youtube-setup"
          className="inline-block rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          Set it up — free, 3 minutes
        </Link>
      )}
    </div>
  )
}
