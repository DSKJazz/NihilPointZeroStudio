import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-writer-'))
console.log('writer capture data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('main')
    // Dismiss onboarding
    await win.evaluate(() => {
      const labels = ['Skip tour', 'Skip', 'Close', 'Dismiss']
      for (const t of labels) {
        const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText && x.innerText.includes(t))
        if (b) { b.click(); break }
      }
    })
    // Navigate to writer
    await win.evaluate(() => (window.location.hash = '#/writer'))
    await win.waitForTimeout(700)
    // Capture main innerHTML
    const mainHTML = await win.evaluate(() => document.querySelector('main')?.innerHTML || '')
    const file = join(dataHome, 'writer-main.html')
    writeFileSync(file, mainHTML)
    console.log('WROTE', file)
  } finally {
    await app.close()
  }
}
run().catch(e=>{ console.error(e); process.exit(1) })
