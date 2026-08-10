/**
 * Click-through smoke test for the standalone phone app, in a real browser at a
 * real phone screen size:
 *
 *   npm run build:phone && node scripts/phone-smoke.mjs
 *
 * It serves `phone/dist` over http, stubs the AI endpoint so the test never
 * spends a request or depends on a third-party service being up, then drives the
 * actual UI: generate ideas, write a script, save it, delete it. Anything that
 * throws in the page fails the run.
 *
 * Same spirit as the desktop click-through gate — a build that cannot be clicked
 * through is not shippable.
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'phone', 'dist')

if (!existsSync(join(DIST, 'app.js'))) {
  console.error('phone/dist is missing — run `npm run build:phone` first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
}

/**
 * Doubles as the static host AND as a stand-in for the studio on the PC. The phone no
 * longer calls an AI service directly (that would mean shipping the prompt wording in
 * a public page), so the realistic path to test is the phone asking its PC.
 */
let pcCalls = 0
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]

  if (path.startsWith('/api/')) {
    pcCalls++
    const send = (obj) => {
      const body = JSON.stringify(obj)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
    }
    if (path === '/api/ideas') return send(JSON.parse(IDEAS))
    if (path === '/api/script') return send({ title: 'The Rupee Trap', body: SCRIPT_BODY })
    if (path === '/api/thumbnail') return send({ brief: 'MAIN SUBJECT: a falling rupee note' })
    if (path === '/api/styles') return send([{ id: 'noir', label: 'Cinematic — film noir', family: 'cinematic' }])
    if (path === '/api/scene-image') return send({ url: 'https://image.pollinations.ai/prompt/stub?width=512' })
    if (path === '/api/library') return send([])
    if (path === '/api/project') return send({ ok: true, scenes: 3, needMedia: 0, warnings: [] })
    res.writeHead(404).end('{}')
    return
  }

  const file = join(DIST, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const IDEAS = JSON.stringify([
  {
    title: 'Why the rupee keeps sliding',
    hook: 'Aaj hum baat karain ge rupee ki.',
    angle: 'Mechanism, not blame.',
    viewPotentialScore: 8,
    viewPotentialReason: 'Search intent is steady.',
    competitionLevel: 'medium',
    contentPillars: ['currency'],
    suggestedLength: 'long'
  }
])
// Long enough that the offline storyboard builder splits it into several beats,
// which is what the scene-list assertions below actually exercise.
const SCRIPT_BODY = `[PATTERN INTERRUPT]
Yeh number dekhein aur sochein. The rupee has lost more value in five years than in the previous twenty.
Most people blame one government. That is the comfortable answer and it is wrong.
The real mechanism is the current account deficit, and it works quietly in the background.
Every imported barrel of oil is paid for in dollars, not rupees. Demand for dollars rises every month.
When exports do not keep pace, the gap has to be financed by borrowing. That borrowing has a price.
The price shows up in your grocery bill about nine months later. This is the part nobody explains.`

const fails = []
const step = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : '  FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(name)
}

