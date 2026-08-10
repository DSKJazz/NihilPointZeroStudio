/**
 * Turns the finished script into everything else it needs to become.
 *
 * Runs entirely in the page — `shared/repurpose` is pure, so there is no round trip to
 * the main process and no AI call. That matters: it works with the internet down, on
 * the phone, and instantly. Every line it produces is the user's own writing
 * rearranged, never paraphrased.
 */
import { useMemo, useState } from 'react'
import { repurpose, type RepurposePack } from '../../../shared/repurpose'
import { toast } from './Toast'

type Key = keyof Omit<RepurposePack, 'chapters'> | 'thread'

const TABS: { key: Key; label: string; hint: string }[] = [
  { key: 'youtubeDescription', label: 'YouTube description', hint: 'Hook, chapters, link, hashtags. Paste straight in.' },
  { key: 'communityPost', label: 'Community post', hint: 'Short, ends on a question so people reply.' },
  { key: 'thread', label: 'X / Twitter thread', hint: 'Numbered, each post under 280 characters.' },
  { key: 'linkedIn', label: 'LinkedIn', hint: 'Bulleted — nobody reads a wall of text there.' },
  { key: 'whatsapp', label: 'WhatsApp broadcast', hint: 'Deliberately the shortest. Read on a lock screen.' }
]

export default function RepurposePanel({
  title,
  body,
  url,
  tags
}: {
  title: string
  body: string
  url?: string
  tags?: string[]
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Key>('youtubeDescription')
  const pack = useMemo(() => repurpose({ title, body, url, tags }), [title, body, url, tags])

  if (!body.trim()) return null

  const text = tab === 'thread' ? pack.thread.join('\n\n———\n\n') : (pack[tab] as string)

  const copy = async (value: string, what: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      toast(`${what} copied ✓`, 'success')
    } catch {
      toast('Could not reach the clipboard — select the text and copy it by hand.', 'error')
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-ink-100">
          ♻ Turn this into posts{' '}
          <span className="text-ink-500 font-normal">
            — description, community, thread, LinkedIn, WhatsApp
          </span>
        </span>
        <span className="text-ink-400 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-ink-800 p-4">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  tab === t.key ? 'bg-gold-500 text-ink-950' : 'border border-ink-700 text-ink-300 hover:bg-ink-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-2 text-[11px] text-ink-500">{TABS.find((t) => t.key === tab)?.hint}</div>

          {tab === 'thread' && pack.thread.length > 1 && (
            <div className="mt-1 text-[11px] text-ink-500">
              {pack.thread.length} posts. Copy them all, or one at a time below.
            </div>
          )}

          <textarea
            readOnly
            value={text}
            className="mt-2 h-56 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-ink-100 leading-relaxed outline-none font-mono"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void copy(text, TABS.find((t) => t.key === tab)?.label ?? 'Text')}
              className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400"
            >
              Copy
            </button>
            {tab === 'thread' &&
              pack.thread.map((post, i) => (
                <button
                  key={i}
                  onClick={() => void copy(post, `Post ${i + 1}`)}
                  className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
                >
                  Copy {i + 1}
                </button>
              ))}
          </div>

          {!pack.chapters.length && (
            <div className="mt-3 text-[11px] text-ink-500">
              No chapters: YouTube needs at least three, each ten seconds apart, starting at 0:00.
              Add a few section headings to your script and they will appear here.
            </div>
          )}

          <div className="mt-3 text-[11px] text-ink-600">
            Every line here is your own writing, rearranged — nothing is reworded and no
            number is invented. Works with the internet off.
          </div>
        </div>
      )}
    </div>
  )
}
