/**
 * The free YouTube key, set up by following buttons instead of instructions.
 *
 * WHAT THIS REPLACES. A password box, a Save button, and one sentence of advice:
 * *"Get a free key from Google Cloud Console → enable YouTube Data API v3 → create an
 * API key."* Every word of that is accurate and none of it is usable by someone who does
 * not code. Three finished features — Your Channel, the comment questions, the
 * competitor gaps — read nothing without that key, and the app's response to not having
 * one was an empty screen.
 *
 * Two rules shaped this file.
 *
 * NEVER HAND OVER A PROCEDURE A MACHINE COULD RUN. The parts that cannot be automated
 * are the ones inside the user's own Google account, so those become one button each,
 * landing on the exact page — not "go to the console and find Library". Everything after
 * the paste IS automated: the key is tested for real, the failure is named in a sentence,
 * and the channel id is looked up from the @handle so nobody digs through Advanced
 * settings for a 24-character string.
 *
 * "COULD NOT TELL" IS NOT SUCCESS. Every verdict is one of three states and the third is
 * as loud as the other two. No internet renders as *no internet*, never as a pass and
 * never as a bad key — the bug in PR #13 was exactly a check whose failure looked
 * identical to its success.
 *
 * The links are plain anchors on purpose: the desktop window sends `target="_blank"` to
 * the real browser via `setWindowOpenHandler`, and on the phone they just open a tab. An
 * `openExternal` IPC would have opened a browser on the PC while the user held the phone.
 */
import { useState } from 'react'
import { SETUP_STEPS, cleanPastedKey, type ChannelResolution, type KeyVerdict } from '../../../shared/youtubeKeySetup'
import { toast } from './Toast'

function OpenLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-block rounded-md border border-gold-500/50 bg-gold-500/10 hover:bg-gold-500/20 text-gold-300 text-xs font-medium px-3 py-1.5 transition-colors"
    >
      {label} ↗
    </a>
  )
}

/** The verdict, in the colour that matches what it actually means. */
function Verdict({ v }: { v: KeyVerdict }): React.JSX.Element {
  if (v.state === 'working') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
        <div className="text-xs text-emerald-300 font-medium">✓ {v.message}</div>
      </div>
    )
  }
  if (v.state === 'unknown') {
    // Amber, not red and certainly not green: the app does not know, and says so.
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
      {v.fixUrl && <OpenLink href={v.fixUrl} label="Open the page that fixes this" />}
    </div>
  )
}

