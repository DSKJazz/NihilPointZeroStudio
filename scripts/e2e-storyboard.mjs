import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpegPath from 'ffmpeg-static'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataHome = mkdtempSync(join(tmpdir(), 'npz-storyboard-e2e-'))
const app = await electron.launch({
    args: [join(repo, 'out', 'main', 'index.js')],
    cwd: repo,
    env: { ...process.env, NPZ_E2E_USERDATA: dataHome }
})

try {
    const win = await app.firstWindow()
    win.on('pageerror', (error) => console.error(`renderer: ${error.message}`))
    win.on('console', (message) => console.log(message.text()))
    const offProgress = await win.evaluate(() => {
        window.api.video.onProgress((stage) => console.log(`progress: ${stage}`))
        return true
    })
    await win.waitForLoadState('domcontentloaded')
    await win.waitForSelector('main', { timeout: 15_000 })
    const skipTour = win.locator('button', { hasText: 'Skip tour' })
    if ((await skipTour.count()) > 0) await skipTour.first().click()

    const photo = join(dataHome, 'e2e-photo.png')
    const made = spawnSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=steelblue:s=640x360:d=1', '-frames:v', '1', photo], { stdio: 'ignore' })
    if (made.status !== 0 || !existsSync(photo)) throw new Error('could not create the test photo')

    await win.evaluate(async (photoPath) => {
        await window.api.drafts.set('storyboard-project', {
            mode: 'guided', title: 'E2E storyboard film', brief: 'One shot of me presenting the automated test.',
            language: 'English', resKey: '720p', fps: 25, totalSeconds: 6, style: 'cinematic', photoPath,
            beautifyStrength: 0, beats: [{
                id: 'e2e-beat-1', durationSec: 4, visual: 'The presenter stands in a modern studio',
                narration: 'Storyboard pipeline test.', subject: { kind: 'photo' }, transitionSec: 0, motion: 'still'
            }]
        })
    }, photo)
    await win.evaluate(() => { window.location.hash = '#/storyboard' })
    await win.waitForTimeout(900)
    if (!/Shots \(1\)/.test(await win.locator('main').innerText())) throw new Error('seeded storyboard did not restore')

    await win.locator('button', { hasText: 'Render film' }).click()
    await win.waitForFunction(() => {
        const main = document.querySelector('main')
        return main ? /Your film/.test(main.innerText) && !!main.querySelector('video') : false
    }, undefined, { timeout: 240_000 })
    console.log('Storyboard render passed')

    await win.locator('button', { hasText: 'Open in Timeline editor' }).click()
    await win.waitForTimeout(900)
    const render = win.locator('main button', { hasText: '🎬 Render' }).first()
    await render.waitFor({ timeout: 10_000 })
    if (await render.isDisabled()) throw new Error('Timeline Render is disabled after storyboard import')
    await render.click()
    await win.waitForFunction(() => {
        const main = document.querySelector('main')
        return main ? /Rendered result/.test(main.innerText) && !!main.querySelector('video') : false
    }, undefined, { timeout: 240_000 })
    console.log('Timeline render passed')
} finally {
    await app.close().catch(() => { })
    rmSync(dataHome, { recursive: true, force: true })
}
