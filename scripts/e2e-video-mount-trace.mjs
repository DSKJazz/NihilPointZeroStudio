import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-video-mount-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 20000 });

  const logs = [];
  win.on('console', (msg) => {
    try { logs.push({ type: msg.type(), text: msg.text(), timestamp: Date.now() }); } catch (e) {}
  });

  // dismiss onboarding if present
  const labels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", 'Start', 'Get started', "Let's go", 'Start tour'];
  for (const l of labels) {
    const b = win.locator('button', { hasText: l }).first();
    if ((await b.count()) > 0) { await b.click().catch(() => {}); await win.waitForTimeout(200); const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0); if (still === 0) break; }
  }

  // (No diagnostic flags set here) — run the app in normal mode for the test

  // Ensure we are on Writer
  const nav = win.locator('nav');
  if ((await nav.count()) > 0) {
    const w = nav.locator('a', { hasText: 'Script Writer' }).first();
    if ((await w.count()) > 0) await w.click().catch(() => {});
    else {
      const wb = nav.locator('button', { hasText: 'Script Writer' }).first();
      if ((await wb.count()) > 0) await wb.click().catch(() => {});
    }
  }
  await win.waitForTimeout(500);

  // perform autosave primer (type into textarea)
  const ta = win.locator('main textarea').first();
  if ((await ta.count()) > 0) {
    await ta.fill('E2E autosave primer ' + Date.now()).catch(() => {});
    // wait for autosave debounce (600ms in app) + margin
    await win.waitForTimeout(1500);
  }

  // record location before nav
  const before = await win.evaluate(() => ({ pathname: location.pathname, hash: location.hash }));

  // attempt nav to video
  // enable the diagnostic forced-hash-nav so the app will call navigate() on hashchange
  await win.evaluate(() => { try { window.__npz_diag_force_hash_nav = true; console.log('[E2E-SCRIPT] enabled __npz_diag_force_hash_nav at', Date.now()) } catch (e) { console.log('[E2E-SCRIPT] enabling diag flag failed', e) } });
  await win.evaluate(() => console.log('[E2E-SCRIPT] about to click nav at', Date.now()));
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else {
    await win.evaluate(() => { console.log('[E2E-SCRIPT] setting hash directly at', Date.now()); window.location.hash = '#/video' });
  }
  await win.evaluate(() => console.log('[E2E-SCRIPT] after click / hash set at', Date.now()));

  // dispatch a synthetic hashchange event to test whether the router's listener fires
  await win.evaluate(() => {
    try {
      console.log('[E2E-SCRIPT] dispatching synthetic hashchange at', Date.now())
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } catch (err) { console.log('[E2E-SCRIPT] synthetic hashchange failed', err) }
  })

  // If the app exposes the navigation shim, use it as a stronger navigation method
  await win.evaluate(() => {
    try {
      if (window.__npz_navTo) {
        console.log('[E2E-SCRIPT] calling __npz_navTo shim at', Date.now())
        window.__npz_navTo('/video')
      } else {
        console.log('[E2E-SCRIPT] __npz_navTo shim not present')
      }
    } catch (err) { console.log('[E2E-SCRIPT] __npz_navTo call failed', err) }
  })

  // Also dispatch the test-only event that asks the app to force navigation (diagnostic)
  await win.evaluate(() => {
    try {
      console.log('[E2E-SCRIPT] dispatching npz-force-nav event at', Date.now())
      window.dispatchEvent(new Event('npz-force-nav'))
    } catch (err) { console.log('[E2E-SCRIPT] npz-force-nav dispatch failed', err) }
  })

  // wait for short period to let routing/render happen
  await win.waitForTimeout(1600);

  const after = await win.evaluate(() => ({ pathname: location.pathname, hash: location.hash }));
  const mainText = await win.locator('main').innerText().catch(() => '');

  // filter logs for relevant traces
  // Capture a broad set of diagnostic logs including producer and autosave traces
  // For deep diagnosis, capture the last 2000 console logs from the page
  const relevant = logs.slice(-2000);

  console.log('---BEFORE---');
  console.log(JSON.stringify(before, null, 2));
  console.log('---AFTER---');
  console.log(JSON.stringify(after, null, 2));
  console.log('---MAIN-LEN---');
  console.log(mainText.length);
  console.log('---MAIN-EXCERPT---');
  console.log(mainText.slice(0, 600));
  console.log('---RELEVANT-LOGS-COUNT---');
  console.log(relevant.length);
  console.log('---RELEVANT-LOGS---');
  for (const l of relevant) console.log('[PAGE-CONSOLE]', l.type, l.timestamp, l.text);

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
