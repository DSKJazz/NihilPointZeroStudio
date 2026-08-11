import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-listen-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  win.on('console', (msg) => console.log('[PAGE-CONSOLE]', msg.type(), msg.text()));

  // monkeypatch addEventListener to record registrations
  await win.evaluate(() => {
    window.__npz_listeners = [];
    const orig = window.addEventListener;
    window.addEventListener = function (type, fn, opts) {
      try { window.__npz_listeners.push({ type, capture: !!(opts && opts.capture), fnName: fn && fn.name ? fn.name : '<anon>' }); } catch (e) {}
      return orig.call(this, type, fn, opts);
    };
    console.log('[LISTENER-TRACE] addEventListener monkeypatched');
  });

  // dismiss onboarding
  const buttonLabels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", 'Start', 'Get started', "Let's go", 'Start tour'];
  for (const label of buttonLabels) {
    const b = win.locator('button', { hasText: label }).first();
    if ((await b.count()) > 0) {
      await b.click().catch(() => {});
      await win.waitForTimeout(300);
      const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0);
      if (still === 0) break;
    }
  }

  // navigate to writer and autosave
  const nav = win.locator('nav');
  if ((await nav.count()) > 0) {
    const writerA = nav.locator('a', { hasText: 'Script Writer' }).first();
    const writerBtn = nav.locator('button', { hasText: 'Script Writer' }).first();
    if ((await writerA.count()) > 0) await writerA.click().catch(() => {});
    else if ((await writerBtn.count()) > 0) await writerBtn.click().catch(() => {});
  }
  await win.waitForTimeout(500);
  const ta = win.locator('main textarea').first();
  if ((await ta.count()) > 0) {
    await ta.fill('E2E listener probe');
    await win.waitForTimeout(1200);
    console.log('ACTION: typed into writer');
  }

  // capture listeners before nav
  const before = await win.evaluate(() => (window.__npz_listeners || []).slice());
  console.log('LISTENERS BEFORE NAV count=', before.length);
  for (const l of before) console.log('LISTENER BEFORE', JSON.stringify(l));

  // nav to video
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else await win.evaluate(() => (window.location.hash = '#/video'));
  await win.waitForTimeout(1000);

  const after = await win.evaluate(() => (window.__npz_listeners || []).slice());
  console.log('LISTENERS AFTER NAV count=', after.length);
  for (const l of after) console.log('LISTENER AFTER', JSON.stringify(l));

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
