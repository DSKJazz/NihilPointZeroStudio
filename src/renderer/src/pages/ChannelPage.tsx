/**
 * What YOUR channel says — not what channels in general say.
 *
 * "Use numbers in titles." "Post at 6pm." That is an average across millions of channels
 * that are not this one, aimed at an audience that is not this one. The only data that
 * describes a Pakistani finance audience watching in Roman Urdu is already sitting in
 * this channel's own history, and nothing was reading it.
 *
 * Three questions, one fetch:
 *   - which title SHAPES have actually worked here
 *   - when do these videos really get watched
 *   - which videos form a series, and are they numbered properly
 * Plus the questions the comments keep asking, which is the cheapest video-idea source
 * there is and the only one no competitor can copy.
 *
 * Every number shown is computed from the fetched table and carries the sample size it
 * came from. Nothing here asks a model, because a fluent wrong answer would change how
 * the user titles videos for a year.
 */
import { useState } from 'react'
import { formatHour } from '../../../shared/channelLearning'
import { seriesHeadline, seriesLinks, type Series } from '../../../shared/series'
import type { QuestionCluster } from '../../../shared/commentMining'
import ChannelProblem from '../components/ChannelProblem'

type Learned = Awaited<ReturnType<typeof window.api.channel.learn>>
type Mined = Awaited<ReturnType<typeof window.api.channel.comments>>
type Gaps = Awaited<ReturnType<typeof window.api.channel.gaps>>

