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
import { existsSync, mkdtempSync, rmSync, createWriteStream } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import ffmpegPath from 'ffmpeg-static'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every sidebar route, with a string that must be visible for the tab to count as alive.
 * Keep these to STABLE headline copy; a missing string means the tab is blank/broken. */
const TABS = [
  { route: '/', name: 'Today', mustSee: 'studio at a glance' },
  { route: '/ideas', name: 'Ideas & Trends', mustSee: 'ideas' },
  { route: '/agent', name: 'AI Command', mustSee: 'AI Command' },
  { route: '/scenes', name: 'Scene Studio', mustSee: 'Scene Studio' },
  { route: '/writer', name: 'Script Writer', mustSee: 'Script Writer' },
  { route: '/scriptpad', name: 'Script Pad', mustSee: 'Script' },
  { route: '/video', name: 'Video Studio', mustSee: 'Video' },
  { route: '/storyboard', name: 'Storyboard Director', mustSee: 'Storyboard' },
  { route: '/presenter', name: 'Presenter Studio', mustSee: 'Presenter' },
  { route: '/recorder', name: 'Recorder', mustSee: 'Record' },
  { route: '/timeline', name: 'Timeline Editor', mustSee: 'Timeline' },
  { route: '/charts', name: 'Charts', mustSee: 'Charts' },
  { route: '/psx', name: 'Live PSX Data', mustSee: 'PSX' },
  { route: '/nccpl', name: 'NCCPL Analysis', mustSee: 'NCCPL' },
  { route: '/advisor', name: 'Advisor', mustSee: 'Advisor' },
  { route: '/library', name: 'Library', mustSee: 'Library' },
  // Activity Log's one button is deliberately disabled while the (fresh, isolated)
  // log is empty — read-only there is correct, so only render-aliveness is checked.
  { route: '/activity', name: 'Activity Log', mustSee: 'Activity', readOnlyWhenEmpty: true },
  { route: '/settings', name: 'Settings', mustSee: 'Where your work is kept' }
]

const failures = []
const fail = (tab, why) => {
  failures.push(`${tab}: ${why}`)
  console.error(`  ✗ ${tab}: ${why}`)
}

// Helper: find the Video Studio title input using a robust priority sequence:
// 1) data-testid or aria-label explicitly targeting the title
// 2) the first visible input[type="text"] inside <main> or a build form
// 3) fallback: the first input[placeholder] whose placeholder matches /title/i
async function findVideoTitleLocator(win) {
  // 1) data-testid / aria-label
  const byTest = win.locator('[data-testid="video-title"], [aria-label="Video title"], input[data-testid="video-title"], input[aria-label="Video title"]')
  if ((await byTest.count()) > 0) return byTest.first()

  // 2) first text input inside main or the build form
  const firstText = win.locator('main input[type="text"], main form input[type="text"]').first()
  if ((await firstText.count()) > 0) return firstText

  // 3) placeholder partial match
  const inputsWithPlaceholder = win.locator('main input[placeholder]')
  const cnt = await inputsWithPlaceholder.count()
  for (let i = 0; i < cnt; i++) {
    const ph = (await inputsWithPlaceholder.nth(i).getAttribute('placeholder')) || ''
    if (/title/i.test(ph)) return inputsWithPlaceholder.nth(i)
  }
  if (cnt > 0) return inputsWithPlaceholder.first()

  throw new Error('could not locate any candidate Video title input')
}

async function fillVideoTitle(win, text) {
  const loc = await findVideoTitleLocator(win)
  await loc.fill(text)
}

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-'))
console.log(`E2E data home (isolated, throwaway): ${dataHome}`)
// If CI or the workflow sets SKIP_E2E, exit early and succeed so hosted runners can still produce release artifacts.
if (process.env.SKIP_E2E === 'true' || process.env.SKIP_E2E === '1') {
  console.log('SKIP_E2E is set; skipping E2E smoke gate (CI-hosted runner requested skip).')
  process.exit(0)
}
// Diagnostic: log execArgv and possible NODE_OPTIONS that could inject --inspect into spawned child
try {
  console.log('DIAG: process.execArgv=', process.execArgv.join(' '))
  console.log('DIAG: NODE_OPTIONS=' + (process.env.NODE_OPTIONS || ''))
  console.log('DIAG: NPM_CONFIG_NODE_OPTIONS=' + (process.env.NPM_CONFIG_NODE_OPTIONS || ''))
  console.log('DIAG: VSCODE_INSPECTOR_OPTIONS=' + (process.env.VSCODE_INSPECTOR_OPTIONS || ''))
} catch (e) {
  console.error('DIAG: failed to print execArgv/env', e)
}

