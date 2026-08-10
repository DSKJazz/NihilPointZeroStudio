import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import MicButton, { appendDictation } from '../components/MicButton'
import BusyTimer from '../components/BusyTimer'
import { confirmDialog } from '../components/Confirm'
import { useStudio } from '../store/StudioContext'

export default function AdvisorPage() {
  const { writer } = useStudio()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.advisor.history().then(setMessages)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  function buildContext(): string {
    const parts: string[] = []
    if (writer.topic?.trim()) parts.push(`Topic being worked on: ${writer.topic.trim()}`)
    if (writer.styles?.length) parts.push(`Selected styles: ${writer.styles.join(', ')}`)
    if (writer.length) parts.push(`Target length: ${writer.length}`)
    if (writer.body?.trim()) parts.push(`Current script excerpt:\n${writer.body.trim().slice(0, 1500)}`)
    return parts.join('\n')
  }

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setStreaming('')
    const convo = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text }
    ]
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() }
    ])
    let acc = ''
    const unsubscribe = window.api.advisor.onStream((delta) => {
      acc += delta
      setStreaming(acc)
    })
    try {
      await window.api.advisor.send({ messages: convo, context: buildContext() })
      setMessages(await window.api.advisor.history()) // canonical ids for delete
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Advisor request failed.',
          createdAt: new Date().toISOString()
        }
      ])
    } finally {
      unsubscribe()
      setStreaming('')
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this message?',
      message: 'This removes the message from your saved advisor conversation.',
      danger: true
    })
    if (!ok) return
    if (id.startsWith('local-') || id.startsWith('err-')) {
      setMessages((prev) => prev.filter((m) => m.id !== id))
      return
    }
    setMessages(await window.api.advisor.remove(id))
  }

  async function clearAll(): Promise<void> {
    // Same modal as deleting ONE message — deleting ALL memory must never be
    // easier than deleting one (a double-click used to wipe it with no dialog).
    const ok = await confirmDialog({
      title: 'Clear the whole conversation?',
      message: 'Permanently deletes all saved advisor messages. There is no undo.',
      confirmLabel: 'Clear all',
      danger: true
    })
    if (!ok) return
    setMessages(await window.api.advisor.clear())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif text-ink-100">Advisor</h1>
          <p className="text-ink-400 text-sm mt-1">
            A candid strategy partner. It reasons about your current topic/script and tells you what would work
            better. Everything is saved to memory — only you can delete it.
          </p>
        </div>
        <button
          onClick={clearAll}
          className="shrink-0 rounded-md border border-ink-700 hover:border-ink-500 text-ink-400 text-xs px-3 py-1.5 transition-colors"
        >
          Clear conversation
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto mt-6 space-y-4 pr-1">
        {messages.length === 0 && !streaming && (
          <div className="text-ink-600 text-sm rounded-lg border border-dashed border-ink-700 p-6 text-center">
            Ask for a second opinion on a topic, a title, an angle, or paste a task. e.g. “Is ‘Pakistan debt crisis’
            too saturated? Give me a sharper angle.”
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`relative max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-gold-500/15 text-ink-100 border border-gold-500/30' : 'bg-ink-900 border border-ink-700 text-ink-200'
              }`}
            >
              {m.content}
              <button
                onClick={() => remove(m.id)}
                title="Delete this message"
                className="absolute -top-2 -right-2 hidden group-hover:block rounded-full bg-ink-800 border border-ink-600 text-ink-400 hover:text-red-300 h-5 w-5 text-xs leading-none"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-ink-900 border border-ink-700 text-ink-200">
              {streaming}
              <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-gold-400 animate-pulse" />
            </div>
          </div>
        )}
        {busy && !streaming && <BusyTimer label="Advisor is thinking" />}
      </div>

      <div className="mt-4 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the advisor… (Enter to send, Shift+Enter for a new line)"
          className="flex-1 rounded-md bg-ink-800 border border-ink-700 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-500 resize-none"
        />
        <div className="flex flex-col gap-1.5">
          <MicButton onText={(t) => setInput((prev) => appendDictation(prev, t))} className="px-3 py-1" />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-md bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium px-4 py-2 text-sm transition-colors"
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
