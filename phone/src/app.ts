/**
 * NIHILPOINTZERO — phone app.
 *
 * A standalone home-screen app that works on mobile data with the PC switched
 * off. It does the thinking/writing half of the studio: Ideas, Script Writer,
 * Advisor, plus a thumbnail brief. It deliberately does NOT pretend to do video
 * rendering, voice-over, or subtitles — those need the PC's ffmpeg and Whisper
 * and are honestly labelled as such in the UI.
 */
import type { LanguageMix, ScriptLength, ScriptStyle } from '../../src/shared/types'
import { advisorStream, generateIdeas, generateScript, generateThumbnailBrief } from './ai'
import {
  getKey,
  getPcLink,
  getProvider,
  listSaved,
  remove,
  save,
  setKey,
  setPcLink,
  setProvider,
  type PhoneProvider,
  type SavedItem
} from './store'
import * as P from './project'
import * as Scenes from './scenesUi'
import { openProjectFile, pushToPc, saveToPhone, shareProject, type SendResult } from './send'
import { forgetPromptPack, hasPromptPack, loadPromptPack, syncPromptPack } from './promptCache'
import { ping } from './pc'
import { decideHandover, isServedByPc, safeStudioUrl, statusLine, type HandoverInputs } from './handover'
import { openPrompter, wirePrompter } from './prompterUi'
import { onMediaPicked } from './scenesUi'

/**
 * Stamped in at build time by scripts/build-phone.mjs. The fallback is what a
 * hand-run bundle without the define would show — never a lie about being current.
 */
declare const __PHONE_BUILD__: string
const BUILD_TAG = typeof __PHONE_BUILD__ === 'string' ? __PHONE_BUILD__ : 'unstamped build'

type TabName = 'ideas' | 'writer' | 'scenes' | 'video' | 'prompter' | 'advisor' | 'saved' | 'settings'

const TABS: TabName[] = ['ideas', 'writer', 'scenes', 'video', 'prompter', 'advisor', 'saved', 'settings']

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

