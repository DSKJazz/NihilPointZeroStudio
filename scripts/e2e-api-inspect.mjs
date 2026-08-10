import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-api-'))
console.log('api-inspect data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    const apiSummary = await win.evaluate(() => {
          const a = window.api
          if (!a) return { exists: false }
      const keys = Object.keys(a)
      const detail = {}
      for (const k of keys) {
        try {
              const v = a[k]
              detail[k] = { type: typeof v, hasLast: !!(v && v.last), hasGet: !!(v && v.get), hasSet: !!(v && v.set) }
            } catch (e) {
              detail[k] = { type: 'error' }
            }
          }
          return { exists: true, keys, detail }
        })
    const file = join(dataHome, 'api-summary.json')
    writeFileSync(file, JSON.stringify(apiSummary, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify(apiSummary, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
