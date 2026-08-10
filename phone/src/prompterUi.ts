/**
 * The teleprompter, on the phone.
 *
 * Same maths as the desktop one (src/shared/teleprompter.ts), so a run takes exactly
 * as long as it says it will and matches the timings the storyboard was planned with.
 *
 * The phone-specific parts:
 *  • it can read the narration straight out of the plan you built in Scenes, so you
 *    are reading the actual video, scene markers and all;
 *  • it asks the phone to stay awake, because a screen that sleeps mid-take is the
 *    single most annoying way for a prompter to fail;
 *  • tap anywhere on the text to pause and resume — you will not be holding a
 *    keyboard while you are talking to a camera.
 */
import {
  DEFAULT_WPM,
  MAX_WPM,
  MIN_WPM,
  clampWpm,
  countSpokenWords,
  formatClock,
  readingSeconds,
  scriptFromBeats,
  scrollPixelsPerSecond,
  suggestWpm,
  toPrompterLines
} from '../../src/shared/teleprompter'
import * as P from './project'
import { listSaved } from './store'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

let script = ''
let wpm = DEFAULT_WPM
let fontSize = 30
let running = false
let rafId: number | null = null
let startedAt = 0
let offsetPx = 0
/** Held while the prompter runs so the screen cannot dim mid-take. */
let wakeLock: { release: () => Promise<void> } | null = null

function scroller(): HTMLElement {
  return $('tp-scroll')
}

function totalSeconds(): number {
  return readingSeconds(script, wpm)
}

function scrollDistance(): number {
  const el = scroller()
  return Math.max(0, el.scrollHeight - el.clientHeight)
}

async function acquireWake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof wakeLock> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    // Not supported, or refused — the prompter still works, the screen may just dim.
    wakeLock = null
  }
}

function releaseWake(): void {
  void wakeLock?.release().catch(() => undefined)
  wakeLock = null
}

function stopLoop(): void {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
}

function tick(now: number): void {
  const distance = scrollDistance()
  const pps = scrollPixelsPerSecond(distance, totalSeconds())
  const px = offsetPx + pps * ((now - startedAt) / 1000)
  scroller().scrollTop = px
  renderClock(pps > 0 ? px / pps : 0)
  if (distance > 0 && px >= distance) {
    offsetPx = distance
    setRunning(false)
    return
  }
  rafId = requestAnimationFrame(tick)
}

function setRunning(on: boolean): void {
  running = on
  $('tp-play').textContent = on ? '❚❚' : '▶'
  if (on) {
    offsetPx = scroller().scrollTop
    startedAt = performance.now()
    void acquireWake()
    rafId = requestAnimationFrame(tick)
  } else {
    offsetPx = scroller().scrollTop
    stopLoop()
    releaseWake()
  }
}

function renderClock(elapsed: number): void {
  const total = totalSeconds()
  $('tp-clock').textContent = `${formatClock(Math.max(0, total - elapsed))} left`
}

function renderText(): void {
  const lines = toPrompterLines(script)
  scroller().innerHTML =
    `<div style="height:35vh"></div>` +
    lines
      .map((l) => {
        if (l.kind === 'blank') return `<div style="height:${Math.round(fontSize * 0.5)}px"></div>`
        const direction = l.kind === 'direction'
        return `<p style="font-size:${direction ? Math.round(fontSize * 0.62) : fontSize}px;line-height:1.45;margin:0 0 .5em;font-weight:${
          direction ? 400 : 600
        };color:${direction ? '#8a6f22' : '#ffffff'}">${esc(l.text)}</p>`
      })
      .join('') +
    `<div style="height:75vh"></div>`
  $('tp-words').textContent = `${countSpokenWords(script)} words · ${formatClock(totalSeconds())}`
  renderClock(0)
}

/** Fills the source picker with the current plan and any saved scripts. */
export function renderPrompter(): void {
  const sel = $<HTMLSelectElement>('tp-source')
  const scripts = listSaved().filter((i) => i.kind === 'script')
  const hasPlan = P.hasStoryboard()
  sel.innerHTML =
    (hasPlan ? `<option value="plan">My current plan (${P.beats().length} scenes)</option>` : '') +
    scripts.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('') +
    `<option value="paste">Paste my own text…</option>`
  $<HTMLInputElement>('tp-wpm').value = String(wpm)
  $('tp-wpm-label').textContent = `${wpm} wpm`
  $<HTMLInputElement>('tp-size').value = String(fontSize)
}

function loadSource(): void {
  const value = $<HTMLSelectElement>('tp-source').value
  $('tp-paste-row').classList.toggle('hidden', value !== 'paste')
  if (value === 'plan') {
    script = scriptFromBeats(P.beats())
  } else if (value === 'paste') {
    script = $<HTMLTextAreaElement>('tp-paste').value
  } else {
    script = listSaved().find((i) => i.id === value)?.body ?? ''
  }
  restart()
}

function restart(): void {
  setRunning(false)
  offsetPx = 0
  scroller().scrollTop = 0
  renderText()
}

export function wirePrompter(): void {
  $('tp-source').addEventListener('change', loadSource)
  $('tp-paste').addEventListener('input', () => {
    if ($<HTMLSelectElement>('tp-source').value === 'paste') {
      script = $<HTMLTextAreaElement>('tp-paste').value
      renderText()
    }
  })
  $('tp-play').addEventListener('click', () => setRunning(!running))
  $('tp-restart').addEventListener('click', restart)
  // Tapping the script itself is the control you can actually reach on a stand.
  $('tp-scroll').addEventListener('click', () => setRunning(!running))
  $('tp-wpm').addEventListener('input', (e) => {
    wpm = clampWpm(Number((e.target as HTMLInputElement).value))
    $('tp-wpm-label').textContent = `${wpm} wpm`
    renderClock(0)
  })
  $('tp-size').addEventListener('input', (e) => {
    fontSize = Number((e.target as HTMLInputElement).value)
    renderText()
  })
  $('tp-mirror').addEventListener('change', (e) => {
    scroller().style.transform = (e.target as HTMLInputElement).checked ? 'scaleX(-1)' : ''
  })
  for (const mins of [3, 5, 10, 15, 20]) {
    document.getElementById(`tp-fit-${mins}`)?.addEventListener('click', () => {
      const s = suggestWpm(script, mins * 60)
      if (!s) return
      wpm = s
      $<HTMLInputElement>('tp-wpm').value = String(wpm)
      $('tp-wpm-label').textContent = `${wpm} wpm`
      renderClock(0)
    })
  }
  // Losing the screen mid-run should stop the clock, not silently scroll on.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && running) setRunning(false)
  })
  $<HTMLInputElement>('tp-wpm').min = String(MIN_WPM)
  $<HTMLInputElement>('tp-wpm').max = String(MAX_WPM)
}

/** Called when the tab opens, so the picker reflects the latest plan and scripts. */
export function openPrompter(): void {
  renderPrompter()
  if (!script) loadSource()
}
