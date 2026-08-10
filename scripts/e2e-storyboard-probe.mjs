import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpegPath from 'ffmpeg-static'
import { existsSync, mkdtempSync } from 'fs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-probe-'))
console.log('Storyboard probe data home:', dataHome)

const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('main', { timeout: 15000 })

  // create a tiny test photo
  const photo = join(dataHome, 'e2e-photo-probe.png')
  const mk = spawnSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=salmon:s=640x360:d=1', '-frames:v', '1', photo], { stdio: 'ignore' })
  if (mk.status !== 0 || !existsSync(photo)) {
    console.error('Could not create test photo')
    process.exit(2)
  }

  // Seed storyboard via the drafts API
  await win.evaluate(async (photoPath) => {
    await window.api.drafts.set('storyboard-project-probe', {
      mode: 'guided',
      title: 'E2E storyboard probe',
      brief: 'Probe',
      language: 'English',
      resKey: '720p',
      fps: 25,
      totalSeconds: 6,
      style: 'cinematic',
      photoPath,
      beats: [
        { id: 'e2e-b1', durationSec: 4, visual: 'A single shot', narration: 'Probe', subject: { kind: 'photo' } }
      ]
    })
  }, photo)

  // Navigate to storyboard
  await win.evaluate(() => { window.location.hash = '#/storyboard' })
  await win.waitForTimeout(1200)
  const mainText = await win.locator('main').innerText()
  console.log('Storyboard main text length:', mainText.length)
  const ok = /Shots \(1\)/.test(mainText)
  if (!ok) {
    // dump drafts storage if available
    try {
      const drafts = await win.evaluate(async () => {
        return await window.api.drafts.list()
      })
      console.error('Drafts list snapshot:', JSON.stringify(drafts).slice(0, 4000))
    } catch (e) {
      console.error('Could not read drafts list', e)
    }
    console.error('Storyboard probe: FAILED — "Shots (1)" missing')
    process.exit(3)
  }

  console.log('Storyboard probe: OK — Shots (1) present')
  process.exit(0)
} catch (err) {
  console.error('Probe threw', err)
  process.exit(4)
} finally {
  try { await app.close() } catch (e) {}
}
