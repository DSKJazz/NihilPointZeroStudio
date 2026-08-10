import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-dump-'))
console.log(`E2E DUMP data home: ${dataHome}`)

const app = await electron.launch({
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: repo,
  env: { ...process.env, NPZ_E2E_USERDATA: dataHome }
})
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('main', { timeout: 15000 })
  await win.evaluate(() => (window.location.hash = '#/video'))
  await win.waitForTimeout(1200)
  const options = await win.evaluate(() => {
    const sel = document.querySelector('main select')
    const opts = sel ? Array.from(sel.querySelectorAll('option')).map((o) => o.textContent) : []
    return opts
  })
  console.log('SELECT OPTIONS:')
  console.log(options)
  const buttons = await win.evaluate(() => Array.from(document.querySelectorAll('main button')).map(b => (b.textContent||'').trim()).filter(Boolean))
  console.log('\nBUTTONS:')
  console.log(buttons.slice(0,200))
  const buildBtn = await win.evaluate(() => {
    const b = Array.from(document.querySelectorAll('main button')).find(x => /Build/i.test(x.textContent||''))
    return b ? (b.textContent||'').trim() : null
  })
  console.log('\nBUILD BTN:')
  console.log(buildBtn)
} catch (err) {
  console.error('dump failed', err)
} finally {
  await app.close().catch(()=>{})
}
