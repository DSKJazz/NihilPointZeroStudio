import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Undo/redo for structural editors (Timeline clips, Storyboard beats) — the places
 * where one wrong click used to be unrecoverable mid-session.
 *
 * Auto-records: every state change lands on the undo stack after a short debounce
 * (rapid slider drags collapse into one step), no call-site changes needed. Undo and
 * redo restore snapshots through the caller's own setter. Keyboard: Ctrl+Z / Ctrl+Y
 * (and Ctrl+Shift+Z), deliberately IGNORED while typing in an input/textarea — the
 * browser's native text undo owns those.
 */
export function useHistory<T>(
  state: T,
  restore: (value: T) => void
): { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } {
  const LIMIT = 60
  const DEBOUNCE_MS = 350
  const past = useRef<string[]>([])
  const future = useRef<string[]>([])
  const current = useRef<string>(JSON.stringify(state))
  const restoring = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreRef = useRef(restore)
  restoreRef.current = restore
  const [, bump] = useState(0)

  const serialized = JSON.stringify(state)

  useEffect(() => {
    if (serialized === current.current) return
    if (restoring.current) {
      // This change IS an undo/redo landing — record it as current, don't re-stack it.
      restoring.current = false
      current.current = serialized
      return
    }
    if (timer.current) clearTimeout(timer.current)
    const before = current.current
    current.current = serialized
    timer.current = setTimeout(() => {
      past.current.push(before)
      if (past.current.length > LIMIT) past.current.shift()
      future.current = [] // a fresh edit invalidates the redo branch
      bump((n) => n + 1)
    }, DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [serialized])

  const undo = useCallback((): void => {
    const prev = past.current.pop()
    if (prev === undefined) return
    future.current.push(current.current)
    restoring.current = true
    current.current = prev
    restoreRef.current(JSON.parse(prev) as T)
    bump((n) => n + 1)
  }, [])

  const redo = useCallback((): void => {
    const next = future.current.pop()
    if (next === undefined) return
    past.current.push(current.current)
    restoring.current = true
    current.current = next
    restoreRef.current(JSON.parse(next) as T)
    bump((n) => n + 1)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }
}