function esc(s: string): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function val(id: string): string {
  return ($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.trim()
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Shows a spinner-ish busy label on a button and guarantees it is restored. */
async function withBusy<T>(btnId: string, busyLabel: string, fn: () => Promise<T>): Promise<T | null> {
  const btn = $<HTMLButtonElement>(btnId)
  const original = btn.textContent ?? ''
  btn.disabled = true
  btn.textContent = busyLabel
  try {
    return await fn()
  } catch (err) {
    return Promise.reject(err) as never
  } finally {
    btn.disabled = false
    btn.textContent = original
  }
}

function setError(id: string, err: unknown): void {
  $(id).innerHTML = `<div class="err">${esc(message(err))}</div>`
}

// ---------------------------------------------------------------- tabs

function showTab(name: TabName): void {
  for (const t of TABS) {
    $(`s-${t}`).classList.toggle('hidden', t !== name)
    const btn = document.getElementById(`t-${t}`)
    if (btn) btn.classList.toggle('on', t === name)
  }
  if (name === 'saved') renderSaved()
  if (name === 'scenes') Scenes.renderScenes()
  if (name === 'video') Scenes.renderVideoSettings()
  if (name === 'prompter') openPrompter()
  window.scrollTo(0, 0)
}

// ---------------------------------------------------------------- ideas

async function runIdeas(): Promise<void> {
  const out = $('i-out')
  const focusArea = val('i-focus')
  if (!focusArea) {
    setError('i-out', new Error('Type a focus area first — for example "Pakistan inflation".'))
    return
  }
  out.innerHTML = '<div class="muted">Thinking… this usually takes 10-30 seconds.</div>'
  try {
    await withBusy('i-go', 'Thinking…', async () => {
      const ideas = await generateIdeas({
        focusArea,
        audienceNote: val('i-aud') || undefined,
        count: Math.min(Math.max(Number(val('i-count')) || 5, 1), 10)
      })
      out.innerHTML = ideas
        .map(
          (i) => `<div class="card">
            <h3>${esc(i.title)}</h3>
            <div class="muted">Score ${esc(String(i.viewPotentialScore))}/10 · ${esc(i.competitionLevel)} competition</div>
            <pre>${esc(i.hook)}</pre>
            <div class="muted" style="margin-top:8px">${esc(i.angle)}</div>
            <div class="row">
              <button class="mini" data-use="${esc(i.title)}">Write this</button>
              <button class="mini" data-copy="${esc(`${i.title}\n\n${i.hook}\n\n${i.angle}`)}">Copy</button>
            </div>
          </div>`
        )
        .join('')
      save('idea', `${ideas.length} ideas — ${focusArea}`, ideas.map((i) => `${i.title}\n${i.hook}`).join('\n\n'))
    })
  } catch (err) {
    setError('i-out', err)
  }
}

// ---------------------------------------------------------------- writer

async function runScript(): Promise<void> {
  const out = $('w-out')
  const topic = val('w-topic')
  if (!topic) {
    setError('w-out', new Error('Type a topic first.'))
    return
  }
  const length = val('w-len') as ScriptLength
  out.innerHTML = `<div class="muted">Writing… ${
    length === 'short' ? 'about 30 seconds' : 'a long script can take 1-3 minutes. Keep the screen on.'
  }</div>`
  try {
    await withBusy('w-go', 'Writing…', async () => {
      const script = await generateScript({
        topic,
        length,
        languageMix: val('w-lang') as LanguageMix,
        styles: [val('w-style') as ScriptStyle]
      })
      const words = script.body.trim().split(/\s+/).length
      out.innerHTML = `<div class="card">
        <h3>${esc(script.title)}</h3>
        <div class="muted">${words} words · roughly ${Math.round(words / 150)} min spoken · saved on this phone</div>
        <pre>${esc(script.body)}</pre>
        <div class="row">
          <button class="mini" data-copy="${esc(`${script.title}\n\n${script.body}`)}">Copy</button>
          <button class="mini" data-share="${esc(script.title)}" data-sharebody="${esc(script.body)}">Send to PC</button>
        </div>
      </div>`
      save('script', script.title, script.body)
    })
  } catch (err) {
    setError('w-out', err)
  }
}

async function runThumbnail(): Promise<void> {
  const topic = val('w-topic')
  if (!topic) {
    setError('w-out', new Error('Type a topic first.'))
    return
  }
  try {
    await withBusy('w-thumb', 'Designing…', async () => {
      const brief = await generateThumbnailBrief(topic, '')
      $('w-out').innerHTML = `<div class="card"><h3>Thumbnail brief</h3><pre>${esc(brief)}</pre>
        <div class="row"><button class="mini" data-copy="${esc(brief)}">Copy</button></div></div>`
      save('thumbnail', `Thumbnail — ${topic}`, brief)
    })
  } catch (err) {
    setError('w-out', err)
  }
}

// ---------------------------------------------------------------- advisor

const convo: { role: 'user' | 'assistant'; content: string }[] = []

async function runAdvisor(): Promise<void> {
  const input = $<HTMLTextAreaElement>('a-in')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  convo.push({ role: 'user', content: text })

  const log = $('a-log')
  log.insertAdjacentHTML('beforeend', `<div class="card"><div class="muted">You</div><pre>${esc(text)}</pre></div>`)
  const bubble = document.createElement('div')
  bubble.className = 'card'
  bubble.innerHTML = '<div class="muted">Advisor</div><pre></pre>'
  log.appendChild(bubble)
  const pre = bubble.querySelector('pre') as HTMLPreElement

  const btn = $<HTMLButtonElement>('a-go')
  btn.disabled = true
  try {
    // The whole conversation is sent each turn so the advisor keeps context; the PC
    // supplies its own system instruction, which never travels to this app.
    const answer = await advisorStream(convo, (delta: string) => {
      pre.textContent = (pre.textContent ?? '') + delta
      window.scrollTo(0, document.body.scrollHeight)
    })
    convo.push({ role: 'assistant', content: answer })
    save('advice', text.slice(0, 60), answer)
  } catch (err) {
    pre.innerHTML = `<span class="err">${esc(message(err))}</span>`
  } finally {
    btn.disabled = false
  }
}

// ---------------------------------------------------------------- saved

function renderSaved(): void {
  const items = listSaved()
  const out = $('sv-out')
  if (!items.length) {
    out.innerHTML = '<div class="muted">Nothing saved yet. Anything you generate is kept here on this phone.</div>'
    return
  }
  out.innerHTML = items.map((i) => card(i)).join('')
}

function card(i: SavedItem): string {
  const when = new Date(i.createdAt).toLocaleString()
  return `<div class="card">
    <h3>${esc(i.title)}</h3>
    <div class="muted">${esc(i.kind)} · ${esc(when)}</div>
    <pre class="clamp">${esc(i.body)}</pre>
    <div class="row">
      <button class="mini" data-copy="${esc(i.body)}">Copy</button>
      <button class="mini" data-share="${esc(i.title)}" data-sharebody="${esc(i.body)}">Send to PC</button>
      <button class="mini danger" data-del="${esc(i.id)}">Delete</button>
    </div>
  </div>`
}

// ---------------------------------------------------------------- settings

function renderSettings(): void {
  const p = getProvider()
  ;($('st-provider') as HTMLSelectElement).value = p
  ;($('st-key') as HTMLInputElement).value = getKey()
  ;($('st-pclink') as HTMLInputElement).value = getPcLink()
  $('st-keyrow').classList.toggle('hidden', p === 'free')
}

function saveSettings(): void {
  const p = ($('st-provider') as HTMLSelectElement).value as PhoneProvider
  setProvider(p)
  setKey(val('st-key'))
  setPcLink(val('st-pclink'))
  $('st-out').innerHTML =
    p === 'free'
      ? '<div class="muted">Saved. Using the free AI — nothing to pay, nothing to type in.</div>'
      : '<div class="muted">Saved. Your key is stored only on this phone.</div>'
  renderSettings()
}

// ---------------------------------------------------------------- shared actions

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copied')
  } catch {
    toast('Could not copy — long-press the text instead')
  }
}