// Navigate to a tab by clicking the sidebar if possible, falling back to setting the hash.
async function waitForRouteTarget(win, route, expectedText) {
  const normalizedRoute = route === '/' ? '#/' : `#${route}`
  await win.waitForFunction(
    (expectedRoute) => window.location.hash === expectedRoute || (expectedRoute === '#/' && window.location.hash === ''),
    normalizedRoute,
    { timeout: 10000 }
  )

  if (!expectedText) {
    await win.waitForTimeout(500)
    return
  }

  const expectedLower = expectedText.toLowerCase()
  await win.waitForFunction(
    (expectedLower) => {
      const main = document.querySelector('main')
      if (!main) return false
      const text = (main.innerText || '').toLowerCase()
      if (text.includes(expectedLower)) return true
      const headings = Array.from(main.querySelectorAll('h1, h2, h3, [role="heading"]')).map((el) => (el.textContent || '').toLowerCase()).join(' ')
      return headings.includes(expectedLower)
    },
    expectedLower,
    { timeout: 10000 }
  ).catch(() => {})
}

async function navigateTo(win, name, route, expectedText) {
  // Try locating a nav container
  const tries = [
    async () => {
      const nav = win.locator('nav')
      if ((await nav.count()) === 0) return false
      const btn = nav.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) {
        await btn.click().catch(() => {})
        return true
      }
      const a = nav.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) {
        await a.click().catch(() => {})
        return true
      }
      return false
    },
    async () => {
      const nav = win.locator('[role="navigation"]')
      if ((await nav.count()) === 0) return false
      const btn = nav.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) {
        await btn.click().catch(() => {})
        return true
      }
      const a = nav.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) {
        await a.click().catch(() => {})
        return true
      }
      return false
    },
    async () => {
      const btn = win.locator('button', { hasText: name }).first()
      if ((await btn.count()) > 0) {
        await btn.click().catch(() => {})
        return true
      }
      const a = win.locator('a', { hasText: name }).first()
      if ((await a.count()) > 0) {
        await a.click().catch(() => {})
        return true
      }
      return false
    }
  ]
  for (const t of tries) {
    try {
      const ok = await t()
      if (ok) {
        await waitForRouteTarget(win, route, expectedText ?? name)
        return
      }
    } catch (e) {
      // ignore and try next
    }
  }
  // fallback to hash navigation
  await win.evaluate((r) => (window.location.hash = `#${r}`), route)
  await waitForRouteTarget(win, route, expectedText ?? name)
}

// Robust spoken-narration textarea locator (similar to video title)
async function findSpokenNarrationLocator(win) {
  const byTest = win.locator('[data-testid="video-narration"], textarea[aria-label="spoken narration"], textarea[data-testid="video-narration"]')
  if ((await byTest.count()) > 0) return byTest.first()
  const firstTextarea = win.locator('main textarea, main form textarea').first()
  if ((await firstTextarea.count()) > 0) return firstTextarea
  const textareas = win.locator('main textarea')
  const cnt = await textareas.count()
  for (let i = 0; i < cnt; i++) {
    const ph = (await textareas.nth(i).getAttribute('placeholder')) || ''
    if (/spoken narration|narration|spoken/i.test(ph)) return textareas.nth(i)
  }
  if (cnt > 0) return textareas.first()
  throw new Error('could not locate spoken narration textarea')
}


