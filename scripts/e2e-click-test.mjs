import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-click-'))
console.log('click-test data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('a[href="#/video"]', { timeout: 15000 })
    const anchor = win.locator('a[href="#/video"]').first()
    await anchor.click({ force: true }).catch(()=>{})
    await win.waitForTimeout(800)
    const res = {
      locationHash: await win.evaluate(() => window.location.hash),
      mainText: await win.locator('main').innerText().catch(()=>''),
      title: await win.evaluate(() => document.title)
    }
    const file = join(dataHome, 'click-test.json')
    writeFileSync(file, JSON.stringify(res, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify(res, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