async function shareText(title: string, body: string): Promise<void> {
  // Web Share hands off to WhatsApp/email/Drive etc., which is how a script
  // actually gets from the phone to the PC. Falls back to copying.
  if (navigator.share) {
    try {
      await navigator.share({ title, text: body })
      return
    } catch {
      // User dismissed the share sheet — not an error worth showing.
      return
    }
  }
  await copyText(body)
}

let toastTimer: number | undefined
function toast(text: string): void {
  const el = $('toast')
  el.textContent = text
  el.classList.remove('hidden')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 1800)
}

// ---------------------------------------------------------------- wiring

/** Shows the outcome of a save/share/push, including anything the validator flagged. */
function showSendResult(elId: string, r: SendResult): void {
  const warn = r.warnings.length
    ? `<div class="muted" style="color:#ffcf7a;margin-top:6px">${r.warnings.map(esc).join('<br />')}</div>`
    : ''
  $(elId).innerHTML = r.message
    ? `<div class="${r.ok ? 'muted' : 'err'}">${esc(r.message)}</div>${warn}`
    : warn
}

function wireScenes(): void {
  $('sc-ai').addEventListener('click', () => void Scenes.planWithAi())
  $('sc-offline').addEventListener('click', () => Scenes.planOffline())
  $('sc-blank').addEventListener('click', () => Scenes.planBlank())
  $('sc-add').addEventListener('click', () => {
    const at = P.addBeat()
    Scenes.renderScenes()
    if (at >= 0) Scenes.openEditor(at)
  })
  $('ed-close').addEventListener('click', () => Scenes.closeEditor())

  $('sc-save').addEventListener('click', () => showSendResult('sc-send-out', saveToPhone()))
  $('sc-share').addEventListener('click', async () => showSendResult('sc-send-out', await shareProject()))
  $('sc-push').addEventListener('click', async () => {
    $('sc-send-out').innerHTML = '<div class="muted">Sending to your PC…</div>'
    showSendResult('sc-send-out', await pushToPc())
  })
  $('sc-clear').addEventListener('click', () => {
    if (!confirm('Start a new plan? This clears the scenes on this phone. Your PC is not affected.')) return
    P.clearProject()
    Scenes.clearPreviewCache()
    Scenes.renderScenes()
  })

  // Gallery pick and both camera-app routes all end in the same place: whatever came
  // back is attached to the scene that asked for it.
  for (const id of ['pick-media', 'shoot-media', 'shoot-selfie']) {
    $(id).addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement
      const file = input.files?.[0]
      input.value = '' // let the same file be picked again later
      if (file) void onMediaPicked(file)
    })
  }

  $('st-syncpack').addEventListener('click', async () => {
    const out = $('st-pack-out')
    out.innerHTML = '<div class="muted">Copying from your PC…</div>'
    const r = await syncPromptPack()
    out.innerHTML = `<div class="${r.ok ? 'muted' : 'err'}">${esc(r.message)}</div>`
    renderPackState()
  })
  $('st-forgetpack').addEventListener('click', async () => {
    if (!confirm('Remove your writing instructions from this phone? You can copy them again any time.')) return
    await forgetPromptPack()
    $('st-pack-out').innerHTML = '<div class="muted">Removed. Writing now needs your PC.</div>'
    renderPackState()
  })
  $('st-testpc').addEventListener('click', async () => {
    const out = $('st-pack-out')
    out.innerHTML = '<div class="muted">Checking…</div>'
    try {
      const r = await ping()
      out.innerHTML = `<div class="muted">Connected. Your PC has ${r.libraryItems} item${r.libraryItems === 1 ? '' : 's'} in its Library.</div>`
    } catch (err) {
      out.innerHTML = `<div class="err">${esc(message(err))}</div>`
    }
  })

  // Which version this handset is actually running — the phone's equivalent of the
  // desktop's gold sidebar badge, and the only way to tell a fresh app from a cached
  // old one, since they look identical.
  $('st-build').textContent = BUILD_TAG

  $('st-refresh').addEventListener('click', async () => {
    const out = $('st-refresh-out')
    out.innerHTML = '<div class="muted">Looking…</div>'
    if (!('serviceWorker' in navigator)) {
      out.innerHTML = '<div class="muted">This browser cannot store the app, so it is always the newest one.</div>'
      return
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
      // A newer version reloads the page by itself (see the registration below), so
      // reaching this line means there was nothing new.
      out.innerHTML = '<div class="muted">You already have the newest version.</div>'
    } catch {
      out.innerHTML = '<div class="err">Could not check — you may be offline.</div>'
    }
  })

  $('st-open').addEventListener('click', () => $<HTMLInputElement>('pick-plan').click())
  $('pick-plan').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const r = await openProjectFile(file)
    showSendResult('st-open-out', r)
    if (r.ok) {
      Scenes.clearPreviewCache()
      showTab('scenes')
    }
  })

  Scenes.wireVideoSettings()
  Scenes.setToast(toast)
}

