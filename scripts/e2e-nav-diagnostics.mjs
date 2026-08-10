import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-diag-'))
console.log(`Diagnostic E2E data home: ${dataHome}`)

const TARGET_TABS = [
  { route: '/video', name: 'Video Studio' },
  { route: '/storyboard', name: 'Storyboard Director' },
  { route: '/presenter', name: 'Presenter Studio' },
  { route: '/recorder', name: 'Recorder' },
  { route: '/timeline', name: 'Timeline Editor' },
  { route: '/charts', name: 'Charts' },
  { route: '/advisor', name: 'Advisor' },
  { route: '/library', name: 'Library' },
  { route: '/activity', name: 'Activity Log' },
  { route: '/settings', name: 'Settings' }
]

async function navigateTo(win, name, route) {
  const tries = [
    async () => {
      const nav = win.locator('nav')
      if ((await nav.count()) === 0) return false
      const btn = nav.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) { await btn.click().catch(()=>{}); return true }
      const a = nav.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) { await a.click().catch(()=>{}); return true }
      return false
    },
    async () => {
      const nav = win.locator('[role="navigation"]')
      if ((await nav.count()) === 0) return false
      const btn = nav.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) { await btn.click().catch(()=>{}); return true }
      const a = nav.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) { await a.click().catch(()=>{}); return true }
      return false
    },
    async () => {
      const btn = win.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) { await btn.click().catch(()=>{}); return true }
      const a = win.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) { await a.click().catch(()=>{}); return true }
      return false
    }
  ]
  for (const t of tries) {
    try {
      const ok = await t()
      if (ok) { await win.waitForTimeout(900); return }
    } catch (e) {}
  }
  await win.evaluate((r) => (window.location.hash = `#${r}`), route)
  await win.waitForTimeout(900)
}

async function run() {
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    const pageErrors = []
    const consoleMsgs = []
    win.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)))
    win.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`))
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('main', { timeout: 15000 })

    for (const tab of TARGET_TABS) {
      const out = { tab: tab.name, route: tab.route, timestamp: new Date().toISOString() }
      try {
        await navigateTo(win, tab.name, tab.route)
        // capture simple diagnostics
        out.locationHash = await win.evaluate(() => window.location.hash)
        out.title = await win.evaluate(() => document.title)
        out.mainText = (await win.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 2000)
        out.mainLength = out.mainText.length
        const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(()=>[])
        out.headings = headings
        out.interactiveCount = await win.locator('main button:enabled, main a, main [role="button"], main select, main input, main textarea').count()
        out.pageErrors = pageErrors.slice(-20)
        out.console = consoleMsgs.slice(-50)
      } catch (e) {
        out.error = String(e?.message ?? e)
      }
      const file = join(dataHome, `diag-${tab.name.replace(/[^a-z0-9]/gi,'_')}.json`)
      writeFileSync(file, JSON.stringify(out, null, 2))
      console.log(`WROTE ${file}`)
      console.log(JSON.stringify(out, null, 2))
    }
  } finally {
    await app.close()
  }
}

run().catch((e)=>{ console.error(e); process.exit(1) })