export default function YouTubeSetup({
  hasKey,
  savedChannelId,
  onSaved
}: {
  hasKey: boolean
  savedChannelId: string
  onSaved: () => void | Promise<void>
}): React.JSX.Element {
  // Collapsed once it is working, because a finished setup is not something to re-read.
  const [open, setOpen] = useState(!hasKey)
  const [key, setKey] = useState('')
  const [verdict, setVerdict] = useState<KeyVerdict | null>(null)
  const [checking, setChecking] = useState(false)
  const [channelText, setChannelText] = useState('')
  const [found, setFound] = useState<ChannelResolution | null>(null)
  const [finding, setFinding] = useState(false)

  /**
   * Check, and only save if Google said yes.
   *
   * A key is saved on the strength of a real reply, never on the strength of having been
   * typed. That is the whole difference between this and the box it replaces.
   */
  async function check(): Promise<void> {
    setChecking(true)
    setVerdict(null)
    // Clean here, once, and use the SAME string for the check and the save. The checker
    // used to clean its own copy while the raw text was what got stored, so a key pasted
    // with quotes round it passed the check and was saved broken.
    const candidate = cleanPastedKey(key)
    if (key.trim() && !candidate) {
      // Something IS in the box, and cleaning it left nothing. Falling through here would
      // check the SAVED key and report a verdict about a key the user is not looking at.
      setVerdict({
        state: 'broken',
        title: 'There is nothing usable in that box',
        message: 'What was pasted is punctuation and spaces with no key in it.',
        fix: 'Copy the key again from step 4 — it is one unbroken run of letters and digits starting with AIza.'
      })
      setChecking(false)
      return
    }
    try {
      const v = await window.api.youtube.verifyKey(candidate || undefined)
      setVerdict(v)
      if (v.state === 'working' && candidate) {
        await window.api.settings.setYouTubeKey(candidate)
        setKey('')
        await onSaved()
        toast('YouTube key saved and working.', 'success')
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

  /** @handle → channel id, then save it, so the id never has to be seen by a human. */
  async function findChannel(): Promise<void> {
    setFinding(true)
    setFound(null)
    try {
      const res = await window.api.youtube.resolveChannel(channelText, cleanPastedKey(key) || undefined)
      setFound(res)
      // An exact match on the handle or id is saved straight away. A SEARCH result is a
      // guess — it is whichever channel best matched some words — so it is shown and left
      // for the user to confirm rather than silently written over their setting.
      if (res.ok && !res.viaSearch) {
        await window.api.settings.setYouTubeChannel(res.channelId)
        await onSaved()
        toast(`Channel saved: ${res.title}`, 'success')
      }
    } catch (err) {
      setFound({
        ok: false,
        certain: false,
        problem: err instanceof Error ? err.message : 'The lookup itself failed.',
        fix: 'Nothing has been saved. Try again in a moment.'
      })
    } finally {
      setFinding(false)
    }
  }

  /** Saves a SEARCH result once the user has said it really is their channel. */
  async function confirmFound(): Promise<void> {
    if (!found?.ok) return
    try {
      await window.api.settings.setYouTubeChannel(found.channelId)
      setFound({ ...found, viaSearch: false })
      await onSaved()
      toast(`Channel saved: ${found.title}`, 'success')
    } catch (err) {
      // A save that failed must not leave the card reading "✓ Saved".
      toast(err instanceof Error ? err.message : 'That could not be saved. Nothing has changed.', 'error')
    }
  }

  return (
    <div id="youtube-setup" className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink-100 font-medium">Connect YouTube — free, about 3 minutes</div>
          <div className="text-xs text-ink-500 mt-0.5">
            Switches on <em>Your channel</em>, the questions from your comments, and the competitor gaps. Google
            gives 10,000 requests a day free and never asks for a card. Reading your whole channel costs about four
            of them.
          </div>
        </div>
        <span className={`shrink-0 text-xs ${hasKey ? 'text-emerald-400' : 'text-amber-400'}`}>
          {hasKey ? '✓ Key saved' : 'Not set up'}
        </span>
      </div>

      {hasKey && savedChannelId && (
        <div className="text-[11px] text-ink-500">
          Channel saved: <span className="text-ink-300 font-mono">{savedChannelId}</span>
        </div>
      )}
      {hasKey && !savedChannelId && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] text-amber-300">
          The key is saved but no channel is set, so <em>Your channel</em> still has nothing to read. Open the steps
          below and use “Find my channel”.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          {open ? 'Hide the steps' : hasKey ? 'Change or re-check' : 'Show me how (3 minutes)'}
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
            {SETUP_STEPS.map((s) => (
              <li key={s.n} className="rounded-md border border-ink-800 bg-ink-950 p-3">
                <div className="text-xs text-ink-100 font-medium">
                  {s.n}. {s.title}
                </div>
                <div className="text-[11px] text-ink-400 mt-1 leading-relaxed">{s.detail}</div>
                {s.url && s.buttonLabel && (
                  <div className="mt-2">
                    <OpenLink href={s.url} label={s.buttonLabel} />
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
                  // A green tick from the LAST key, still on screen next to a different
                  // one in the box, is a verdict about something that is no longer there.
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
              The key is tested against Google before it is saved, and it is stored encrypted on this PC only.
            </div>
            {verdict && <Verdict v={verdict} />}
          </div>

          {/* ─── the channel, found by name so the id never has to be hunted ─── */}
          <div className="rounded-md border border-ink-800 bg-ink-950 p-3 space-y-2">
            <div className="text-xs text-ink-100 font-medium">6. Which channel is yours?</div>
            <div className="text-[11px] text-ink-400 leading-relaxed">
              Paste your channel address or just your @name — the app finds the long ID for you and shows you the
              channel name so you can see it picked the right one. YouTube hides that ID three menus deep, which is
              why this box used to be so annoying.
            </div>
            <div className="flex gap-2">
              <input
                value={channelText}
                onChange={(e) => setChannelText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && channelText.trim() && !finding) void findChannel()
                }}
                placeholder="@yourname   or   youtube.com/@yourname"
                className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
              />
              <button
                onClick={() => void findChannel()}
                disabled={finding || !channelText.trim()}
                className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
              >
                {finding ? 'Looking…' : 'Find my channel'}
              </button>
            </div>
            {found?.ok && (
              <div
                className={`rounded-md border p-3 space-y-2 ${
                  found.viaSearch ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'
                }`}
              >
                {/* No avatar: the app's CSP is img-src 'self' data: file:, so a Google-hosted
                    picture would render as a broken-image icon exactly where the user is being
                    asked to confirm. The name and the video count are the real check. */}
                <div>
                  <div className={`text-xs font-medium ${found.viaSearch ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {found.viaSearch ? `Is this you? ${found.title}` : `✓ Saved: ${found.title}`}
                  </div>
                  <div className="text-[11px] text-ink-500 font-mono">{found.channelId}</div>
                  {found.videoCount !== undefined && (
                    <div className="text-[11px] text-ink-500">
                      {found.videoCount} videos
                      {found.subscribers !== undefined ? ` · ${found.subscribers} subscribers` : ''}
                    </div>
                  )}
                </div>
                {found.viaSearch && (
                  <>
                    <div className="text-[11px] text-ink-400">
                      That name did not match a channel exactly, so this is the closest one YouTube could find — it
                      might not be yours. Saving the wrong channel would make every answer about somebody else, so
                      nothing has been saved yet.
                    </div>
                    <button
                      onClick={() => void confirmFound()}
                      className="rounded-md bg-gold-500 hover:bg-gold-400 text-ink-950 text-xs font-medium px-3 py-1.5 transition-colors"
                    >
                      Yes, that is my channel
                    </button>
                  </>
                )}
              </div>
            )}
            {found && !found.ok && (
              <div
                className={`rounded-md border p-3 space-y-1 ${
                  found.certain ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'
                }`}
              >
                <div className={`text-xs font-medium ${found.certain ? 'text-red-300' : 'text-amber-300'}`}>
                  {found.certain ? '✗' : '?'} {found.problem}
                </div>
                <div className="text-[11px] text-ink-400">{found.fix}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
