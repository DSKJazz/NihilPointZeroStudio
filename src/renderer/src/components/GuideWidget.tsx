import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MicButton, { appendDictation } from './MicButton'
import { toast } from './Toast'
import { releaseAgentRun, tryAcquireAgentRun } from '../store/agentRunLock'
import type { AgentPlan } from '../../../shared/types'
import { APP_GUIDE } from '../../../shared/appGuide'
import { GUIDE_EXAMPLES, buildGuideIndex, searchGuide } from '../../../shared/guideSearch'

/**
 * The manual, indexed once for INSTANT mode. Built at module load because it is pure
 * string work over a fixed document — a few milliseconds, done before the panel opens.
 */
const GUIDE_INDEX = buildGuideIndex(APP_GUIDE)

interface Msg {
  role: 'user' | 'assistant'
  content: string
  /** A validated action plan the user can Run (from Execute). */
  plan?: AgentPlan
  /** True once this message's plan has been executed (hides the Run button). */
  ran?: boolean
  /** True for assistant how-to answers, which get an "⚡ Execute these steps" button. */
  executable?: boolean
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'Today',
  '/ideas': 'Ideas & Trends',
  '/agent': 'AI Command',
  '/scenes': 'Scene Studio',
  '/writer': 'Script Writer',
  '/scriptpad': 'Script Pad',
  '/video': 'Video Studio',
  '/storyboard': 'Storyboard Director',
  '/presenter': 'Presenter Studio',
  '/recorder': 'Recorder',
  '/timeline': 'Timeline Editor',
  '/charts': 'Charts',
  '/psx': 'Live PSX Data',
  '/nccpl': 'NCCPL Analysis',
  '/advisor': 'Advisor',
  '/library': 'Library',
  '/activity': 'Activity Log',
  '/settings': 'Settings'
}

/** One-tap answer formats — each simply words the request the way the Expert obeys. */
const FORMATS: { label: string; ask: string }[] = [
  { label: '1·2·3 steps', ask: 'Answer as short numbered steps.' },
  { label: '• Bullets', ask: 'Answer as tight bullet points.' },
  { label: '🎯 Precise clicks', ask: 'Answer as precise numbered steps, ONE exact click/action per step, naming the exact tab and button.' },
  { label: '📖 Detailed', ask: 'Answer as a full detailed walkthrough: every step, plus what I should see after each one.' },
  { label: '⚡ Brief', ask: 'Answer in 3-5 short lines max.' }
]

/** Tabs an answer mentions by name — rendered as one-click "take me there" chips. */
function mentionedTabs(content: string, currentPath: string): [string, string][] {
  const lower = content.toLowerCase()
  return Object.entries(PAGE_NAMES)
    .filter(([route, name]) => route !== currentPath && lower.includes(name.toLowerCase()))
    .slice(0, 4)
}

/**
 * The "Studio Expert" (🧭) — a SECOND on-every-tab assistant, deliberately separate from
 * the 🎬 Producer. It does one thing: it knows the entire app and answers anything about
 * it in whatever format the user asks — then can hand those steps (or the user's own
 * written orders) to the validated action engine, where nothing runs until the user
 * clicks Run. Ephemeral chat; nothing is persisted.
 */
