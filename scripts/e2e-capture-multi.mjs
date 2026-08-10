import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-debug-'))
console.log(`E2E DEBUG data home: ${dataHome}`)

const app = await electron.launch({
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: repo,
  env: { ...process.env, NPZ_E2E_USERDATA: dataHome }
})

try {
  const win = await app.firstWindow()
  const pageErrors = []
  const consoleMessages = []
  win.on('pageerror', (err) => pageErrors.push(err && err.stack ? err.stack : String(err)))
  win.on('console', (m) => consoleMessages.push(String(m.text())))

  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('main', { timeout: 15000 })

  const ROUTES = [
    '/',
    '/ideas',
    '/agent',
    '/scenes',
    '/writer',
    '/scriptpad',
    '/video',
    '/storyboard',
    '/presenter',
    '/recorder',
    '/timeline',
    '/charts',
    '/psx',
    '/nccpl',
    '/advisor',
    '/library',
    '/activity',
    '/settings'
  ]

  const results = {}
  const checkTab = async (route) => {
    console.log(`\n-- Navigating to ${route}`)
    await win.evaluate((r) => (window.location.hash = `#${r}`), route)
    await win.waitForTimeout(1200)
    const mainText = await win.locator('main').innerText().catch(() => '')
    console.log(`main length: ${mainText ? mainText.length : 0}`)
    return { mainText }
  }

  for (const r of ROUTES) {
    results[r] = await checkTab(r)
  }

  console.log('\n=== PAGE ERRORS ===')
  if (pageErrors.length === 0) console.log('No pageerrors captured')
  else pageErrors.forEach((e, i) => console.log(`[#${i}]`, e))

  console.log('\n=== CONSOLE MESSAGES (last 100) ===')
  if (consoleMessages.length === 0) console.log('No console messages captured')
  else consoleMessages.slice(-100).forEach((m, i) => console.log(`[#${i}]`, m))

  for (const r of ROUTES) {
    console.log(`\n=== ${r} SNIPPET ===`)
    console.log(results[r].mainText.slice(0, 2000))
  }
} catch (err) {
  console.error('debug script failed:', err)
} finally {
  await app.close().catch(() => {})
}