export default function ChannelPage(): React.JSX.Element {
  const [learned, setLearned] = useState<Learned | null>(null)
  const [mined, setMined] = useState<Mined | null>(null)
  const [gaps, setGaps] = useState<Gaps | null>(null)
  const [busy, setBusy] = useState<'learn' | 'comments' | 'gaps' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [score, setScore] = useState<Awaited<ReturnType<typeof window.api.channel.scoreTitle>> | null>(null)
  const [scoring, setScoring] = useState(false)
  const [openSeries, setOpenSeries] = useState<Series | null>(null)

  async function run(which: 'learn' | 'comments' | 'gaps'): Promise<void> {
    setBusy(which)
    setError(null)
    try {
      if (which === 'learn') setLearned(await window.api.channel.learn())
      else if (which === 'gaps') setGaps(await window.api.channel.gaps())
      else setMined(await window.api.channel.comments())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your channel.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-serif text-ink-100">Your channel</h1>
      <p className="text-ink-400 text-sm mt-1">
        What has actually worked on <em>this</em> channel, worked out from your own videos. General advice is an
        average across millions of channels that are not yours. This is not that.
      </p>
      <p className="text-ink-500 text-xs mt-2">
        Needs the free YouTube connection — Settings has a three-minute walkthrough that finds your channel from your
        @name. Reading a hundred of your own videos costs about four of the ten thousand daily free requests, so this
        is effectively free to run.
      </p>

      {error && <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-300">{error}</div>}

      {/* ─── titles, timing and series ─────────────────────────────────────── */}
      <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-ink-100 font-medium">Titles, timing and series</div>
          <button
            onClick={() => void run('learn')}
            disabled={busy !== null}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            {busy === 'learn' ? 'Reading your videos…' : '📊 Work it out'}
          </button>
        </div>

        {/* Shown whenever there is a problem, INCLUDING when videos did come back: a
            partial read returns real data and an incomplete-read notice at the same time,
            and hiding the notice would let a half-read history pass as the whole story.
            Was one sentence — "check the key and channel ID in Settings" — printed for
            five different situations, four of which it described wrongly. */}
        {learned?.problem && (
          <div className="mb-2">
            <ChannelProblem problem={learned.problem} />
          </div>
        )}
        {learned && learned.videoCount === 0 && (
          <p className="text-xs text-ink-500">With no data the honest answer is nothing, so nothing is claimed.</p>
        )}

        {learned && learned.videoCount > 0 && (
          <div className="space-y-4">
            <div className="text-[11px] text-ink-500">Read {learned.videoCount} of your videos.</div>

            <div>
              <div className="text-xs text-ink-300 mb-1.5">What your titles say</div>
              <div className="space-y-1">
                {learned.titleFindings.map((f) => (
                  <div
                    key={f.pattern}
                    className={`text-xs rounded-md border p-2 ${
                      f.trustworthy ? 'border-ink-800 bg-ink-950 text-ink-200' : 'border-ink-800/50 bg-ink-950/40 text-ink-500'
                    }`}
                  >
                    {f.headline}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-ink-300 mb-1.5">When your audience shows up</div>
              <div className="text-xs text-ink-200 rounded-md border border-ink-800 bg-ink-950 p-2">
                {learned.timing.headline}
              </div>
              {learned.timing.trustworthy && (
                <div className="mt-1.5 grid grid-cols-2 gap-3 text-[11px] text-ink-500">
                  <div>
                    {learned.timing.byDay.slice(0, 4).map((d) => (
                      <div key={d.day}>
                        {d.day}: {d.medianViews.toLocaleString()} ({d.videos} video{d.videos === 1 ? '' : 's'})
                      </div>
                    ))}
                  </div>
                  <div>
                    {learned.timing.byHour.slice(0, 4).map((h) => (
                      <div key={h.hour}>
                        {formatHour(h.hour)}: {h.medianViews.toLocaleString()} ({h.videos} video{h.videos === 1 ? '' : 's'})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-ink-300 mb-1.5">Your series</div>
              <div className="text-xs text-ink-200 rounded-md border border-ink-800 bg-ink-950 p-2">
                {learned.series.headline}
              </div>
              {learned.series.series.map((s) => (
                <div key={s.name} className="mt-1.5 rounded-md border border-ink-800 bg-ink-950 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-ink-200">{seriesHeadline(s)}</div>
                    <button
                      onClick={() => setOpenSeries(openSeries?.name === s.name ? null : s)}
                      className="shrink-0 text-[11px] text-gold-500 hover:text-gold-400 transition-colors"
                    >
                      {openSeries?.name === s.name ? 'Hide links' : 'Get the links'}
                    </button>
                  </div>
                  {openSeries?.name === s.name && (
                    <div className="mt-2 space-y-2">
                      {/* The links for the LATEST episode, which is the one being published. */}
                      {(() => {
                        const latest = s.episodes[s.episodes.length - 1].episode
                        const links = seriesLinks(s, latest)
                        return (
                          <>
                            <Copyable label={`Description block (episode ${latest})`} text={links.description} />
                            <Copyable label="Pinned comment" text={links.pinnedComment} />
                            <Copyable label="End screen" text={links.endScreen} />
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Score a title against the channel's own history. */}
            <div>
              <div className="text-xs text-ink-300 mb-1.5">Try a title on it</div>
              <div className="flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  placeholder="Reserves drop 8 percent in one month"
                  className="flex-1 rounded-md bg-ink-950 border border-ink-700 text-ink-200 text-xs px-2 py-1.5"
                />
                <button
                  // Guarded: each press is a FULL channel read, so an impatient double-click
                  // spent the quota twice and let two replies race — the slower one winning
                  // and scoring a title the user had already changed.
                  onClick={() => {
                    if (scoring) return
                    setScoring(true)
                    void window.api.channel
                      .scoreTitle(titleDraft)
                      .then(setScore)
                      .finally(() => setScoring(false))
                  }}
                  disabled={!titleDraft.trim() || scoring}
                  className="rounded-md border border-gold-500/40 text-gold-400 hover:bg-gold-500/10 disabled:opacity-40 text-xs px-3 py-1.5 transition-colors"
                >
                  {scoring ? 'Reading your videos…' : 'Score it'}
                </button>
              </div>
              {score?.problem && (
                <div className="mt-2">
                  {/* Without this the score said "not enough history to tell" — a claim about
                      the channel — when the read had actually failed. */}
                  <ChannelProblem problem={score.problem} />
                </div>
              )}
              {score && !score.problem && (
                <div className="mt-2 rounded-md border border-ink-800 bg-ink-950 p-2 space-y-1">
                  {score.reasons.map((r, i) => (
                    <div key={i} className="text-xs text-ink-300">
                      {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── what others covered and this channel did not ──────────────────── */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-ink-100 font-medium">What you have never covered</div>
          <button
            onClick={() => void run('gaps')}
            disabled={busy !== null}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="Compares the subjects other channels are getting views on against everything you have published"
          >
            {busy === 'gaps' ? 'Comparing…' : '🔍 Find the gaps'}
          </button>
        </div>
        <p className="text-xs text-ink-400">
          {/* The headline is only true if something was actually read. With no key it says
              "No competitor videos read yet — search a topic first", which is a statement
              about the channel rather than about the read having failed, sitting directly
              above a card saying nothing could be read. Suppressed when there is a problem. */}
          {gaps && (!gaps.problem || gaps.problem.kind === 'partial')
            ? gaps.headline
            : 'Trending tells you what is popular. This tells you what is popular that YOU have never made — demonstrated demand, with nothing of your own competing for it.'}
        </p>
        {gaps?.problem && (
          <div className="mt-3">
            <ChannelProblem problem={gaps.problem} />
          </div>
        )}

        {gaps && (!gaps.problem || gaps.problem.kind === 'partial') && (
          <div className="text-[11px] text-ink-600 mt-1">
            Compared {gaps.myVideos} of your videos against {gaps.competitorVideos} from other channels
            {gaps.unmatched > 0 && `, ${gaps.unmatched} of which were about something outside finance`}.
          </div>
        )}

        {gaps && gaps.gaps.length > 0 && (
          <div className="mt-3 space-y-2">
            {gaps.gaps.map((g) => (
              <div key={g.topicId} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="text-xs text-ink-100 font-medium">{g.topic}</div>
                <div className="text-xs text-ink-400 mt-1">{g.headline}</div>
                {/* The real videos, so a gap can be checked rather than believed. */}
                <div className="mt-1.5 space-y-0.5">
                  {g.examples.map((ex) => (
                    <div key={ex.title} className="text-[11px] text-ink-500">
                      {ex.viewCount.toLocaleString()} · {ex.channelTitle} · “{ex.title}”
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {gaps && gaps.onlyMine.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-ink-300 cursor-pointer">
              {gaps.onlyMine.length} subject{gaps.onlyMine.length === 1 ? '' : 's'} only you cover
            </summary>
            <p className="text-[11px] text-ink-500 mt-1">
              Either a moat or a waste of effort. Worth knowing which — nobody else will tell you.
            </p>
            <div className="mt-1 space-y-0.5">
              {gaps.onlyMine.map((o) => (
                <div key={o.topic} className="text-[11px] text-ink-400">
                  {o.topic} — {o.myVideos} video{o.myVideos === 1 ? '' : 's'}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ─── the questions in the comments ─────────────────────────────────── */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-ink-100 font-medium">Video ideas from your comments</div>
          <button
            onClick={() => void run('comments')}
            disabled={busy !== null}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
            title="Reads the comments on your recent videos and groups the questions people keep asking"
          >
            {busy === 'comments' ? 'Reading comments…' : '💬 Read my comments'}
          </button>
        </div>
        <p className="text-xs text-ink-400">
          {/* Same trap: summarise(0 comments) says "No comments to read yet", which reads as
              a fact about the audience when in truth nothing was read at all. */}
          {mined && (!mined.problem || mined.problem.kind === 'partial')
            ? mined.summary
            : 'Nobody reads two thousand comments. The same question asked forty times is a video with an audience before you record a frame.'}
        </p>
        {mined?.problem && (
          <div className="mt-3">
            <ChannelProblem problem={mined.problem} />
          </div>
        )}

        {mined && mined.clusters.length > 0 && (
          <div className="mt-3 space-y-2">
            {mined.clusters.map((c: QuestionCluster) => (
              <div key={c.representative} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] text-gold-500 font-medium">
                    {c.count} {c.count === 1 ? 'person' : 'people'} asked
                  </span>
                  {c.likes > 0 && <span className="text-[11px] text-ink-500">{c.likes.toLocaleString()} likes</span>}
                </div>
                {/* Quoted verbatim. That is what makes it checkable. */}
                <div className="text-xs text-ink-100">“{c.representative}”</div>
                {c.examples.length > 1 && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-ink-500 cursor-pointer">
                      the other {c.examples.length - 1} ways it was asked
                    </summary>
                    <div className="mt-1 space-y-0.5">
                      {c.examples.slice(1).map((ex) => (
                        <div key={ex} className="text-[11px] text-ink-500 italic">
                          “{ex}”
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div className="text-[11px] text-ink-600 mt-1.5">grouped on: {c.keywords.join(', ')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Copyable({ label, text }: { label: string; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-md border border-ink-800 bg-ink-950 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-ink-400">{label}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="text-[11px] text-gold-500 hover:text-gold-400 transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] text-ink-300 whitespace-pre-wrap font-sans">{text}</pre>
    </div>
  )
}
