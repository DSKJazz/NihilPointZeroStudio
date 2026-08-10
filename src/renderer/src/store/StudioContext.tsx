import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GeneratedScript, LanguageMix, ScriptLength, ScriptStyle, VideoIdea } from '../../../shared/types'
import type { SaveStatus } from '../hooks/useAutosave'

/**
 * App-level state that must survive tab navigation. The provider lives above the
 * router in App, so switching pages does not unmount it — inputs and last results
 * persist. Nothing here is ever reset automatically: the only resets are the
 * explicit user-triggered clearIdeas()/clearWriter() functions, wired solely to
 * the per-tab "Clear" buttons.
 */

export interface IdeasState {
  focusArea: string
  audienceNote: string
  count: number
  ideas: VideoIdea[]
}

export interface WriterState {
  topic: string
  ideaContext: string
  audienceNote: string
  verifiedData: string
  length: ScriptLength
  languageMix: LanguageMix
  styles: ScriptStyle[]
  script: GeneratedScript | null
  body: string
  thumbnailBrief: string | null
}

export interface SceneState {
  title: string
  body: string
}

const DEFAULT_IDEAS: IdeasState = {
  focusArea: 'Pakistan economy & personal finance',
  audienceNote: '',
  count: 5,
  ideas: []
}

const DEFAULT_WRITER: WriterState = {
  topic: '',
  ideaContext: '',
  audienceNote: '',
  verifiedData: '',
  length: 'long',
  languageMix: 'balanced',
  styles: ['standard'],
  script: null,
  body: '',
  thumbnailBrief: null
}

const DEFAULT_SCENE: SceneState = {
  title: '',
  body: ''
}

interface StudioContextValue {
  ideas: IdeasState
  setIdeas: (patch: Partial<IdeasState> | ((prev: IdeasState) => Partial<IdeasState>)) => void
  clearIdeas: () => void
  writer: WriterState
  /**
   * Accepts a patch OR an updater reading the LATEST state. The updater form is
   * for async completions (dictation transcripts): a plain patch built from the
   * render-time value silently overwrote anything typed while the mic was busy.
   */
  setWriter: (patch: Partial<WriterState> | ((prev: WriterState) => Partial<WriterState>)) => void
  clearWriter: () => void
  scene: SceneState
  setScene: (patch: Partial<SceneState> | ((prev: SceneState) => Partial<SceneState>)) => void
  clearScene: () => void
  /** Autosave status for a "Saving…/Saved ✓" indicator. */
  saveStatus: SaveStatus
}

const StudioContext = createContext<StudioContextValue | null>(null)
const DRAFT_KEY = 'studio'

export function StudioProvider({ children }: { children: ReactNode }) {
  const [ideas, setIdeasState] = useState<IdeasState>(DEFAULT_IDEAS)
  const [writer, setWriterState] = useState<WriterState>(DEFAULT_WRITER)
  const [scene, setSceneState] = useState<SceneState>(DEFAULT_SCENE)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const loaded = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore the last session once on startup — so Ideas & Writer survive close/restart.
  useEffect(() => {
    void (async () => {
      try {
        const d = await window.api.drafts.get(DRAFT_KEY)
        const cur = d?.current as { ideas?: IdeasState; writer?: WriterState; scene?: SceneState } | undefined
        if (cur?.ideas) setIdeasState((p) => ({ ...p, ...cur.ideas }))
        if (cur?.writer) setWriterState((p) => ({ ...p, ...cur.writer }))
        if (cur?.scene) setSceneState((p) => ({ ...p, ...cur.scene }))
      } finally {
        loaded.current = true
      }
    })()
  }, [])

  // Autosave (debounced) whenever Ideas/Writer/Scene change.
  useEffect(() => {
    if (!loaded.current) return
    setSaveStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      window.api.drafts
        .set(DRAFT_KEY, { ideas, writer, scene })
        .then(() => setSaveStatus('saved'))
        // A failed write must not sit on "Saving…" forever pretending to work.
        .catch(() => setSaveStatus('error'))
    }, 600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [ideas, writer, scene])

  const value: StudioContextValue = {
    ideas,
    setIdeas: (patch) => setIdeasState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
    clearIdeas: () => setIdeasState(DEFAULT_IDEAS),
    writer,
    setWriter: (patch) => setWriterState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
    clearWriter: () => setWriterState(DEFAULT_WRITER),
    scene,
    setScene: (patch) => setSceneState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
    clearScene: () => setSceneState(DEFAULT_SCENE),
    saveStatus
  }

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio must be used within StudioProvider')
  return ctx
}
