import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-manual-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });
  const names = ['Video Studio', 'Storyboard Director', 'Timeline Editor', 'Settings'];
  const results = [];
  async function dismiss() {
    const labels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", 'Start', 'Get started', "Let's go", 'Start tour'];
    for (const label of labels) {
      const btn = win.locator('button', { hasText: label }).first();
      if (await btn.count() > 0) {
        await btn.click().catch(() => {});
        await win.waitForTimeout(500);
        if ((await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count()) === 0) return true;
      }
    }
    return false;
  }
  await dismiss();

  // --- AUTOSAVE PRIMER: reproduce the harness sequence that previously caused contamination
  // Try to open Script Writer or Script Pad, type a short autosave, then return home.
  let didAutosave = false;
  const writerTargets = ['Script Writer', 'Script Pad'];
  for (const w of writerTargets) {
    const nav = win.locator('nav');
    let clicked = false;
    if (await nav.count() > 0) {
      const btn = nav.locator('button', { hasText: w }).first();
      if (await btn.count() > 0) { await btn.click().catch(() => {}); clicked = true; }
      else { const a = nav.locator('a', { hasText: w }).first(); if (await a.count() > 0) { await a.click().catch(() => {}); clicked = true; } }
    }
    if (!clicked) {
      const btn = win.locator('button', { hasText: w }).first();
      if (await btn.count() > 0) { await btn.click().catch(() => {}); clicked = true; }
      else { const a = win.locator('a', { hasText: w }).first(); if (await a.count() > 0) { await a.click().catch(() => {}); clicked = true; } }
    }
    if (clicked) {
      await win.waitForTimeout(500);
      const ta = win.locator('main textarea').first();
      if (await ta.count() > 0) {
        await ta.fill('E2E autosave probe — do not lose me');
        await win.waitForTimeout(1200); // debounce flush
        didAutosave = true;
        break;
      }
    }
  }
  if (didAutosave) {
    // return to Today to mirror the harness behavior
    const home = win.locator('nav a', { hasText: '🏠 Today' }).first();
    if (await home.count() > 0) await home.click().catch(() => {});
    else await win.evaluate(() => (window.location.hash = '#/'));
    await win.waitForTimeout(400);
    console.log('manual-tab-check: performed writer autosave primer');
  } else {
    console.log('manual-tab-check: writer autosave primer not performed (writer not found)');
  }

  for (const name of names) {
    const nav = win.locator('nav');
    let clicked = false;
    if (await nav.count() > 0) {
      const btn = nav.locator('button', { hasText: name }).first();
      if (await btn.count() > 0) { await btn.click().catch(() => {}); clicked = true; }
      else { const a = nav.locator('a', { hasText: name }).first(); if (await a.count() > 0) { await a.click().catch(() => {}); clicked = true; } }
    }
    if (!clicked) {
      const btn = win.locator('button', { hasText: name }).first();
      if (await btn.count() > 0) { await btn.click().catch(() => {}); clicked = true; }
      else { const a = win.locator('a', { hasText: name }).first(); if (await a.count() > 0) { await a.click().catch(() => {}); clicked = true; } }
    }
    await win.waitForTimeout(1000);
    const hash = await win.evaluate(() => window.location.hash).catch(() => '');
    const heading = (await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => [])).join(' | ');
    const mainText = await win.locator('main').innerText().catch(() => '');
    results.push({ name, clicked, hash, heading, snippet: mainText.slice(0, 300) });
  }
  console.log(JSON.stringify({ dataHome, results }, null, 2));
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
