import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-evt-'))
console.log('click-events data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.evaluate(() => {
      window._npz_events = []
      window.addEventListener('hashchange', (e) => window._npz_events.push({type:'hashchange', url: location.href, time: Date.now()}))
      window.addEventListener('popstate', (e) => window._npz_events.push({type:'popstate', state: e.state, time: Date.now()}))
      window.addEventListener('click', (e) => window._npz_events.push({type:'click', target: e.target?.outerHTML?.slice(0,200), time: Date.now()}), true)
    })
    await win.waitForSelector('a[href="#/video"]', { timeout: 15000 })
    await win.locator('a[href="#/video"]').first().click({ force: true }).catch(()=>{})
    await win.waitForTimeout(500)
    const events = await win.evaluate(() => window._npz_events.slice(-20))
    const res = { events, locationHash: window.location.hash, title: document.title, mainText: document.querySelector('main')?.innerText?.slice(0,1000) }
    const file = join(dataHome, 'click-events.json')
    writeFileSync(file, JSON.stringify(res, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify(res, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
