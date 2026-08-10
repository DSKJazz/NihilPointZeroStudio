import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Command {
  label: string
  hint: string
  run: () => void
}

/**
 * Command palette — press Ctrl-K (or Cmd-K) anywhere to jump to any tab or run a
 * common action by typing. Arrow keys to move, Enter to run, Esc to close. Makes the
 * whole app navigable in one keystroke.
 */
export default function CommandPalette(): React.JSX.Element | null {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useMemo<Command[]>(() => {
    const go = (path: string): (() => void) => () => {
      navigate(path)
      setOpen(false)
    }
    return [
      { label: 'AI Command', hint: 'tell the studio what to do', run: go('/agent') },
      { label: 'Scene Studio', hint: 'build scene-by-scene', run: go('/scenes') },
      { label: 'Video Studio', hint: 'build / edit / publish videos', run: go('/video') },
      { label: 'Script Writer', hint: 'generate a script', run: go('/writer') },
      { label: 'Script Pad', hint: 'write your own', run: go('/scriptpad') },
      { label: 'Today', hint: 'home: latest videos & activity', run: go('/') },
      { label: 'Ideas & Trends', hint: 'brainstorm ideas', run: go('/ideas') },
      { label: 'Charts', hint: 'price charts', run: go('/charts') },
      { label: 'Advisor', hint: 'chat about your work', run: go('/advisor') },
      { label: 'Library', hint: 'saved ideas & scripts', run: go('/library') },
      { label: 'Activity Log', hint: 'history', run: go('/activity') },
      { label: 'Settings', hint: 'AI, voice, keys, health', run: go('/settings') }
    ]
  }, [navigate])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return commands
    return commands.filter((c) => (c.label + ' ' + c.hint).toLowerCase().includes(s))
  }, [q, commands])

  // Global Ctrl-K / Cmd-K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQ('')
        setSel(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    if (sel >= filtered.length) setSel(0)
  }, [filtered, sel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-28" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg rounded-lg border border-ink-700 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run() }
          }}
          placeholder="Jump to… (type a tab or action)"
          className="w-full rounded-t-lg bg-ink-950 border-b border-ink-800 px-4 py-3 text-sm text-ink-100 outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && <div className="px-4 py-3 text-xs text-ink-500">No matches.</div>}
          {filtered.map((c, i) => (
            <button
              key={c.label}
              onMouseEnter={() => setSel(i)}
              onClick={() => c.run()}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === sel ? 'bg-ink-800 text-gold-300' : 'text-ink-200'}`}
            >
              <span>{c.label}</span>
              <span className="text-[11px] text-ink-500">{c.hint}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-ink-800 px-4 py-1.5 text-[10px] text-ink-600">↑↓ move · Enter open · Esc close · Ctrl-K toggles</div>
      </div>
    </div>
  )
}