/** 1x1 PNG — stands in for a gallery photo and for every scene preview request. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // Lets getUserMedia resolve with a synthetic mic so the recording path is exercised
  // for real rather than being skipped.
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
})
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone-class portrait
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    permissions: ['microphone'],
    acceptDownloads: true
  })
  // The phone reaches its PC via a link the studio shows. Seed it before any script
  // runs so the very first request already knows where to go.
  await ctx.addInitScript((pcLink) => {
    localStorage.setItem('npz.pclink', pcLink)
  }, `${base}/?t=test-token`)
  const page = await ctx.newPage()

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))
  // Deletes are confirmed by design. Playwright dismisses dialogs unless told
  // otherwise, so accept them here — before any test step can trigger one.
  page.on('dialog', (d) => d.accept())

  // TRIPWIRE: with no prompt pack cached, the phone must never call an AI service
  // directly — doing so would mean it was carrying the studio's prompt wording.
  let directAiCalls = 0
  await page.route('https://text.pollinations.ai/**', async (route) => {
    directAiCalls++
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  console.log(`\nPhone app smoke test (${base})\n`)
  await page.goto(base, { waitUntil: 'networkidle' })
  step('page loads', await page.title() === 'NIHILPOINTZERO', await page.title())

  // --- Ideas -------------------------------------------------------------
  await page.fill('#i-focus', 'Pakistan rupee')
  await page.click('#i-go')
  await page.waitForSelector('#i-out .card', { timeout: 15_000 })
  step('ideas render', (await page.locator('#i-out .card h3').first().textContent())?.includes('rupee'))

  // --- Writer, reached via "Write this" on an idea ------------------------
  await page.click('#i-out button[data-use]')
  step('"Write this" jumps to the writer', await page.locator('#s-writer').isVisible())
  step('topic is carried over', (await page.inputValue('#w-topic')).length > 0)

  await page.selectOption('#w-len', 'short')
  await page.click('#w-go')
  await page.waitForSelector('#w-out .card', { timeout: 15_000 })
  step('script renders', (await page.locator('#w-out h3').textContent()) === 'The Rupee Trap')
  step('stage directions survive', (await page.locator('#w-out pre').textContent())?.includes('[PATTERN INTERRUPT]'))

  // --- Scenes: plan a whole video ----------------------------------------
  // Every preview image is stubbed so the run is deterministic and offline.
  let previewRequests = 0
  await page.route('https://image.pollinations.ai/**', async (route) => {
    previewRequests++
    await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
  })

  await page.click('#t-scenes')
  step('scenes tab opens on the start screen', await page.locator('#sc-start').isVisible())

  // The script written above should be offerable as the source.
  const sourceOptions = await page.locator('#sc-source option').count()
  step('the script just written is offered as a source', sourceOptions >= 2, `${sourceOptions} options`)
  await page.selectOption('#sc-source', { index: 1 })

  // Offline route: no AI, no network — the studio's own storyboardFromScript.
  await page.click('#sc-offline')
  await page.waitForSelector('#sc-list .scene', { timeout: 10_000 })
  const sceneCount = await page.locator('#sc-list .scene').count()
  step('scenes are built from the script with no AI', sceneCount >= 1, `${sceneCount} scenes`)
  step('summary shows a runtime', /\d+s/.test((await page.locator('#sc-summary').textContent()) || ''))

  // Preview picture on demand.
  await page.locator('.thumb[data-preview]').first().click()
  await page.waitForFunction(() => !document.querySelector('.thumb[data-preview="0"]'), null, { timeout: 10_000 })
  step('a scene preview picture loads', previewRequests >= 1, `${previewRequests} image requests`)

  // --- Beat editor --------------------------------------------------------
  await page.locator('button[data-sc-edit]').first().click()
  step('the scene editor opens', await page.locator('#editor').isVisible())

  await page.fill('#ed-visual', 'Karachi skyline at dawn, haze over the port')
  await page.fill('#ed-narration', 'Aaj hum baat karain ge rupee ki.')
  await page.fill('#ed-caption', 'RECORD LOW')
  await page.fill('#ed-duration', '12')
  await page.selectOption('#ed-motion', 'left')
  await page.selectOption('#ed-music', 'tense')
  await page.selectOption('#ed-sfx', 'riser')

  // Mark this scene as needing the user's own photo, then actually attach one.
  await page.selectOption('#ed-subject', 'photo')
  step('choosing "my photo" reveals the attach control', await page.locator('#ed-attach').isVisible())
  // Goes through the real path: the button opens the picker, which targets this scene.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#ed-attach')])
  await chooser.setFiles({ name: 'me.png', mimeType: 'image/png', buffer: TINY_PNG })
  await page.waitForSelector('#ed-detach', { timeout: 10_000 })
  step('a gallery photo attaches to the scene', await page.locator('#ed-detach').isVisible())

  // Record narration for this scene through the fake microphone.
  if (await page.locator('#ed-rec').count()) {
    await page.click('#ed-rec')
    await page.waitForTimeout(700)
    await page.click('#ed-rec')
    await page.waitForSelector('#ed-unrec', { timeout: 10_000 })
    step('narration records on the phone', await page.locator('#ed-unrec').isVisible())
  } else {
    step('narration records on the phone', false, 'record button never appeared')
  }

  await page.click('#ed-close')
  step('editor closes back to the list', !(await page.locator('#editor').isVisible()))

  const cardText = (await page.locator('#sc-list .scene').first().textContent()) || ''
  step('edits show on the scene card', cardText.includes('12s') && cardText.includes('tense'), cardText.slice(0, 80))
  step('the card shows the attachment and the recording', cardText.includes('photo attached') && cardText.includes('my voice'))

  // --- Add / reorder / delete --------------------------------------------
  const before = await page.locator('#sc-list .scene').count()
  await page.click('#sc-add')
  await page.click('#ed-close')
  step('adding a scene works', (await page.locator('#sc-list .scene').count()) === before + 1)

  await page.locator('button[data-sc-dup]').first().click()
  step('copying a scene works', (await page.locator('#sc-list .scene').count()) === before + 2)

  await page.locator('button[data-sc-del]').last().click()
  await page.waitForTimeout(200)
  step('deleting a scene works', (await page.locator('#sc-list .scene').count()) === before + 1)

  // --- Video settings -----------------------------------------------------
  await page.click('#t-video')
  await page.selectOption('#v-style', 'noir')
  await page.selectOption('#v-aspect', '9:16')
  await page.check('#v-captions')
  step('video settings save', ((await page.locator('#v-out').textContent()) || '').includes('Saved'))

  // --- Export the plan ----------------------------------------------------
  await page.click('#t-scenes')
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#sc-save')])
  const planPath = await download.path()
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  step('the plan file downloads', download.suggestedFilename().endsWith('.npzproject.json'), download.suggestedFilename())
  step('the plan carries a versioned storyboard', plan.formatVersion === 1 && Array.isArray(plan.storyboard?.beats))
  step('the plan carries the video settings', plan.build?.style === 'noir' && plan.build?.aspect === '9:16')
  step('the plan is 9:16 sized', plan.storyboard.width === 1080 && plan.storyboard.height === 1920)
  step('the plan carries the attachments', (plan.assets || []).length >= 2, `${(plan.assets || []).length} assets`)
  step(
    'a beat references its attachment',
    plan.storyboard.beats.some((b) => typeof b.subject?.src === 'string' && b.subject.src.startsWith('asset:'))
  )
  // Kept for inspection after a failure. Deliberately NOT written into phone/dist:
  // the publish step copies that folder verbatim, so anything left there ends up on
  // the public site — which is exactly how a test artifact got published once.
  writeFileSync(join(tmpdir(), 'npz-last-plan.json'), JSON.stringify(plan))

  // --- Persistence across a reload ---------------------------------------
  // Reloading is the closest thing to the user swiping the app away. It caught a real
  // bug once: discrete actions were debounced, so a burst of edits then a close wrote
  // nothing at all. Keep this check.
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('#t-scenes')
  await page.waitForSelector('#sc-list .scene', { timeout: 10_000 })
  const afterReload = await page.locator('#sc-list .scene').count()
  step('the plan survives closing and reopening the app', afterReload === before + 1, `${afterReload} vs ${before + 1}`)

  // --- Teleprompter -------------------------------------------------------
  await page.click('#t-prompter')
  step('prompter opens', await page.locator('#tp-stage').isVisible())
  const sources = await page.locator('#tp-source option').count()
  step('it offers the current plan and saved scripts', sources >= 2, `${sources} sources`)
  step('it shows a word count and a running time', /\d+ words/.test((await page.locator('#tp-words').textContent()) || ''))

  const before10 = await page.locator('#tp-clock').textContent()
  await page.click('#tp-fit-10')
  step('"finish in 10m" changes the timing', (await page.locator('#tp-clock').textContent()) !== before10)
  step('speed is shown in words per minute', /wpm/.test((await page.locator('#tp-wpm-label').textContent()) || ''))

  await page.click('#tp-play')
  await page.waitForTimeout(600)
  const scrolled = await page.locator('#tp-scroll').evaluate((el) => el.scrollTop)
  step('the script actually scrolls when started', scrolled > 0, `${Math.round(scrolled)}px`)
  await page.click('#tp-play')
  await page.waitForTimeout(200)
  const paused = await page.locator('#tp-scroll').evaluate((el) => el.scrollTop)
  await page.waitForTimeout(400)
  step('pause really stops it', Math.abs((await page.locator('#tp-scroll').evaluate((el) => el.scrollTop)) - paused) < 2)
  await page.click('#tp-restart')
  step('restart returns to the top', (await page.locator('#tp-scroll').evaluate((el) => el.scrollTop)) === 0)
  step(
    'stage directions are shown but dimmed, not counted as speech',
    (await page.locator('#tp-scroll').innerHTML()).includes('SCENE 1')
  )

  // --- Saved --------------------------------------------------------------
  await page.click('#t-saved')
  const savedCount = await page.locator('#sv-out .card').count()
  step('generations are saved on the phone', savedCount >= 2, `${savedCount} items`)

  await page.locator('#sv-out button[data-del]').first().click()
  await page.waitForTimeout(200)
  step('delete removes exactly one item', (await page.locator('#sv-out .card').count()) === savedCount - 1)

  // --- Settings -----------------------------------------------------------
  await page.click('#t-settings')
  step('free mode is the default', (await page.inputValue('#st-provider')) === 'free')
  step('key box is hidden in free mode', !(await page.locator('#st-keyrow').isVisible()))
  await page.selectOption('#st-provider', 'anthropic')
  step('key box appears for a keyed provider', await page.locator('#st-keyrow').isVisible())

  // --- Installability -----------------------------------------------------
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href')
    if (!href) return null
    return (await fetch(href)).json()
  })
  step('manifest is served', !!manifest)
  step('manifest is standalone (installs as an app)', manifest?.display === 'standalone')
  step('manifest has a maskable icon', manifest?.icons?.some((i) => i.purpose === 'maskable'))
  for (const icon of manifest?.icons ?? []) {
    const res = await page.request.get(new URL(icon.src, `${base}/`).toString())
    step(`icon ${icon.sizes} loads`, res.ok())
  }

  step('the phone asked its PC to do the writing', pcCalls >= 2, `${pcCalls} PC calls`)
  step('it never called an AI service directly (no prompts on board)', directAiCalls === 0, `${directAiCalls} direct calls`)
  step('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
} finally {
  await browser.close()
  server.close()
}

console.log(fails.length ? `\n${fails.length} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails.length ? 1 : 0)
