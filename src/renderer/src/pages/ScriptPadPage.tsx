import { useEffect, useRef, useState } from 'react'
import TemplatesMenu from '../components/TemplatesMenu'
import FactCheckPanel from '../components/FactCheckPanel'
import { useNavigate } from 'react-router-dom'
import MicButton, { appendDictation } from '../components/MicButton'
import { useProducerTarget } from '../store/ProducerContext'

/**
 * A dedicated, persistent free-write area. Unlike the finance Script Writer, this
 * is a blank notepad: write or paste anything you want to turn into a video. It
 * autosaves to disk (travels with the portable data folder) and can be sent
 * straight to the Video Generator.
 */
export default function ScriptPadPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Live copy of the pad + dirty flag so unmount can flush the last <600ms of
  // typing — this page unmounts on every tab switch, and the debounce alone
  // silently dropped whatever was typed just before navigating away.
  const latest = useRef({ title: '', body: '' })
  const dirty = useRef(false)
  const loadedRef = useRef(false)

  // Let the YouTube Producer read + rewrite the pad's content.
  useProducerTarget({ label: 'Script Pad', kind: 'script', text: body, apply: (next) => setBody(next) })

  const [loadError, setLoadError] = useState<string | null>(null)

  // Load the persisted pad once on mount. Never let a failure leave the tab blank:
  // catch, surface a message, and still enable editing (loaded=true) so you can write.
  useEffect(() => {
    void (async () => {
      try {
        const pad = await window.api.scriptpad.get()
        if (pad) {
          setTitle(pad.title ?? '')
          setBody(pad.body ?? '')
          setSavedAt(pad.updatedAt ?? '')
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Could not load your saved pad — starting fresh.')
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  // Debounced autosave whenever the text changes (after the initial load).
  useEffect(() => {
    if (!loaded) return
    loadedRef.current = true
    latest.current = { title, body }
    dirty.current = true
    setSaving(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const pad = await window.api.scriptpad.save(title, body)
          dirty.current = false
          setSavedAt(pad.updatedAt)
          setSaveError(null)
        } catch (err) {
          // A failed write must never masquerade as "Saving…" forever — say it plainly.
          setSaveError(err instanceof Error ? err.message : 'Could not save your pad to disk.')
        } finally {
          setSaving(false)
        }
      })()
    }, 600)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [title, body, loaded])

  // Flush the pending save when the tab is left (unmount) or the app closes, so
  // the final moments of typing always reach disk.
  useEffect(() => {
    const flush = (): void => {
      if (loadedRef.current && dirty.current) {
        void window.api.scriptpad.save(latest.current.title, latest.current.body).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  async function sendToVideo(): Promise<void> {
    // Ensure the very latest text is flushed before we hand off.
    await window.api.scriptpad.save(title, body)
    navigate('/video', { state: { useScriptPad: true } })
  }

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif text-ink-100">Script Pad</h1>
          <p className="text-ink-400 text-sm mt-1">
            Your own blank page — write or paste anything, then send it to the Video Generator. Autosaves as you type.
          </p>
        </div>
        <button
          onClick={sendToVideo}
          disabled={!body.trim()}
          className="shrink-0 rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
        >
          🎬 Send to Video Generator
        </button>
      </div>

      {loadError && (
        <div className="mt-3 rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">{loadError}</div>
      )}

      <div className="mt-6 rounded-lg border border-ink-700 bg-ink-900 p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">Title</label>
            <MicButton onText={(t) => setTitle((prev) => appendDictation(prev, t))} />
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A title for your video / script"
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-400">Your script ({wordCount} words)</label>
            <MicButton onText={(t) => setBody((prev) => appendDictation(prev, t))} />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            placeholder={
              'Write freely. Anything in [SQUARE BRACKETS] on its own line becomes an on-screen section card in the video.\n\nExample:\n[INTRO]\nWelcome back to the channel...\n\n[THE BIG IDEA]\nHere is what nobody tells you...'
            }
            className="mt-1 w-full rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 leading-relaxed outline-none focus:border-gold-500 font-serif"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-ink-500">
          <span className={saveError ? 'text-red-400' : undefined}>
            {saveError
              ? `⚠ Not saved — ${saveError}`
              : saving
                ? 'Saving…'
                : savedAt
                  ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
                  : 'Not saved yet'}
          </span>
          <span>Autosaves to your portable data folder.</span>
        </div>

        <TemplatesMenu
          title={title}
          body={body}
          onInsert={(t, b) => {
            setTitle(t)
            setBody(b)
          }}
        />
        <FactCheckPanel text={`${title}\n${body}`} />
      </div>
    </div>
  )
}
