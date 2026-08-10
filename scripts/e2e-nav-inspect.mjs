import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-nav-'))
console.log('nav-inspect data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('nav, [role="navigation"]', { timeout: 15000 })
    const navExists = await win.evaluate(() => !!document.querySelector('nav') || !!document.querySelector('[role="navigation"]'))
    const navHtml = await win.evaluate(() => {
      const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]')
      if (!nav) return null
      return nav.innerHTML.slice(0, 10000)
    })
    const items = await win.evaluate(() => {
      const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]')
      if (!nav) return []
      const nodes = Array.from(nav.querySelectorAll('button, a, [role="button"]'))
      return nodes.map(n => ({ tag: n.tagName, text: n.innerText.replace(/\s+/g,' ').trim().slice(0,200), disabled: n.hasAttribute('disabled') }))
    })
    const file = join(dataHome, 'nav-inspect.json')
    writeFileSync(file, JSON.stringify({ navExists, items, navHtml }, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify({ navExists, items }, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