function wire(): void {
  for (const t of TABS) {
    document.getElementById(`t-${t}`)?.addEventListener('click', () => showTab(t))
  }
  wireScenes()
  wirePrompter()
  $('i-go').addEventListener('click', runIdeas)
  $('w-go').addEventListener('click', runScript)
  $('w-thumb').addEventListener('click', runThumbnail)
  $('a-go').addEventListener('click', runAdvisor)
  $('st-save').addEventListener('click', saveSettings)
  $('st-provider').addEventListener('change', () =>
    $('st-keyrow').classList.toggle('hidden', ($('st-provider') as HTMLSelectElement).value === 'free')
  )

  // One delegated listener for every generated button, so freshly rendered
  // cards work without re-binding anything.
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    // Scene thumbnails aren't buttons — a tap draws that scene's picture.
    const thumb = target.closest<HTMLElement>('.thumb[data-preview]')
    if (thumb) {
      Scenes.loadPreview(Number(thumb.getAttribute('data-preview')))
      return
    }

    const el = target.closest('button')
    if (!el) return

    // Scene-card actions are prefixed so they can't collide with the Saved list,
    // which uses a bare data-del carrying an id rather than an index.
    const scAttr = ['edit', 'up', 'down', 'dup', 'del'].find((a) => el.hasAttribute(`data-sc-${a}`))
    if (scAttr) {
      const i = Number(el.getAttribute(`data-sc-${scAttr}`))
      if (scAttr === 'edit') Scenes.openEditor(i)
      else if (scAttr === 'up') {
        P.moveBeat(i, -1)
        Scenes.clearPreviewCache()
        Scenes.renderScenes()
      } else if (scAttr === 'down') {
        P.moveBeat(i, 1)
        Scenes.clearPreviewCache()
        Scenes.renderScenes()
      } else if (scAttr === 'dup') {
        P.duplicateBeat(i)
        Scenes.clearPreviewCache()
        Scenes.renderScenes()
      } else if (confirm(`Delete scene ${i + 1}? Your PC is not affected.`)) {
        P.removeBeat(i)
        Scenes.clearPreviewCache()
        Scenes.renderScenes()
      }
      return
    }
    const copy = el.getAttribute('data-copy')
    if (copy !== null) return void copyText(copy)
    const share = el.getAttribute('data-share')
    if (share !== null) return void shareText(share, el.getAttribute('data-sharebody') ?? '')
    const del = el.getAttribute('data-del')
    if (del !== null) {
      // Deletion is always confirmed, and only ever touches this phone's copy.
      if (confirm('Delete this from your phone? Your PC is not affected.')) {
        remove(del)
        renderSaved()
      }
      return
    }
    const use = el.getAttribute('data-use')
    if (use !== null) {
      ;($('w-topic') as HTMLTextAreaElement).value = use
      showTab('writer')
    }
  })

  renderSettings()
  showTab('ideas')
}

