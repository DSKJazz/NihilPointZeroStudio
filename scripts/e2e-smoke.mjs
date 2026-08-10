/**
 * THE SHIP GATE: launches the REAL built app (out/main/index.js under the local
 * Electron) and walks EVERY tab like a user would — plus one full offline video
 * build clicked through the actual UI. If any tab renders dead, crashes, or the
 * build button does nothing, this exits non-zero and the ship STOPS.
 *
 * Why this exists: 471 unit tests can pass while a button in the UI is dead —
 * that class of failure reached the user repeatedly (2026-07-31). Nothing ships
 * without this click-through passing again.
 *
 * Isolation: NPZ_E2E_USERDATA points the app at a throwaway data home (see
 * src/main/index.ts) so a test run can never read or write real user work, never
 * runs the auto-backup, and never phones the update check.
 *
 * Determinism: only offline paths are exercised for pass/fail (presets engine,
 * Windows TTS, local ffmpeg). Anything needing the internet is checked for
 * PRESENCE and RESPONSIVENESS, never for online success.
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpegPath from 'ffmpeg-static'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every sidebar route, with a string that must be visible for the tab to count as alive.
 * Keep these to STABLE headline copy; a missing string means the tab is blank/broken. */
const TABS = [
  { route: '/', name: 'Today', mustSee: 'Your studio at a glance' },
  { route: '/ideas', name: 'Ideas & Trends', mustSee: 'audience' },
  { route: '/agent', name: 'AI Command', mustSee: 'Batch' },
  { route: '/scenes', name: 'Scene Studio', mustSee: 'Scene Studio' },
  { route: '/writer', name: 'Script Writer', mustSee: 'script' },
  { route: '/scriptpad', name: 'Script Pad', mustSee: 'Script Pad' },
  { route: '/video', name: 'Video Studio', mustSee: 'Video look (engine)' },
  { route: '/storyboard', name: 'Storyboard Director', mustSee: 'Storyboard Director' },
  { route: '/presenter', name: 'Presenter Studio', mustSee: 'Presenter Studio' },
  { route: '/recorder', name: 'Recorder', mustSee: 'Recorder' },
  { route: '/timeline', name: 'Timeline Editor', mustSee: 'Timeline' },
  { route: '/charts', name: 'Charts', mustSee: 'Charts' },
  { route: '/psx', name: 'Live PSX Data', mustSee: 'PSX' },
  { route: '/nccpl', name: 'NCCPL Analysis', mustSee: 'NCCPL' },
  { route: '/advisor', name: 'Advisor', mustSee: 'Advisor' },
  { route: '/library', name: 'Library', mustSee: 'Library' },
  // Activity Log's one button is deliberately disabled while the (fresh, isolated)
  // log is empty — read-only there is correct, so only render-aliveness is checked.
  { route: '/activity', name: 'Activity Log', mustSee: 'recorded automatically', readOnlyWhenEmpty: true },
  { route: '/settings', name: 'Settings', mustSee: 'AI Video engines (optional)' }
]

const failures = []
const fail = (tab, why) => {
  failures.push(`${tab}: ${why}`)
  console.error(`  ✗ ${tab}: ${why}`)
}

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-'))
console.log(`E2E data home (isolated, throwaway): ${dataHome}`)

const app = await electron.launch({
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: repo,
  env: { ...process.env, NPZ_E2E_USERDATA: dataHome }
})

