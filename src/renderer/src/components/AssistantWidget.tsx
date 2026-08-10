import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import MicButton, { appendDictation } from './MicButton'
import { toast } from './Toast'
import { getProducerTarget, subscribeProducerTarget, type ProducerTarget } from '../store/ProducerContext'
import { releaseAgentRun, tryAcquireAgentRun } from '../store/agentRunLock'
import type { AgentPlan } from '../../../shared/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  /** A full rewrite the user can apply to the current field. */
  edited?: string
  /** Which field this rewrite was generated for — guards against applying it elsewhere. */
  editTarget?: { label: string; kind: string }
  /** A validated action plan the user can Run (from "Do it" mode). */
  plan?: AgentPlan
  /** True once this message's plan has been executed (hides the Run button). */
  ran?: boolean
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

/** Quick producer actions, grouped by the kind of thing being edited. */
const QUICK_ACTIONS: Record<string, { label: string; instruction: string }[]> = {
  script: [
    { label: 'Punch up hook', instruction: 'Rewrite the opening so it hooks hard in the first 3 seconds with a curiosity gap.' },
    { label: 'Tighten intro', instruction: 'Cut fluff from the intro and get to the value faster to protect early retention.' },
    { label: 'Add a CTA', instruction: 'Weave in one natural, compelling call-to-action (subscribe / watch next) without being cringe.' },
    { label: 'Retention pass', instruction: 'Do a full retention pass: add pattern interrupts, trim dead air, keep momentum throughout.' },
    { label: 'Title ideas', instruction: 'Give 5 high-CTR YouTube title options for this. Advice only, no rewrite.' },
    { label: 'Thumbnail text', instruction: 'Suggest 3 punchy thumbnail text overlays (max 4 words each). Advice only.' }
  ],
  brief: [
    { label: 'Stronger arc', instruction: 'Restructure these beats into a tighter story arc with a killer cold-open and a payoff.' },
    { label: 'Punch up hook', instruction: 'Rewrite the first beat so it hooks in the first 3 seconds.' },
    { label: 'Pacing pass', instruction: 'Adjust beat durations/order for better pacing and retention.' },
    { label: 'Title ideas', instruction: 'Give 5 high-CTR titles for this film. Advice only.' }
  ],
  title: [
    { label: 'Higher CTR', instruction: 'Rewrite this title to maximise click-through without clickbait lying.' },
    { label: '5 options', instruction: 'Give 5 alternative high-CTR titles. Advice only.' }
  ],
  notes: [{ label: 'Improve', instruction: 'Sharpen and tighten this text.' }]
}

/**
 * The global "YouTube Producer" — an always-present growth strategist. It knows what you're
 * editing (via the Producer context bus), suggests hooks/titles/retention edits, and can
 * REWRITE the current field, applied only when you click Apply. Streams free-chat advice;
 * uses a structured edit call for rewrites.
 */