/** Remembered for this session only: the user chose the small app deliberately. */
let preferSmallThisTime = false

function handoverInputs(pcReachable: boolean): HandoverInputs {
  return {
    pcLink: getPcLink(),
    pcReachable,
    preferSmallThisTime,
    alreadyOnPc: isServedByPc(location.hostname)
  }
}

/**
 * Says which of the two apps you are looking at, and what to do about it.
 *
 * The old line — "writing needs your PC" — described a limitation and never hinted that
 * the FULL studio is available over the network. That is exactly how the user came to
 * compare six tabs against the desktop's eighteen and conclude the phone had not been
 * upgraded. Every state now names itself.
 */
function renderPackState(pcReachable = false): void {
  const sub = document.querySelector('header .sub')
  if (!sub) return
  const i = handoverInputs(pcReachable)
  if (i.alreadyOnPc || i.pcLink.trim()) {
    sub.textContent = statusLine(i)
    return
  }
  // Never connected: still say the full studio exists, alongside the offline state.
  sub.textContent = hasPromptPack()
    ? 'writes without your PC · connect your PC for the full studio'
    : statusLine(i)
}

/**
 * Hands over to the real studio when the PC is on.
 *
 * Deliberately at startup and deliberately quick: a two-second probe, and on any doubt
 * the small app loads as before. Being slow to open would be a worse bug than landing in
 * the smaller app, so the timeout is short and every failure falls through.
 */
async function maybeHandOver(): Promise<boolean> {
  const link = safeStudioUrl(getPcLink())
  if (!link || isServedByPc(location.hostname) || preferSmallThisTime) return false
  let reachable = false
  try {
    await ping()
    reachable = true
  } catch {
    reachable = false
  }
  if (decideHandover(handoverInputs(reachable)) !== 'full-studio') {
    renderPackState(reachable)
    return false
  }
  renderPackState(true)
  // replace(), not assign(): Back should return to wherever they came from, not bounce
  // them into this decision again.
  location.replace(link)
  return true
}

/**
 * A phone can kill the app at any moment — swiped away, a call comes in, the browser
 * reclaims memory. Write the plan out the instant the page is hidden rather than
 * trusting a debounce that may never fire.
 */
function wirePersistence(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void P.flushProject()
  })
  window.addEventListener('pagehide', () => void P.flushProject())
}

async function start(): Promise<void> {
  wire()
  wirePersistence()
  // The plan lives in IndexedDB (it can hold megabytes of photos and recordings), so
  // it arrives after the first paint. Re-render once it's here.
  // Before anything else is drawn: if the PC is on, this icon should open the REAL
  // studio, not this smaller app. Only if that is not possible do we carry on here.
  if (await maybeHandOver()) return
  await Promise.all([P.loadProject(), loadPromptPack()])
  renderPackState()
  void Scenes.loadStyleLabels().then(() => Scenes.renderVideoSettings())
  if (P.hasStoryboard()) Scenes.renderScenes()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start())
else void start()

/**
 * Offline shell caching, and — the part that matters more — making sure a NEW version
 * actually replaces the old one.
 *
 * The problem this solves: a phone app lives in the handset's cache. Publish a new
 * one and the browser can carry on running the old one indefinitely. The user sees
 * last week's app with no way to tell, which is exactly what happened once.
 *
 * Registration failing is not fatal — the app still runs online, it just won't open
 * without a connection.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Ask straight away rather than waiting for the browser's own schedule, and
        // again each time the app is brought back to the front.
        void reg.update()
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update()
        })
      })
      .catch(() => undefined)

    // One reload, and only one: a loop here would be far worse than a stale app.
    let reloaded = false
    const refresh = (): void => {
      if (reloaded) return
      reloaded = true
      location.reload()
    }
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === 'npz-updated') refresh()
    })
    navigator.serviceWorker.addEventListener('controllerchange', refresh)
  })
}
