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

  const checkTab = async (route) => {
    console.log(`\n-- Navigating to ${route}`)
    await win.evaluate((r) => (window.location.hash = `#${r}`), route)
    await win.waitForTimeout(1200)
    const mainText = await win.locator('main').innerText().catch(() => '')
    console.log(`main length: ${mainText ? mainText.length : 0}`)
    return { mainText }
  }

  // Check Scene Studio then Script Writer
  const scene = await checkTab('/scenes')
  const writer = await checkTab('/writer')

  console.log('\n=== PAGE ERRORS ===')
  if (pageErrors.length === 0) console.log('No pageerrors captured')
  else pageErrors.forEach((e, i) => console.log(`[#${i}]`, e))

  console.log('\n=== CONSOLE MESSAGES ===')
  if (consoleMessages.length === 0) console.log('No console messages captured')
  else consoleMessages.slice(-50).forEach((m, i) => console.log(`[#${i}]`, m))

  // Also dump the visible main snippet for context
  console.log('\n=== SCENE MAIN SNIPPET ===')
  console.log(scene.mainText.slice(0, 2000))
  console.log('\n=== WRITER MAIN SNIPPET ===')
  console.log(writer.mainText.slice(0, 2000))
} catch (err) {
  console.error('debug script failed:', err)
} finally {
  await app.close().catch(() => {})
}
