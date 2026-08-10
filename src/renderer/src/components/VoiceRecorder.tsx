import { useEffect, useRef, useState } from 'react'
import type { VideoJob } from '../../../shared/types'

type Phase = 'idle' | 'recording' | 'paused' | 'ready'

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * In-tab voice-over studio (lives inside Video Studio, under each built video).
 * Record with Pause/Resume, review with a scrubber, "Redo from here" (punch-in: keeps
 * everything before the playhead and re-records the rest), re-record from scratch, then
 * attach — either REPLACING the video's audio or KEEPING it and adding your voice on top.
 * All free/offline (mic + bundled ffmpeg).
 */
export default function VoiceRecorder({
  job,
  onDone,
  onPlayVideo
}: {
  job: VideoJob
  onDone: (newJob: VideoJob) => void
  /** Plays the built video from the top, so the user can perform along to it. */
  onPlayVideo?: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [take, setTake] = useState<{ bytes: Uint8Array; url: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [playAlong, setPlayAlong] = useState(true)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const redoFromRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const takeRef = useRef<{ bytes: Uint8Array; url: string } | null>(null)
  const camPreviewRef = useRef<HTMLVideoElement | null>(null)
  // Whether the take currently held was captured with the camera on. Read inside the
  // recorder's onstop, so it must be a ref, not state.
  const cameraRef = useRef(false)
  const mountedRef = useRef(true)
  const startingRef = useRef(false)
  const [takeIsVideo, setTakeIsVideo] = useState(false)

  useEffect(() => {
    takeRef.current = take
  }, [take])

  // Clean up mic/camera + object URLs when the panel closes.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
      if (takeRef.current) URL.revokeObjectURL(takeRef.current.url)
    }
  }, [])

  function startTimer(reset: boolean): void {
    if (reset) setElapsed(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }
  function stopTimer(): void {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  function setTakeFrom(bytes: Uint8Array, mime: string): void {
    if (takeRef.current) URL.revokeObjectURL(takeRef.current.url)
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
    setTake({ bytes, url })
  }

  /**
   * redoFrom is passed in rather than set by the caller beforehand: when a redo failed
   * (mic busy, permission denied) a pre-set value used to survive, so the next plain
   * "Record again" silently spliced onto the old take instead of replacing it. Setting
   * it here means every start states its own intent.
   */
  async function beginRecording(redoFrom: number | null = null): Promise<void> {
    // Guard against a second start while the first getUserMedia is still pending: the
    // permission prompt leaves the UI in its idle state for seconds, so a double-click
    // would otherwise open two streams and leave one running with the camera light on.
    if (startingRef.current) return
    startingRef.current = true
    redoFromRef.current = redoFrom
    setError(null)
    setSavedMsg(null)
    // A punch-in ("redo from playhead") is an AUDIO re-assembly. If the camera toggle
    // was flipped on after the take, honouring it here recorded video instead — the
    // punch-in branch was then skipped and the WHOLE previous take silently replaced.
    const withCamera = camera && redoFrom == null
    cameraRef.current = withCamera
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        withCamera ? { audio: true, video: { width: 1280, height: 720 } } : { audio: true }
      )
      // The panel can be closed while the permission prompt is up. If that happened, this
      // stream has no owner and nothing left to stop it — shut it down here or the webcam
      // stays lit for the rest of the session.
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      if (withCamera && camPreviewRef.current) {
        camPreviewRef.current.srcObject = stream
        void camPreviewRef.current.play().catch(() => {})
      }
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = handleStop
      rec.start()
      recRef.current = rec
      setPhase('recording')
      startTimer(true)
      // Roll the finished video at the same moment, so this really is "record yourself
      // over the generated video" rather than performing blind.
      if (playAlong) onPlayVideo?.()
    } catch {
      setError(
        withCamera
          ? 'Could not access the camera or microphone. Check Windows camera/mic permissions.'
          : 'Could not access the microphone. Check Windows mic permissions.'
      )
      setPhase(take ? 'ready' : 'idle')
    } finally {
      startingRef.current = false
    }
  }

  async function handleStop(): Promise<void> {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (camPreviewRef.current) camPreviewRef.current.srcObject = null
    stopTimer()
    setBusy(true)
    const wasCamera = cameraRef.current
    try {
      const mime = wasCamera ? 'video/webm' : 'audio/webm'
      const seg = new Uint8Array(await new Blob(chunksRef.current, { type: mime }).arrayBuffer())
      const cutAt = redoFromRef.current
      const prev = takeRef.current
      // Punch-in re-assembly is an audio operation; a camera take is kept whole.
      if (!wasCamera && cutAt != null && prev) {
        const assembled = await window.api.video.assembleVoice([
          { bytes: prev.bytes, endSec: cutAt },
          { bytes: seg }
        ])
        setTakeFrom(assembled, 'audio/wav')
        setTakeIsVideo(false)
      } else {
        setTakeFrom(seg, mime)
        setTakeIsVideo(wasCamera)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the recording.')
    } finally {
      redoFromRef.current = null
      setBusy(false)
      setPhase('ready')
    }
  }

  /** Camera takes become their own clip in Video Studio — no tab round-trip. */
  async function saveCameraTake(enhance: boolean): Promise<void> {
    if (!take) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.recorder.save(take.bytes, 'camera', enhance)
      if (res.ok && res.video) {
        setSavedMsg(`Saved as “${res.video.title}” — it is now in your Video Studio list below.`)
      } else {
        setError(res.error || 'Could not save the recording.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the recording.')
    } finally {
      setBusy(false)
    }
  }

  function pause(): void {
    recRef.current?.pause()
    stopTimer()
    setPhase('paused')
  }
  function resume(): void {
    recRef.current?.resume()
    startTimer(false)
    setPhase('recording')
  }
  function stop(): void {
    recRef.current?.stop()
  }

  function reRecord(): void {
    void beginRecording(null)
  }
  function redoFromPlayhead(): void {
    void beginRecording(audioRef.current?.currentTime ?? 0)
  }

  async function applyTake(mode: 'replace' | 'add'): Promise<void> {
    if (!take) return
    setBusy(true)
    setError(null)
    try {
      const newJob =
        mode === 'replace'
          ? await window.api.video.attachVoice(job.id, take.bytes)
          : await window.api.video.addVoice(job.id, take.bytes)
      onDone(newJob as VideoJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the voice-over.')
    } finally {
      setBusy(false)
    }
  }

  const recording = phase === 'recording' || phase === 'paused'

  return (
    <div className="mt-2 rounded-md border border-ink-700 bg-ink-900/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gold-300 font-medium">🎙 Voice studio</span>
        {recording && <span className="text-[11px] text-red-300 tabular-nums">● {mmss(elapsed)}</span>}
      </div>

      {/* What to capture. The camera option lives HERE rather than on a separate tab,
          because this is where someone is already recording over their video. */}
      {!recording && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-ink-700 overflow-hidden">
            <button
              onClick={() => setCamera(false)}
              className={`px-3 py-1.5 text-xs transition-colors ${!camera ? 'bg-ink-700 text-gold-300' : 'text-ink-400 hover:text-ink-200'}`}
            >
              🎙 Voice only
            </button>
            <button
              onClick={() => setCamera(true)}
              className={`px-3 py-1.5 text-xs transition-colors ${camera ? 'bg-ink-700 text-gold-300' : 'text-ink-400 hover:text-ink-200'}`}
            >
              🎥 Voice + camera
            </button>
          </div>
          {onPlayVideo && (
            <label className="flex items-center gap-1.5 text-[11px] text-ink-400 cursor-pointer">
              <input type="checkbox" checked={playAlong} onChange={(e) => setPlayAlong(e.target.checked)} className="accent-gold-500" />
              Play the video while I record
            </label>
          )}
        </div>
      )}
      {!recording && playAlong && onPlayVideo && (
        <div className="text-[10px] text-ink-600">
          Tip: wear headphones. On speakers your microphone will also pick up the video’s own sound.
        </div>
      )}

      {/* Live camera preview — only mounted in camera mode so the webcam light is never
          on when the user picked voice-only. */}
      {camera && (
        <video
          ref={camPreviewRef}
          muted
          playsInline
          className={`w-full max-w-xs rounded-md border border-ink-700 bg-ink-950 ${recording ? '' : 'hidden'}`}
        />
      )}

      {/* Recording controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!recording && (
          <button onClick={() => void beginRecording()} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40">
            ● {take ? 'Record again' : 'Start recording'}
          </button>
        )}
        {phase === 'recording' && (
          <button onClick={pause} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500">⏸ Pause</button>
        )}
        {phase === 'paused' && (
          <button onClick={resume} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">▶ Resume</button>
        )}
        {recording && (
          <button onClick={stop} className="rounded-md bg-ink-700 px-3 py-1.5 text-xs font-medium text-ink-100 hover:bg-ink-600">⏹ Stop</button>
        )}
        {busy && <span className="text-[11px] text-gold-300">working…</span>}
      </div>

      {/* Review + edit the take */}
      {take && !recording && (
        <div className="space-y-2">
          {takeIsVideo ? (
            <video src={take.url} controls className="w-full max-w-sm rounded-md border border-ink-700" />
          ) : (
            <audio ref={audioRef} src={take.url} controls className="w-full" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!takeIsVideo && (
              <button onClick={redoFromPlayhead} disabled={busy} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-gold-500 disabled:opacity-40">
                ↻ Redo from playhead (keep the part before it)
              </button>
            )}
            <button onClick={reRecord} disabled={busy} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-gold-500 disabled:opacity-40">
              ⟲ Re-record from scratch
            </button>
          </div>
          <div className="rounded-md border border-ink-700 bg-ink-950 p-2">
            {takeIsVideo ? (
              <>
                <div className="text-[11px] text-ink-400 mb-1">Use this camera recording:</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void saveCameraTake(false)} disabled={busy} className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
                    Save to Video Studio
                  </button>
                  <button onClick={() => void saveCameraTake(true)} disabled={busy} className="rounded-md border border-gold-500/60 px-3 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/10 disabled:opacity-40">
                    Save + clean up voice/picture
                  </button>
                  <button onClick={() => void applyTake('replace')} disabled={busy} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-gold-500 disabled:opacity-40">
                    Use only its sound as this video’s narration
                  </button>
                </div>
                <div className="mt-1 text-[10px] text-ink-600">
                  Saved recordings appear in your Video Studio list, ready for Presenter Studio, trimming or export —
                  no need to leave this tab.
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] text-ink-400 mb-1">Use this voice-over:</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void applyTake('replace')} disabled={busy} className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-40">
                    Replace the video’s narration
                  </button>
                  <button onClick={() => void applyTake('add')} disabled={busy} className="rounded-md border border-gold-500/60 px-3 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/10 disabled:opacity-40">
                    Keep existing audio + add my voice
                  </button>
                </div>
                <div className="mt-1 text-[10px] text-ink-600">
                  “Replace” swaps the audio for your recording. “Keep + add” layers your voice over whatever the video already has.
                  A new video is created; your original is kept.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {savedMsg && <div className="text-[11px] text-emerald-300">{savedMsg}</div>}

      {error && <div className="text-[11px] text-red-300">{error}</div>}
    </div>
  )
}