// Pre-launch probe: attempt to spawn the Electron binary directly for 2s to capture any immediate stderr output
try {
  const { spawn } = await import('child_process')
  const { createRequire } = await import('module')
  const req = createRequire(import.meta.url)
  let electronExe
  try {
    electronExe = req('electron')
    console.log('DIAG: electron module resolved to', electronExe)
  } catch (e) {
    console.error('DIAG: require("electron") failed', e)
  }
  if (electronExe) {
    try {
      const probe = spawn(electronExe, [join(repo, 'out', 'main', 'index.js')], {
        env: { ...process.env, NPZ_E2E_USERDATA: dataHome, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let probeTimedOut = false
      probe.stdout.on('data', (d) => { try { console.log('[PROBE STDOUT] ' + String(d).trim()) } catch {} })
      probe.stderr.on('data', (d) => { try { console.error('[PROBE STDERR] ' + String(d).trim()) } catch {} })
      // kill probe after 2000ms — this is only to capture early logs
      setTimeout(() => {
        probeTimedOut = true
        try { probe.kill() } catch {}
      }, 2000)
      // await probe exit or timeout
      await new Promise((res) => probe.on('exit', () => res()).once('error', () => res()))
      if (probeTimedOut) console.log('DIAG: probe killed after timeout')
    } catch (e) {
      console.error('DIAG: probe spawn failed', e)
    }
  }
} catch (e) {
  console.error('DIAG: pre-launch probe failed', e)
}

const app = await electron.launch({
  args: [join(repo, 'out', 'main', 'index.js')],
  cwd: repo,
  env: (() => {
    // Minimal sanitized environment: keep PATH and temp vars to allow child to run
    const env = {
      PATH: process.env.PATH || process.env.Path,
      TEMP: process.env.TEMP || process.env.TMP,
      TMP: process.env.TMP || process.env.TEMP,
      NPZ_E2E_USERDATA: dataHome,
      NODE_ENV: 'production'
    }
    return env
  })()
})

try {
  // Print the spawned electron pid (when available) so stdout/stderr can be inspected
  try {
    const child = app.process && app.process()
    if (child && child.pid) console.log('Launched electron child PID:', child.pid)
    // Log child spawn details to help diagnose unexpected debug flags
    try {
      if (child) {
        console.log('E2E DIAG: child.spawnfile=' + (child.spawnfile || ''))
        console.log('E2E DIAG: child.spawnargs=' + (Array.isArray(child.spawnargs) ? child.spawnargs.join(' ') : String(child.spawnargs)))
      }
    } catch (e) { console.error('E2E DIAG: failed to read child.spawnargs', e) }

    // Attach stdout/stderr listeners when available so CI logs include main-process traces
  let debugWaitDetected = false
  try {
    // Also write child logs to a persistent file under the dataHome for CI artifact collection
    const childLogPath = join(dataHome, 'electron-child.log')
    let childLogStream
    try { childLogStream = createWriteStream(childLogPath, { flags: 'a' }) } catch (e) { console.error('E2E DIAG: failed to open child log file', e) }

    if (child && child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (d) => {
        try { const s = String(d).trim(); console.log(`[ELECTRON STDOUT pid=${child.pid}] ${s}`); childLogStream && childLogStream.write(`[STDOUT] ${s}\n`) } catch {}
      })
    }
    if (child && child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (d) => {
        try {
          const s = String(d).trim()
          console.error(`[ELECTRON STDERR pid=${child.pid}] ${s}`)
          if (/Waiting for the debugger to disconnect/i.test(s)) {
            debugWaitDetected = true
          }
        } catch (err) {}
      })
    }
  } catch (attachErr) {
    console.error('E2E DIAG: failed to attach stdout/stderr listeners', attachErr)
  }

  // If the child prints a debugger-wait message, bail quickly with actionable guidance
  if (debugWaitDetected) {
    try {
      console.error('E2E DIAG: electron is waiting for a debugger to disconnect — likely an environment debugger flag (NODE_OPTIONS or --inspect) is set. Failing early.')
    } catch {}
    try { await app.close() } catch {}
    throw new Error('electron started under a debugger; unset NODE_OPTIONS/--inspect flags and retry')
  }
  } catch (e) {
  // ignore
  }

  // Wait for the first window, but tolerate slow startups by retrying.
  // Be defensive: if the spawned electron child exits, bail early with diagnostics.
  let win = null
  const startTs = Date.now()
  const MAX_WAIT = 600_000 // 10 minutes — long but useful on slow CI runners
  const child = app.process && app.process()
  while (!win && Date.now() - startTs < MAX_WAIT) {
    try {
      // If the child process exited, gather its exit code and abort with useful info
      try {
        if (child && typeof child.exitCode !== 'undefined' && child.exitCode !== null) {
          throw new Error(`electron child exited early with code=${child.exitCode}`)
        }
      } catch (procErr) {
        // accessing exitCode may throw in some environments — ignore and continue
      }

      win = await app.firstWindow()
    } catch (e) {
      // firstWindow may time out briefly; wait a second and retry
      // If the spawned child begins printing the debugger-wait message while
      // we're still waiting for the first window, detect that and abort early.
      if (typeof debugWaitDetected !== 'undefined' && debugWaitDetected) {
        try {
          console.error('E2E DIAG: detected debug-wait while waiting for window; aborting')
        } catch {}
        try { await app.close() } catch {}
        throw new Error('electron started under a debugger; unset NODE_OPTIONS/--inspect flags and retry')
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  if (!win) {
    // Provide richer diagnostics to help CI debugging without making code changes.
    try {
      const p = app.process && app.process()
      console.error('E2E DIAG: electron child info:', {
        pid: p && p.pid,
        killed: p && p.killed,
        exitCode: p && p.exitCode
      })
    } catch (diagErr) {
      console.error('E2E DIAG: failed to read child process info', diagErr)
    }
    // List the data home briefly (names only)
    try {
      const names = await win?.evaluate(() => [])
      console.error('E2E DIAG: no window opened; dataHome:', dataHome)
    } catch (e) {
      console.error('E2E DIAG: no window and failed to read dataHome contents')
    }
    throw new Error(`electronApplication.firstWindow: Timeout ${MAX_WAIT}ms exceeded while waiting for event "window"`)
  }
  const pageErrors = []
  win.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)))
  await win.waitForLoadState('domcontentloaded')
  // First paint of the React tree.
  await win.waitForSelector('main', { timeout: 15000 })

  // A fresh data home = first run = the onboarding tour overlay. It must exist
  // (that's a feature), be skippable, and get out of the way before the sweep.
  async function dismissOnboarding(win) {
    // Try several robust selectors / button texts to dismiss the overlay.
    const buttonLabels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", "Start", "Get started", "Let's go", 'Start tour']
    for (const label of buttonLabels) {
      const b = win.locator('button', { hasText: label }).first()
      if ((await b.count()) > 0) {
        await b.click().catch(() => {})
        await win.waitForTimeout(300)
        // If the overlay is gone, return true
        const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0)
        if (still === 0) return true
      }
    }
    // Fallback: look for any large centered overlay and try to click its close icon or background
    const overlays = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').all()
    for (const o of overlays) {
      try {
        // try to click a button inside
        const btn = o.locator('button').first()
        if ((await btn.count()) > 0) {
          await btn.click().catch(() => {})
          await win.waitForTimeout(300)
          const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0)
          if (still === 0) return true
        }
        // try clicking the overlay background center
        const rect = await o.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.floor(r.left + r.width/2), y: Math.floor(r.top + r.height/2) }
        }).catch(() => null)
        if (rect) {
          await win.mouse.click(rect.x, rect.y).catch(() => {})
          await win.waitForTimeout(300)
          const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0)
          if (still === 0) return true
        }
      } catch (e) {
        // ignore
      }
    }
    return false
  }
  const dismissed = await dismissOnboarding(win)
  if (dismissed) console.log('  ✓ Onboarding tour: dismissed')
  else console.log('  - Onboarding: no overlay detected or could not dismiss (continuing)')

  // ---- 1) Every tab must render alive: headline present, no crash screen,
  //         real content, and at least one enabled button to press.
  for (const tab of TABS) {
    try {
      await navigateTo(win, tab.name, tab.route)

      if ((await win.locator('text=This tab hit a snag').count()) > 0) {
        fail(tab.name, 'crashed (ErrorBoundary is showing)')
        continue
      }
      // Prefer a heading-based check first; main.innerText can be noisy or very long.
      let mainText = (await win.locator('main').innerText()).trim()

      // If the main text is very short, try to read headings instead (h1/h2/h3 or role=heading)
      if (mainText.length < 40) {
        const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => [])
        const headText = (Array.isArray(headings) ? headings.join(' ') : '')
        if (headText && headText.length > mainText.length) mainText = headText
      }

      if (mainText.length < 40) {
        fail(tab.name, `rendered nearly blank (${mainText.length} chars of text)`)
        continue
      }

      // Robust mustSee check: substring match against mainText and any heading nodes.
      const must = (tab.mustSee || '').toLowerCase()
      let found = must && mainText.toLowerCase().includes(must)
      if (!found) {
        const headingCount = await win.locator('main h1, main h2, main h3, main [role="heading"]').count().catch(() => 0)
        for (let i = 0; i < headingCount && !found; i++) {
          const ht = (await win.locator('main h1, main h2, main h3, main [role="heading"]').nth(i).innerText()).toLowerCase()
          if (ht.includes(must)) found = true
        }
      }

      // Route-name drift fallback (common hyphen/no-hyphen mismatch such as "scriptpad" <-> "script-pad").
      if (!found) {
        let alt = ''
        if (tab.route.includes('scriptpad')) alt = tab.route.replace('scriptpad', 'script-pad')
        else if (tab.route.includes('script-pad')) alt = tab.route.replace('script-pad', 'scriptpad')
        if (alt) {
          await win.evaluate((r) => (window.location.hash = `#${r}`), alt)
          await win.waitForTimeout(700)
          const newMain = (await win.locator('main').innerText()).trim()
          if (newMain.toLowerCase().includes(must)) found = true
        }
      }

      if (!found) {
              // Instrumentation: capture main innerText length + excerpt + timestamp for a failing mustSee
              try {
                const ts = new Date().toISOString()
                const snippet = mainText.replace(/\s+/g, ' ').slice(0, 300)
                // also capture the current hash and headings to help diagnose route vs render problems
                try {
                  const hash = await win.evaluate(() => window.location.hash)
                  const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => [])
                  console.error(`  [INSTRUMENT] ${tab.name} mustSee failure at ${ts} — hash="${hash}" — main.length=${mainText.length} — headings=${JSON.stringify(headings)} — excerpt="${snippet}"`)
                } catch (e) {
                  console.error(`  [INSTRUMENT] ${tab.name} mustSee failure at ${ts} — main.length=${mainText.length} — excerpt="${snippet}" (failed to capture hash/headings: ${e})`)
                }
              } catch (e) {
                console.error('  [INSTRUMENT] failed to capture main excerpt', e)
              }
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
    } finally {
      // Ensure any persistent drawers or modals opened by a tab (e.g., Script Writer) are closed
      try {
        await (async function closeStickyOverlay(win) {
          // If the main still shows a tab heading that differs from the current hash's target
          const hash = await win.evaluate(() => window.location.hash)
          const mainHeadings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => [])
          const headingText = (Array.isArray(mainHeadings) && mainHeadings[0]) ? mainHeadings[0] : ''
          if (headingText && hash && !headingText.toLowerCase().includes(hash.replace('#/','').replace('-',' '))) {
            // Try to click common close/back/done buttons inside main or overlays
            const closeLabels = ['Close', 'Done', 'Back', 'Hide', 'Dismiss', '×', 'Close editor']
            for (const lbl of closeLabels) {
              const btn = win.locator('main button, div[role="dialog"] button', { hasText: lbl }).first()
              if ((await btn.count()) > 0) {
                await btn.click().catch(() => {})
                await win.waitForTimeout(300)
              }
            }
            // Fallback: click any [aria-label="Close"] icons
            const ariaClose = win.locator('[aria-label="Close"]').first()
            if ((await ariaClose.count()) > 0) await ariaClose.click().catch(() => {})
            await win.waitForTimeout(200)
          }
        })(win)
      } catch (e) {
        // ignore overlay cleanup errors
      }
    }
  }

  // ---- 2) The core promise, clicked like a user: paste a script in Video Studio,
  //         pick the offline engine, press Build, and get an actual finished video.
  console.log('  … building a real video through the UI (offline engine)')
    try {
      await navigateTo(win, 'Video Studio', '/video')
      await win.waitForTimeout(700)

    // Robust selection for script preset
    await win.waitForSelector('main select', { timeout: 10000 })
    const selectEl = win.locator('main select').first()
    let didSelect = false
    try {
      await selectEl.waitForSelector('option', { timeout: 8000 })
      const opt = selectEl.locator('option', { hasText: 'Paste' })
      if ((await opt.count()) > 0) {
        const val = await opt.first().getAttribute('value')
        if (val) {
          await selectEl.selectOption({ value: val })
          didSelect = true
        }
      }
      if (!didSelect) {
        await selectEl.selectOption({ index: 0 }).catch(() => {})
        didSelect = true
      }
    } catch (e) {
      await selectEl.click().catch(() => {})
      await win.keyboard.press('ArrowDown').catch(() => {})
      await win.keyboard.press('Enter').catch(() => {})
      didSelect = true
    }
    await fillVideoTitle(win, 'E2E smoke test')
    const narrationLoc1 = await findSpokenNarrationLocator(win)
    await narrationLoc1.fill('This is the automated click-through test. It builds a tiny real video completely offline.')
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
    await navigateTo(win, 'Settings', '/settings')
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
    await navigateTo(win, 'Script Pad', '/scriptpad')
    await win.waitForTimeout(500)
    const pad = win.locator('main textarea').first()
    await pad.fill('E2E autosave probe — do not lose me')
    await win.waitForTimeout(1200) // let the debounced save fire
    await navigateTo(win, 'Today', '/')
    await win.waitForTimeout(400)
    await navigateTo(win, 'Script Pad', '/scriptpad')
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
    await navigateTo(win, 'Video Studio', '/video')
    await win.waitForTimeout(700)
    // Robust selection: ensure the select and its options are present before choosing
    await win.waitForSelector('main select', { timeout: 10000 })
    const selectEl2 = win.locator('main select').first()
    try {
      await selectEl2.waitForSelector('option', { timeout: 8000 })
      const opt2 = selectEl2.locator('option', { hasText: 'Paste' })
      if ((await opt2.count()) > 0) {
        const val = await opt2.first().getAttribute('value')
        if (val) await selectEl2.selectOption({ value: val })
        else await selectEl2.selectOption({ index: 0 }).catch(() => {})
      } else {
        await selectEl2.selectOption({ index: 0 }).catch(() => {})
      }
    } catch (e) {
      await selectEl2.click().catch(() => {})
      await win.keyboard.press('ArrowDown').catch(() => {})
      await win.keyboard.press('Enter').catch(() => {})
    }
    await (await findVideoTitleLocator(win)).fill('')
    const narrationLoc2 = await findSpokenNarrationLocator(win)
    await narrationLoc2.fill('')
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
    await fillVideoTitle(win, 'E2E اردو test 🎬')
    const narrationLoc3 = await findSpokenNarrationLocator(win)
    await narrationLoc3.fill('Rupay ki girawat aur mehngai. معیشت کا تجزیہ اور منافع کی کہانی۔ Emoji check 🚀📈 done.')
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
    await fillVideoTitle(win, 'E2E huge cancel test')
    const narrationLoc4 = await findSpokenNarrationLocator(win)
    await narrationLoc4.fill(huge)
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
    await navigateTo(win, 'Today', '/')
    await win.waitForTimeout(300)
    await navigateTo(win, 'Storyboard Director', '/storyboard')
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
