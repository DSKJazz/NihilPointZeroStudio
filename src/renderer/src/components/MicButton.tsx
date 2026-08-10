import { useEffect, useRef, useState } from 'react'

/** Appends newly-dictated text to an existing field value with a single space. */
export function appendDictation(existing: string, text: string): string {
  return existing.trim() ? `${existing.trim()} ${text}` : text
}

type MicState = 'idle' | 'recording' | 'working' | 'error' | 'heard-nothing'

/**
 * A small dictation button. Records from the mic, sends the clip to the offline
 * Whisper model in the main process, and hands the transcribed text back via
 * onText. Click to start, click again to stop → transcribe. Fully offline/free.
 */
export default function MicButton({
  onText,
  className = ''
}: {
  onText: (text: string) => void
  className?: string
}) {
  const [state, setState] = useState<MicState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Release the mic if the component unmounts mid-recording (switching tabs) — otherwise
  // the MediaStream stays live and the OS mic indicator stays on. Privacy/resource leak.
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop()
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // True from the moment start() is called until getUserMedia settles. A second
  // click during that window used to open a SECOND mic stream that nothing ever
  // stopped — the OS mic indicator then stayed on for the rest of the session.
  const startingRef = useRef(false)

  async function start(): Promise<void> {
    if (startingRef.current || streamRef.current) return
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setState('working')
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const text = await window.api.speech.transcribe(bytes)
          if (text && text.trim()) {
            onText(text)
            setState('idle')
          } else {
            // Nothing transcribed must LOOK different from success, or a dead/wrong
            // microphone is indistinguishable from working dictation.
            setState('heard-nothing')
            setTimeout(() => setState('idle'), 3000)
          }
        } catch {
          setState('error')
          setTimeout(() => setState('idle'), 2500)
        }
      }
      rec.start()
      recorderRef.current = rec
      setState('recording')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    } finally {
      startingRef.current = false
    }
  }

  function handleClick(): void {
    if (state === 'recording') recorderRef.current?.stop()
    else if (state === 'idle' || state === 'error' || state === 'heard-nothing') void start()
  }

  const label =
    state === 'recording'
      ? '⏹ Stop'
      : state === 'working'
        ? '… transcribing'
        : state === 'error'
          ? '⚠ mic error'
          : state === 'heard-nothing'
            ? '🔇 heard nothing'
            : '🎤 Speak'
  const tone =
    state === 'recording'
      ? 'border-red-500 text-red-300'
      : state === 'error'
        ? 'border-red-500/60 text-red-300'
        : state === 'heard-nothing'
          ? 'border-amber-500/60 text-amber-300'
          : 'border-ink-600 hover:border-gold-500 text-ink-300 hover:text-gold-400'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'working'}
      title="Dictate — speak instead of typing (offline). English → English, Urdu → Urdu script."
      className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60 ${tone} ${className}`}
    >
      {label}
    </button>
  )
}