export default function AssistantWidget(): React.JSX.Element {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'chat' | 'edit' | 'do'>('chat')
  // Answer density for how-to answers: full step-by-step vs tight bullets.
  const [density, setDensity] = useState<'detailed' | 'brief'>('detailed')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<ProducerTarget | null>(getProducerTarget())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const pageName = PAGE_NAMES[location.pathname] ?? 'the app'

  // Track which field (if any) is currently editable so we can ground + apply.
  useEffect(() => subscribeProducerTarget(() => setTarget(getProducerTarget())), [])
  // Two separate effects on purpose. The old single effect checked `nearBottom || open`,
  // and `open` is true for every stream token — so the guard was dead code and every
  // token yanked the reader to the bottom while they were scrolled up reading.
  useEffect(() => {
    // Opening the panel jumps to the latest message once.
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [open])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // During a stream, follow only when the reader is already near the bottom.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTo({ top: el.scrollHeight })
  }, [msgs])
  // If nothing is editable, edit mode has no target — fall back to chat.
  useEffect(() => {
    if (!target && mode === 'edit') setMode('chat')
  }, [target, mode])

  function push(m: Msg): void {
    setMsgs((cur) => [...cur, m])
  }

  /** Free-chat advice (streaming), grounded in the current draft. */
  async function chat(text: string): Promise<void> {
    const next: Msg[] = [...msgs, { role: 'user', content: text }, { role: 'assistant', content: '' }]
    setMsgs(next)
    setBusy(true)
    const unsub = window.api.assistant.onStream((delta) => {
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        if (copy[i]?.role === 'assistant') copy[i] = { role: 'assistant', content: copy[i].content + delta }
        return copy
      })
    })
    try {
      const ctx =
        `The user is currently on the "${pageName}" tab. Their answer-density preference: ${
          density === 'detailed' ? 'DETAILED full step-by-step instructions' : 'BRIEF high-level bullet points'
        }.` +
        (target ? ` The creator is editing their ${target.kind} ("${target.label}"). Their current draft:\n${target.text.slice(0, 4000)}` : '')
      const history = next.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
      const reply = await window.api.assistant.ask(history, ctx)
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        // The invoke's return value is the authoritative final answer — trusting the
        // accumulated stream let a mid-stream Ollama failure show the truncated text
        // with the fallback's full answer concatenated onto it.
        if (copy[i]?.role === 'assistant' && reply) copy[i] = { role: 'assistant', content: reply }
        return copy
      })
    } catch (err) {
      setMsgs((cur) => {
        const copy = cur.slice()
        const i = copy.length - 1
        copy[i] = { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Producer error'} — set up your AI brain in Settings.` }
        return copy
      })
    } finally {
      unsub()
      setBusy(false)
    }
  }

  /** Structured edit: returns a reply + an applyable rewrite of the current field. */
  async function runEdit(instruction: string): Promise<void> {
    const t = getProducerTarget()
    if (!t) {
      toast('Open a page with a script, title or brief to edit (e.g. Script Writer, Script Pad, Storyboard).', 'info')
      return
    }
    push({ role: 'user', content: instruction })
    setBusy(true)
    try {
      const res = await window.api.producer.edit({ instruction, text: t.text, kind: t.kind, pageName })
      if (res.ok) push({ role: 'assistant', content: res.reply || 'Done.', edited: res.edited, editTarget: res.edited ? { label: t.label, kind: t.kind } : undefined })
      else push({ role: 'assistant', content: `⚠ ${res.error ?? 'Producer error'}` })
    } catch (err) {
      push({ role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Producer error'}` })
    } finally {
      setBusy(false)
    }
  }

  /**
   * "Do it" — turn the request into a VALIDATED action plan via the same engine as the
   * AI Command tab (write script / build video / thumbnail / image / music / ideas /
   * analyze PSX / plan scenes / scriptpad). The model only picks from that safe action
   * set; nothing runs until the user clicks "Run it". This is the on-every-tab "do it
   * for me" — real actions, not just chat.
   */
  async function doIt(text: string): Promise<void> {
    push({ role: 'user', content: text })
    setBusy(true)
    try {
      const p = await window.api.agent.interpret(text)
      if (!p.steps.length) {
        push({ role: 'assistant', content: p.reply || 'I couldn\'t turn that into an action. Try e.g. "write a 1-minute script about gold and build it in 1080p".' })
      } else {
        push({ role: 'assistant', content: p.reply || 'Here\'s the plan:', plan: p })
      }
    } catch (err) {
      push({ role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : 'Could not plan that.'}` })
    } finally {
      setBusy(false)
    }
  }

  /** Executes an approved plan through the validated engine, streaming progress. */
  async function runPlan(p: AgentPlan, msgIndex: number): Promise<void> {
    // The progress channel is shared with the Expert widget — never run both at once.
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
      toast(`Producer ran ${ok}/${out.length} steps ✓`, 'success')
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
    if (mode === 'edit') await runEdit(text)
    else if (mode === 'do') await doIt(text)
    else await chat(text)
  }

  function applyEdit(edited: string, editTarget?: { label: string; kind: string }): void {
    const t = getProducerTarget()
    if (!t) {
      toast('That field is no longer open — switch back to it and try again.', 'error')
      return
    }
    // Refuse to write a rewrite into a DIFFERENT field than it was generated for.
    if (editTarget && (t.kind !== editTarget.kind || t.label !== editTarget.label)) {
      toast(`This rewrite was for your ${editTarget.label} — switch back to it to apply.`, 'error')
      return
    }
    t.apply(edited)
    toast(`Applied to ${t.label} ✓`, 'success')
  }

  const actions = target ? QUICK_ACTIONS[target.kind] ?? QUICK_ACTIONS.script : []

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 rounded-full bg-gold-500 hover:bg-gold-400 text-ink-950 font-medium shadow-lg px-4 py-3 text-sm transition-colors"
          title="Your YouTube Producer"
        >
          🎬 Producer
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[94vw] rounded-lg border border-ink-700 bg-ink-900 shadow-2xl flex flex-col" style={{ height: '540px' }}>
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <div className="text-sm text-ink-100">
              YouTube Producer
              <span className="ml-2 text-[10px] text-ink-500">· {target ? `editing ${target.label}` : pageName}</span>
            </div>
            <div className="flex items-center gap-2">
              {msgs.length > 0 && <button onClick={() => setMsgs([])} className="text-[11px] text-ink-500 hover:text-ink-300">Clear</button>}
              <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-100 text-sm">✕</button>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-800">
            <div className="inline-flex rounded-md border border-ink-700 overflow-hidden text-[11px]">
              <button onClick={() => setMode('chat')} className={`px-2.5 py-1 ${mode === 'chat' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>Advise</button>
              <button onClick={() => target && setMode('edit')} disabled={!target} className={`px-2.5 py-1 ${mode === 'edit' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'} disabled:opacity-40`}>Edit my {target?.kind ?? 'text'}</button>
              <button onClick={() => setMode('do')} className={`px-2.5 py-1 ${mode === 'do' ? 'bg-gold-500 text-ink-950' : 'text-ink-300'}`}>Do it</button>
            </div>
            <div className="ml-auto inline-flex rounded-md border border-ink-700 overflow-hidden text-[10px]" title="How much detail answers should have">
              <button onClick={() => setDensity('detailed')} className={`px-2 py-1 ${density === 'detailed' ? 'bg-ink-700 text-gold-300' : 'text-ink-400'}`}>📖 Detailed</button>
              <button onClick={() => setDensity('brief')} className={`px-2 py-1 ${density === 'brief' ? 'bg-ink-700 text-gold-300' : 'text-ink-400'}`}>⚡ Brief</button>
            </div>
          </div>
          <div className="px-3 py-1 border-b border-ink-800 text-[10px] text-ink-600">
            {mode === 'edit' ? 'Rewrites apply only when you click Apply.' : mode === 'do' ? 'I plan real actions — you click Run.' : 'Ask anything — growth advice, or HOW to do anything in the app (I know every tab).'}
          </div>

          {/* Quick actions */}
          {target && actions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-ink-800">
              {actions.map((a) => (
                <button key={a.label} onClick={() => void runEdit(a.instruction)} disabled={busy} className="rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40">
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <p className="text-[11px] text-ink-500">
                I'm your producer — I obsess over hooks, titles, thumbnails, pacing and retention, and I know
                every tab of this studio. Ask me &ldquo;how do I…?&rdquo; anything (use 📖/⚡ above to pick full steps or
                quick bullets).{' '}
                {target ? (
                  <>Use the chips above or switch to <span className="text-ink-300">Edit</span> to rewrite your <span className="text-ink-300">{target.label}</span> — you approve every change with Apply.</>
                ) : (
                  <>Open Script Writer, Script Pad or the Storyboard and I can rewrite it directly.</>
                )}
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className="text-[12px] leading-relaxed">
                <span className={m.role === 'user' ? 'text-gold-400' : 'text-emerald-400'}>{m.role === 'user' ? 'You' : 'Producer'}: </span>
                <span className={`whitespace-pre-wrap ${m.role === 'user' ? 'text-ink-100' : 'text-ink-300'}`}>{m.content || (busy && i === msgs.length - 1 ? '…' : '')}</span>
                {m.plan && (
                  <div className="mt-2 rounded-md border border-ink-700 bg-ink-950 p-2">
                    <div className="text-[10px] text-ink-500 mb-1">Plan · {m.plan.steps.length} step{m.plan.steps.length > 1 ? 's' : ''}</div>
                    <ul className="list-disc pl-4 text-[11px] text-ink-300 space-y-0.5">
                      {m.plan.steps.map((s, k) => (
                        <li key={k}>{s.type.replace(/_/g, ' ')}</li>
                      ))}
                    </ul>
                    {!m.ran && (
                      <button onClick={() => void runPlan(m.plan as AgentPlan, i)} disabled={busy} className="mt-2 rounded bg-gold-500 hover:bg-gold-400 text-ink-950 text-[11px] font-medium px-3 py-1 disabled:opacity-40">
                        ▶ Run it
                      </button>
                    )}
                  </div>
                )}
                {m.edited && (
                  <div className="mt-2 rounded-md border border-ink-700 bg-ink-950 p-2">
                    <div className="text-[10px] text-ink-500 mb-1">Proposed rewrite</div>
                    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-ink-300">{m.edited}</div>
                    <button onClick={() => applyEdit(m.edited as string, m.editTarget)} className="mt-2 rounded bg-gold-500 hover:bg-gold-400 text-ink-950 text-[11px] font-medium px-3 py-1">
                      Apply to {m.editTarget?.label ?? target?.label ?? 'field'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-ink-800 p-2 flex gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSend()}
              placeholder={mode === 'edit' ? 'Tell me how to rewrite it…' : mode === 'do' ? 'Tell me what to make…' : 'Ask your producer…'}
              className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-xs text-ink-100 outline-none focus:border-gold-500"
            />
            <MicButton onText={(t) => setInput((prev) => appendDictation(prev, t))} className="px-2 py-2" />
            <button onClick={onSend} disabled={busy || !input.trim()} className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-ink-950 text-xs font-medium px-3 py-2 transition-colors">
              {busy ? '…' : mode === 'edit' ? 'Rewrite' : mode === 'do' ? 'Plan' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
