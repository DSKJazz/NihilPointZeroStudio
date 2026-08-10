import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-nav2-'))
console.log('nav-detail data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('nav, [role="navigation"]', { timeout: 15000 })
    const items = await win.evaluate(() => {
      const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]')
      if (!nav) return []
      const nodes = Array.from(nav.querySelectorAll('a, button, [role="button"]'))
      return nodes.map(n => {
        const rect = n.getBoundingClientRect()
        return {
          tag: n.tagName,
          text: n.innerText.replace(/\s+/g,' ').trim().slice(0,200),
          href: n.getAttribute('href'),
          dataTest: n.getAttribute('data-testid'),
          ariaLabel: n.getAttribute('aria-label'),
          visible: !!(n.offsetParent !== null),
          x: rect.x, y: rect.y, w: rect.width, h: rect.height
        }
      })
    })
    const file = join(dataHome, 'nav-detail.json')
    writeFileSync(file, JSON.stringify({ items }, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify({ items }, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