export default function GuideWidget(): React.JSX.Element {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // INSTANT is the default on purpose: it always works. The AI modes depend on a free
  // service that is regularly down, and a helper that answers nothing is worse than a
  // plain one that answers immediately.
  const [mode, setMode] = useState<'instant' | 'ask' | 'execute'>('instant')
  const [format, setFormat] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  const pageName = PAGE_NAMES[location.pathname] ?? 'the app'

  // Same fix as AssistantWidget: `open` is true for every stream token, so the old
  // `nearBottom || open` guard force-scrolled the reader down on every delta.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [open])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTo({ top: el.scrollHeight })
  }, [msgs])

  function push(m: Msg): void {
    setMsgs((cur) => [...cur, m])
  }

  /**
   * Answers straight from the manual — no AI, no internet, no waiting. Every word
   * returned is quoted from the manual, so it can never invent a button that isn't
   * there. When nothing matches it says so and offers examples rather than guessing.
   */
  function answerInstantly(text: string): void {
    const hits = searchGuide(GUIDE_INDEX, text)
    const content = hits.length
      ? hits.map((h) => h.section.body).join('\n\n———\n\n')
      : `I don't have that written down in the manual.\n\nTry one of these, or switch to "Ask AI" above for a freer answer:\n${GUIDE_EXAMPLES.map((e) => `• ${e}`).join('\n')}`
    setMsgs((cur) => [
      ...cur,
      { role: 'user', content: text },
      { role: 'assistant', content, executable: hits.length > 0 }
    ])
  }

  /** Ask the Expert (streaming), honoring the selected answer format. */
  async function ask(text: string): Promise<void> {
    const next: Msg[] = [...msgs, { role: 'user', content: text }, { role: 'assistant', content: '' }]
    setMsgs(next)
    setBusy(true)
    const unsub = window.api.guide.onStream((delta) => {
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        if (copy[i]?.role === 'assistant') copy[i] = { ...copy[i], content: copy[i].content + delta }
        return copy
      })
    })
    try {
      const ctx =
        `The user is currently on the "${pageName}" tab.` +
        (format ? ` Unless the message itself asks for a different format: ${format}` : '')
      const history = next.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
      const reply = await window.api.guide.ask(history, ctx)
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        if (copy[i]?.role === 'assistant') {
          // The invoke's return value is the AUTHORITATIVE final answer. Preferring
          // the accumulated stream meant a mid-stream Ollama failure showed the
          // truncated stream WITH the fallback's full answer concatenated onto it.
          const content = reply || copy[i].content
          // Error strings resolve normally (the handler never rejects) — don't offer
          // to "execute" an error message.
          copy[i] = { role: 'assistant', content, executable: !content.startsWith('⚠') }
        }
        return copy
      })
    } catch (err) {
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        copy[i] = { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Expert error'} — check your AI brain in Settings.` }
        return copy
      })
    } finally {
      unsub()
      setBusy(false)
    }
  }

  /**
   * Turn text (the Expert's own answer, or the user's written orders) into a VALIDATED
   * action plan via the same engine as the AI Command tab. The model only picks from
   * that safe action set; nothing runs until the user clicks "Run it", and it can
   * never delete anything.
   */
  async function planFrom(text: string, sourceLabel: string): Promise<void> {
    push({ role: 'user', content: `⚡ Execute: ${sourceLabel}` })
    setBusy(true)
    try {
      const p = await window.api.agent.interpret(text)
      if (!p.steps.length) {
        push({
          role: 'assistant',
          content:
            p.reply ||
            'Those steps are things you do in the UI (clicks/settings), which I can\'t press for you — but anything that CREATES (scripts, videos, scenes, images, thumbnails, music, ideas, PSX analysis) I can run. Tell me WHAT to make, e.g. "write a 1-minute script about gold and build it in 1080p".'
        })
      } else {
        push({ role: 'assistant', content: p.reply || 'Here\'s the plan — nothing runs until you click:', plan: p })
      }
    } catch (err) {
      push({ role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Could not plan that.'}` })
    } finally {
      setBusy(false)
    }
  }

  /** Executes an approved plan through the validated engine, streaming progress. */
  async function runPlan(p: AgentPlan, msgIndex: number): Promise<void> {
    // The progress channel is shared with the Producer widget — never run both at once.
    if (!tryAcquireAgentRun()) {
      toast('Another AI run is already in progress — wait for it to finish.', 'info')
      return
    }
    setBusy(true)
    setMsgs((cur) => cur.map((m, i) => (i === msgIndex ? { ...m, ran: true } : m)))
    push({ role: 'assistant', content: '▶ Running…' })
    const unsub = window.api.agent.onProgress((stage) => {
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        if (copy[i]?.role === 'assistant') copy[i] = { role: 'assistant', content: `▶ ${stage}` }
        return copy
      })
    })
    try {
      const out = (await window.api.agent.execute(p)).results
      const ok = out.filter((r) => r.ok).length
      const built = out.filter((r) => r.video).length
      const summary = out.map((r) => `${r.ok ? '✓' : '✗'} ${r.label}`).join('\n')
      setMsgs((cur) => {
        const copy = cur.slice()
        copy[copy.length - 1] = {
          role: 'assistant',
          content: `Done — ${ok}/${out.length} steps completed${built ? ` · ${built} video(s) now in Video Studio` : ''}.\n${summary}`
        }
        return copy
      })
      toast(`Expert ran ${ok}/${out.length} steps ✓`, 'success')
    } catch (err) {
      setMsgs((cur) => {
        const copy = cur.slice()
        copy[copy.length - 1] = { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Run failed'}` }
        return copy
      })
    } finally {
      unsub()
      releaseAgentRun()
      setBusy(false)
    }
  }

  async function onSend(): Promise<void> {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (mode === 'instant') answerInstantly(text)
    else if (mode === 'execute') await planFrom(text, text.slice(0, 80))
    else await ask(text)
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 left-60 z-50 rounded-full border border-gold-500 bg-ink-900 hover:bg-ink-800 text-gold-400 font-medium shadow-lg px-4 py-3 text-sm transition-colors"
          title="Studio Expert — knows every button in this app, answers any way you ask, and can run the steps"
        >
          🧭 Expert
        </button>
      )}
      {open && (
        <div
          className="fixed bottom-5 left-60 z-50 w-[380px] max-w-[46vw] rounded-lg border border-ink-700 bg-ink-900 shadow-2xl flex flex-col"
          style={{ height: '540px' }}
        >
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <div className="text-sm text-ink-100">
              🧭 Studio Expert
              <span className="ml-2 text-[10px] text-ink-500">· {pageName}</span>
            </div>
            <div className="flex items-center gap-2">
              {msgs.length > 0 && (
                <button onClick={() => setMsgs([])} className="text-[11px] text-ink-500 hover:text-ink-300">
                  Clear
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-100 text-sm">
                ✕
              </button>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-800">
            <div className="inline-flex rounded-md border border-ink-700 overflow-hidden text-[11px]">
              <button onClick={() => setMode('instant')} className={`px-2.5 py-1 ${mode === 'instant' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>
                Instant
              </button>
              <button onClick={() => setMode('ask')} className={`px-2.5 py-1 ${mode === 'ask' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>
                Ask
              </button>
              <button onClick={() => setMode('execute')} className={`px-2.5 py-1 ${mode === 'execute' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>
                Execute
              </button>
            </div>
            <div className="ml-auto text-[10px] text-ink-600">
              {mode === 'execute'
                ? 'Write orders — you approve with Run.'
                : mode === 'instant'
                  ? 'Straight from the manual — no AI, works offline.'
                  : 'Knows every tab & button. Needs the AI.'}
            </div>
          </div>

          {/* Answer-format chips (Ask mode) */}
          {mode !== 'execute' && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-ink-800">
              {FORMATS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => setFormat((cur) => (cur === f.ask ? null : f.ask))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    format === f.ask ? 'border-gold-500 text-gold-300 bg-ink-800' : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                  }`}
                  title="Pick how answers should be formatted (or just ask in your own words)"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <p className="text-[11px] text-ink-500">
                I&rsquo;m the Studio Expert — separate from the Producer. I know every tab, button and workflow in
                this app. Ask me anything, any way you like (pick a format above, or just say &ldquo;detailed bullet
                points&rdquo; / &ldquo;precise steps&rdquo; in your question). Under each answer, &ldquo;⚡ Execute these
                steps&rdquo; turns it into real actions — and in <span className="text-ink-300">Execute</span> mode you
                write the orders yourself. Nothing runs until you click Run, and nothing can ever be deleted.
              </p>
            )}
            {msgs.map((m, i) => {
              const places =
                m.role === 'assistant' && m.content && !m.content.startsWith('⚠')
                  ? mentionedTabs(m.content, location.pathname)
                  : []
              return (
              <div key={i} className="text-[12px] leading-relaxed">
                <span className={m.role === 'user' ? 'text-gold-400' : 'text-sky-400'}>{m.role === 'user' ? 'You' : 'Expert'}: </span>
                <span className={`whitespace-pre-wrap ${m.role === 'user' ? 'text-ink-100' : 'text-ink-300'}`}>
                  {m.content || (busy && i === msgs.length - 1 ? '…' : '')}
                </span>
                {places.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {places.map(([route, name]) => (
                      <button
                        key={route}
                        onClick={() => navigate(route)}
                        className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-ink-800"
                        title={`Take me there: ${name}`}
                      >
                        → Open {name}
                      </button>
                    ))}
                  </div>
                )}
                {m.executable && !busy && (
                  <div className="mt-1">
                    <button
                      onClick={() => void planFrom(m.content, 'the steps you just explained')}
                      className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-gold-300 hover:bg-ink-800"
                      title="Turn this answer into a validated action plan (you approve with Run)"
                    >
                      ⚡ Execute these steps
                    </button>
                  </div>
                )}
                {m.plan && (
                  <div className="mt-2 rounded-md border border-ink-700 bg-ink-950 p-2">
                    <div className="text-[10px] text-ink-500 mb-1">
                      Plan · {m.plan.steps.length} step{m.plan.steps.length > 1 ? 's' : ''}
                    </div>
                    <ul className="list-disc pl-4 text-[11px] text-ink-300 space-y-0.5">
                      {m.plan.steps.map((s, k) => (
                        <li key={k}>{s.type.replace(/_/g, ' ')}</li>
                      ))}
                    </ul>
                    {!m.ran && (
                      <button
                        onClick={() => void runPlan(m.plan as AgentPlan, i)}
                        disabled={busy}
                        className="mt-2 rounded bg-gold-500 hover:bg-gold-400 text-ink-950 text-[11px] font-medium px-3 py-1 disabled:opacity-40"
                      >
                        ▶ Run it
                      </button>
                    )}
                  </div>
                )}
              </div>
              )
            })}
          </div>

          <div className="border-t border-ink-800 p-2 flex gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSend()}
              placeholder={
                mode === 'execute'
                  ? 'Write the orders to execute…'
                  : mode === 'instant'
                    ? 'Ask how to do anything — typos are fine…'
                    : 'Ask me anything about this app…'
              }
              className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-xs text-ink-100 outline-none focus:border-gold-500"
            />
            <MicButton onText={(t) => setInput((prev) => appendDictation(prev, t))} className="px-2 py-2" />
            <button
              onClick={onSend}
              disabled={busy || !input.trim()}
              className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-2 transition-colors"
            >
              {busy ? '…' : mode === 'execute' ? 'Plan' : mode === 'instant' ? 'Find' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
