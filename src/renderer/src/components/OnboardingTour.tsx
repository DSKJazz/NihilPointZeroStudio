import { useEffect, useState } from 'react'

/**
 * First-run welcome tour — so the huge feature set doesn't require re-learning
 * after time away (or a cold start for anyone new). Shows once (a local flag
 * remembers), can be replayed any time from Settings → "Show the welcome tour".
 * Deliberately a simple card carousel: nothing is blocked, Skip always works.
 */
const STEPS: { emoji: string; title: string; text: string }[] = [
  {
    emoji: '👋',
    title: 'Welcome to your studio',
    text: 'This app turns an idea into a finished, narrated video — script, visuals, voice, music, captions — mostly free and offline. This 60-second tour shows where things live.'
  },
  {
    emoji: '🎬',
    title: 'Three ways to make a video',
    text: '✦ AI Command: type what you want ("make a 2-minute video about the rupee") and approve the plan. 🎬 Scene Studio: build it scene by scene with pictures you approve. Video Studio: full manual control — script, engine, voice, music, captions.'
  },
  {
    emoji: '🎥',
    title: 'REAL AI video, honestly labeled',
    text: 'In "Video look (engine)": Style presets and the Photo slideshow are always free. "REAL AI video — free cloud" makes true moving video (needs a free Pollinations key — Settings → AI Video explains). The local-GPU tier unlocks when this PC ever has an NVIDIA card.'
  },
  {
    emoji: '🎙',
    title: 'Voices — yours is best',
    text: 'Every video can be narrated by the natural voice, Windows voices (including Urdu Asad/Uzma once installed), or YOUR own recording — the 🎙 Voice studio on any built video lets you re-record over it.'
  },
  {
    emoji: '🧭',
    title: 'Two helpers, always floating',
    text: 'The 🧭 Expert (bottom-left) knows every tab and can walk you anywhere or run steps for you. The 🎬 Producer (bottom-right) sharpens hooks, titles and scripts. Ask either in plain words.'
  },
  {
    emoji: '🩺',
    title: 'When something feels off',
    text: 'Settings → "Run full check" live-tests everything (internet, AI, keys). Settings → "Known Issues" is the provable log of every AI failure and tab crash. Builds always tell you which engine really ran and why anything fell back.'
  }
]

const FLAG = 'npz-tour-done'

export default function OnboardingTour(): React.JSX.Element | null {
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FLAG) === null
    } catch {
      return false
    }
  })

  // Settings can replay the tour without a reload.
  useEffect(() => {
    const show = (): void => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener('npz-show-tour', show)
    return () => window.removeEventListener('npz-show-tour', show)
  }, [])

  function close(): void {
    try {
      localStorage.setItem(FLAG, new Date().toISOString())
    } catch {
      /* storage unavailable — the tour will show again, which is harmless */
    }
    setOpen(false)
  }

  if (!open) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/80 p-6">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <div className="text-4xl" aria-hidden>
          {s.emoji}
        </div>
        <h2 className="mt-3 text-lg font-medium text-ink-100">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">{s.text}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-gold-400' : 'bg-ink-700'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="rounded-md px-3 py-1.5 text-xs text-ink-400 hover:text-ink-200">
              Skip tour
            </button>
            {step > 0 && (
              <button
                onClick={() => setStep((n) => n - 1)}
                className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-ink-400"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? close() : setStep((n) => n + 1))}
              className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-gold-400"
            >
              {last ? 'Start creating' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