try {
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)))
  await win.waitForLoadState('domcontentloaded')
  // First paint of the React tree.
  await win.waitForSelector('main', { timeout: 15000 })

  // A fresh data home = first run = the onboarding tour overlay. It must exist
  // (that's a feature), be skippable, and get out of the way before the sweep.
  const skipTour = win.locator('button', { hasText: 'Skip tour' })
  if ((await skipTour.count()) > 0) {
    await skipTour.first().click()
    await win.waitForTimeout(300)
    if ((await skipTour.count()) > 0) fail('Onboarding tour', 'Skip did not dismiss the tour')
    else console.log('  ✓ Onboarding tour: shown on first run, Skip dismisses it')
  } else {
    fail('Onboarding tour', 'did not appear on a fresh first run')
  }

  // ---- 1) Every tab must render alive: headline present, no crash screen,
  //         real content, and at least one enabled button to press.
  for (const tab of TABS) {
    try {
      await win.evaluate((route) => {
        window.location.hash = `#${route}`
      }, tab.route)
      await win.waitForTimeout(700)

      if ((await win.locator('text=This tab hit a snag').count()) > 0) {
        fail(tab.name, 'crashed (ErrorBoundary is showing)')
        continue
      }
      const mainText = (await win.locator('main').innerText()).trim()
      if (mainText.length < 40) {
        fail(tab.name, `rendered nearly blank (${mainText.length} chars of text)`)
        continue
      }
      if (!mainText.toLowerCase().includes(tab.mustSee.toLowerCase())) {
        fail(tab.name, `expected to see "${tab.mustSee}" — not found`)
        continue
      }
      // "Alive" = something a user can act on. Some tabs (Today, Activity Log) use
      // clickable cards/links rather than <button>, so count every interactive kind.
      const interactive = await win
        .locator('main button:enabled, main a, main [role="button"], main select, main input, main textarea')
        .count()
      if (interactive < 1 && !tab.readOnlyWhenEmpty) {
        fail(tab.name, 'has nothing interactive at all (no buttons, links, cards or inputs)')
        continue
      }
      console.log(`  ✓ ${tab.name} (${interactive} interactive elements)`)
    } catch (err) {
      fail(tab.name, `check threw: ${err?.message ?? err}`)
    }
  }

  // ---- 2) The core promise, clicked like a user: paste a script in Video Studio,
  //         pick the offline engine, press Build, and get an actual finished video.
  console.log('  … building a real video through the UI (offline engine)')
  try {
    await win.evaluate(() => {
      window.location.hash = '#/video'
    })
    await win.waitForTimeout(700)

    await win.locator('main select').first().selectOption({ label: '✍️ Paste / write my own script' })
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E smoke test')
    await win
      .locator('textarea[placeholder*="spoken narration"]')
      .fill('This is the automated click-through test. It builds a tiny real video completely offline.')
    // Offline engine tile — everything else stays at defaults.
    await win.locator('button', { hasText: 'Style presets' }).first().click()

    const buildBtn = win.locator('button', { hasText: 'Build Video' }).first()
    if ((await buildBtn.count()) === 0) throw new Error('the Build Video button is missing')
    await buildBtn.click()

    // The build must COMPLETE: a new entry appears in "Your videos". Progress text
    // alone is not enough — the user's complaint is builds that never finish.
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /E2E smoke test/.test(main.innerText) && !!main.querySelector('video') : false
      },
      undefined, // playwright signature is (fn, ARG, options) — options third, or the timeout is silently ignored
      { timeout: 240_000 }
    )
    console.log('  ✓ Build Video: clicked → rendered → finished video visible in the list')
  } catch (err) {
    fail('Video Studio BUILD', `${err?.message ?? err}`)
  }

  // ---- 2b) Per-video tools on the video just built, clicked like a user:
  //      🎧 AI DJ (reads the video's own stored script → offline synth → ducked under
  //      the voice) and 🧹 Clean copy (rebuild with zero on-screen text). Both are
  //      fully offline and only exist because jobs now remember their recipe.
  try {
    const aiDjBtn = win.locator('button', { hasText: 'Let the AI DJ pick' }).first()
    if ((await aiDjBtn.count()) === 0) throw new Error('the AI DJ button is missing on a freshly built video')
    await aiDjBtn.click()
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /\(AI DJ: /.test(main.innerText) : false
      },
      undefined,
      { timeout: 120_000 }
    )
    console.log('  ✓ AI DJ: read the video, composed a mood track, laid it under the voice')
  } catch (err) {
    fail('AI DJ', `${err?.message ?? err}`)
  }
  try {
    const cleanBtn = win.locator('button', { hasText: 'Clean copy' }).first()
    if ((await cleanBtn.count()) === 0) throw new Error('the Clean copy button is missing on a freshly built video')
    await cleanBtn.click()
    // The list is newest-first, so .first() may be the AI DJ copy's button — any job
    // whose title ends in "(clean)" proves the recipe→rebuild→no-overlays path.
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /\(clean\)/.test(main.innerText) : false
      },
      undefined,
      { timeout: 240_000 }
    )
    console.log('  ✓ Clean copy: rebuilt the same video with no on-screen text')
  } catch (err) {
    fail('Clean copy', `${err?.message ?? err}`)
  }
  try {
    const decksBtn = win.locator('button', { hasText: 'Open audio in DJ decks' }).first()
    if ((await decksBtn.count()) === 0) throw new Error('the "Open audio in DJ decks" button is missing')
    await decksBtn.click()
    // Success = the Sound Studio view opens with the track DECODED onto Deck A
    // (its name shown plain — not "loading …", not "could not read …").
    await win.waitForFunction(
      () => {
        const t = document.querySelector('main')?.innerText ?? ''
        return /Dual decks/.test(t) && /E2E smoke test/.test(t) && !/could not read/.test(t) && !/loading /.test(t)
      },
      undefined,
      { timeout: 60_000 }
    )
    console.log('  ✓ DJ decks: video audio extracted, sent over IPC, decoded onto Deck A')
  } catch (err) {
    fail('DJ decks preload', `${err?.message ?? err}`)
  }

  // ---- 2c) Settings must always be able to answer "where is my work kept?" — the
  //      question nobody could answer when 1.15 GB of finished videos sat unseen in
  //      a folder the app had stopped using.
  try {
    await win.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await win.waitForTimeout(900)
    const text = await win.locator('main').innerText()
    if (!/Where your work is kept/.test(text)) throw new Error('the "Where your work is kept" card is missing from Settings')
    // It must show the REAL active folder — this run's isolated one, not a placeholder.
    if (!text.includes(dataHome.split('\\').pop())) {
      throw new Error('the card does not show the data folder actually in use')
    }
    console.log('  ✓ Settings: names the exact folder your work is kept in')
  } catch (err) {
    fail('Data-location card', `${err?.message ?? err}`)
  }

  // ---- 3) Edge cases a real user hits: the app must stay alive and SAY something
  //         every time — silence or a crash is the failure being hunted here.

  // 3a. Autosave: typed work must survive leaving the tab and coming back.
  try {
    await win.evaluate(() => {
      window.location.hash = '#/scriptpad'
    })
    await win.waitForTimeout(500)
    const pad = win.locator('main textarea').first()
    await pad.fill('E2E autosave probe — do not lose me')
    await win.waitForTimeout(1200) // let the debounced save fire
    await win.evaluate(() => {
      window.location.hash = '#/'
    })
    await win.waitForTimeout(400)
    await win.evaluate(() => {
      window.location.hash = '#/scriptpad'
    })
    await win.waitForTimeout(800)
    const back = await win.locator('main textarea').first().inputValue()
    if (!back.includes('do not lose me')) {
      fail('Autosave', `typed text did not survive a tab switch (got: "${back.slice(0, 60)}")`)
    } else {
      console.log('  ✓ Autosave: typed work survives leaving and re-entering the tab')
    }
  } catch (err) {
    fail('Autosave', `${err?.message ?? err}`)
  }

  // 3b. Empty input: Build must NEVER be a silently-dead button (a real user hit
  //     the ⊘ cursor and concluded the app was broken). It stays CLICKABLE; with no
  //     script it must (a) show a standing hint, (b) on click, explain and point at
  //     the script box, and (c) NOT start a build.
  try {
    await win.evaluate(() => {
      window.location.hash = '#/video'
    })
    await win.waitForTimeout(700)
    await win.locator('main select').first().selectOption({ label: '✍️ Paste / write my own script' })
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('')
    await win.locator('textarea[placeholder*="spoken narration"]').fill('')
    await win.waitForTimeout(300)
    const buildBtn = win.locator('button', { hasText: 'Build Video' }).first()
    if (await buildBtn.isDisabled()) {
      fail('Empty-input guidance', 'Build is silently DISABLED with an empty script — it must stay clickable and explain what is missing')
    } else if ((await win.locator('text=Build needs script words first').count()) === 0) {
      fail('Empty-input guidance', 'the standing "Build needs script words first" hint is missing when the script box is empty')
    } else {
      await buildBtn.click()
      await win.waitForTimeout(1200)
      const started =
        (await win.locator('button', { hasText: 'Building video…' }).count()) > 0 ||
        (await win.locator('button', { hasText: '⏹ Stop' }).count()) > 0
      const explained = (await win.locator('text=script box is empty').count()) > 0
      if (started) fail('Empty-input guidance', 'clicking Build with an empty script actually STARTED a build')
      else if (!explained) fail('Empty-input guidance', 'clicking Build with an empty script produced no explanation')
      else console.log('  ✓ Empty-input guidance: Build stays clickable, explains itself, and refuses to start')
    }
  } catch (err) {
    fail('Empty-input guidance', `${err?.message ?? err}`)
  }

  // 3c. Bilingual + emoji build TO COMPLETION: Roman Urdu, Urdu script and emoji
  //     through narration, layout and encoding — the whole offline pipeline.
  try {
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E اردو test 🎬')
    await win
      .locator('textarea[placeholder*="spoken narration"]')
      .fill('Rupay ki girawat aur mehngai. معیشت کا تجزیہ اور منافع کی کہانی۔ Emoji check 🚀📈 done.')
    await win.locator('button', { hasText: 'Style presets' }).first().click()
    await win.locator('button', { hasText: 'Build Video' }).first().click()
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /E2E اردو test/.test(main.innerText) && !!main.querySelector('video') : false
      },
      undefined, // playwright signature is (fn, ARG, options) — options third, or the timeout is silently ignored
      { timeout: 240_000 }
    )
    console.log('  ✓ Urdu + emoji build: finished video visible in the list')
  } catch (err) {
    fail('Urdu/emoji build', `${err?.message ?? err}`)
  }

  // 3d. Huge script + rapid double-click + Stop mid-build: the panic-clicking user.
  //     Must start, must not double-build into chaos, must stop when told, must recover.
  try {
    const huge = 'Market analysis paragraph with numbers and risk words. '.repeat(280) // ~15k chars
    await win.locator('input[placeholder="Video title shown on the opening card"]').fill('E2E huge cancel test')
    await win.locator('textarea[placeholder*="spoken narration"]').fill(huge)
    const buildBtn = win.locator('button', { hasText: 'Build Video' }).first()
    await buildBtn.click()
    await buildBtn.click({ force: true }).catch(() => {}) // rapid second click must be harmless
    await win.waitForTimeout(4000) // let the build visibly start
    const stop = win.locator('button', { hasText: 'Stop' }).first()
    if ((await stop.count()) === 0) throw new Error('no Stop button appeared during a running build')
    await stop.click()
    // Recovery = the Build button is usable again reasonably soon after Stop.
    await win.waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('main button')]
        const b = btns.find((x) => /Build Video/.test(x.textContent ?? ''))
        return !!b && !b.disabled
      },
      undefined,
      { timeout: 30_000 }
    )
    if ((await win.locator('text=This tab hit a snag').count()) > 0) throw new Error('tab crashed after Stop')
    console.log('  ✓ Huge script + double-click + Stop: build started, stopped instantly, UI recovered')
  } catch (err) {
    fail('Huge/cancel build', `${err?.message ?? err}`)
  }

  // ---- 4) The STORYBOARD → TIMELINE pipelines, clicked like a user. A guided
  //         one-shot film with the user's own photo: narration, shot render and the
  //         final compile are all offline (the optional scene-image fetch may fail
  //         without internet and must fall back — that fallback is part of the test).
  //         The result is then opened in the Timeline editor and re-rendered there,
  //         so BOTH render pipelines are proven end-to-end on every ship.
  try {
    // A real local "photo" made offline with the bundled ffmpeg — no network, ever.
    const photo = join(dataHome, 'e2e-photo.png')
    const mk = spawnSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=steelblue:s=640x360:d=1', '-frames:v', '1', photo], { stdio: 'ignore' })
    if (mk.status !== 0 || !existsSync(photo)) throw new Error('could not create the test photo with ffmpeg')

    // Seed the storyboard exactly the way the app itself persists one (autosave draft),
    // then mount the tab — it restores the draft like any returning user session.
    await win.evaluate(async (photoPath) => {
      await window.api.drafts.set('storyboard-project', {
        mode: 'guided',
        title: 'E2E storyboard film',
        brief: 'One shot of me presenting the automated test.',
        language: 'English',
        resKey: '720p',
        fps: 25,
        totalSeconds: 6,
        style: 'cinematic',
        photoPath,
        beautifyStrength: 0,
        beats: [
          {
            id: 'e2e-beat-1',
            durationSec: 4,
            visual: 'The presenter stands in a modern studio',
            narration: 'Storyboard pipeline test.',
            subject: { kind: 'photo' },
            transitionSec: 0,
            motion: 'still'
          }
        ]
      })
    }, photo)
    await win.evaluate(() => {
      window.location.hash = '#/'
    })
    await win.waitForTimeout(300)
    await win.evaluate(() => {
      window.location.hash = '#/storyboard'
    })
    await win.waitForTimeout(900)
    const shotsHeader = await win.locator('main').innerText()
    if (!/Shots \(1\)/.test(shotsHeader)) throw new Error('seeded storyboard did not restore (no "Shots (1)")')

    // The guided editing surface must work: add a shot, then delete it through the
    // real confirm dialog (which must appear — silent deletion would be a bug too).
    await win.locator('button', { hasText: '+ Add shot' }).click()
    await win.waitForTimeout(300)
    if (!/Shots \(2\)/.test(await win.locator('main').innerText())) throw new Error('+ Add shot did not add a shot')
    await win.locator('main button', { hasText: '✕' }).last().click()
    const confirmBtn = win.locator('[role="dialog"] button', { hasText: 'Delete' })
    await confirmBtn.waitFor({ timeout: 5000 })
    await confirmBtn.click()
    await win.waitForTimeout(300)
    if (!/Shots \(1\)/.test(await win.locator('main').innerText())) throw new Error('deleting the added shot did not work')

    // Render the film. Success = the "Your film" section with a real <video>.
    await win.locator('button', { hasText: 'Render film' }).click()
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /Your film/.test(main.innerText) && !!main.querySelector('video') : false
      },
      undefined, // playwright signature is (fn, ARG, options) — options third, or the timeout is silently ignored
      { timeout: 240_000 }
    )
    console.log('  ✓ Storyboard: guided one-shot film rendered end-to-end through the UI')

    // Hand the film to the Timeline editor and render THERE too.
    const openTimeline = win.locator('button', { hasText: 'Open in Timeline editor' })
    if ((await openTimeline.count()) === 0) throw new Error('rendered film offered no "Open in Timeline editor" button')
    await openTimeline.click()
    await win.waitForTimeout(900)
    const renderBtn = win.locator('main button', { hasText: '🎬 Render' }).first()
    await renderBtn.waitFor({ timeout: 10_000 })
    if (await renderBtn.isDisabled()) throw new Error('Timeline Render is disabled after importing the storyboard film')
    await renderBtn.click()
    await win.waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main ? /Rendered result/.test(main.innerText) && !!main.querySelector('video') : false
      },
      undefined, // playwright signature is (fn, ARG, options) — options third, or the timeout is silently ignored
      { timeout: 240_000 }
    )
    console.log('  ✓ Timeline: imported storyboard film re-rendered through the editor')
  } catch (err) {
    fail('Storyboard/Timeline pipelines', `${err?.message ?? err}`)
  }

  if (pageErrors.length) {
    for (const e of pageErrors) fail('Renderer exception', e.slice(0, 200))
  }
} finally {
  await app.close().catch(() => {})
  rmSync(dataHome, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\nE2E FAILED — ${failures.length} problem(s). THIS BUILD MUST NOT SHIP.`)
  process.exit(1)
}
console.log('\nE2E OK — every tab is alive and a real video built end-to-end through the UI.')
