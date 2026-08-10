import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-writer-trace-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  // capture console and pageerror
  win.on('console', (msg) => console.log('[PAGE-CONSOLE]', msg.type(), msg.text()));
  win.on('pageerror', (err) => console.error('[PAGE-ERROR]', err?.message ?? err));

  // dismiss onboarding
  const labels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", 'Start', 'Get started', "Let's go", 'Start tour'];
  for (const label of labels) {
    const b = win.locator('button', { hasText: label }).first();
    if ((await b.count()) > 0) {
      await b.click().catch(() => {});
      await win.waitForTimeout(300);
      const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0);
      if (still === 0) break;
    }
  }

  // go to Script Writer, autosave
  const nav = win.locator('nav');
  if ((await nav.count()) > 0) {
    const wbtn = nav.locator('button', { hasText: 'Script Writer' }).first();
    const wa = nav.locator('a', { hasText: 'Script Writer' }).first();
    if ((await wbtn.count()) > 0) await wbtn.click().catch(() => {});
    else if ((await wa.count()) > 0) await wa.click().catch(() => {});
    else console.log('Writer nav not found');
  } else {
    console.log('nav not found');
  }
  await win.waitForTimeout(500);
  console.log('--- After navigating to Writer ---');
  await win.waitForTimeout(200);
  // type into textarea if present
  const ta = win.locator('main textarea').first();
  if ((await ta.count()) > 0) {
    await ta.fill('E2E trace autosave probe');
    await win.waitForTimeout(1200);
    console.log('Typed into writer textarea and waited');
  } else {
    console.log('No textarea found in writer after navigation');
  }

  // now attempt navigation to Video and watch console
  console.log('--- Attempting navigation to Video Studio ---');
  const vid = win.locator('nav a', { hasText: 'Video Studio' }).first();
  const vidBtn = win.locator('nav button', { hasText: 'Video Studio' }).first();
  if ((await vid.count()) > 0) await vid.click().catch(() => {});
  else if ((await vidBtn.count()) > 0) await vidBtn.click().catch(() => {});
  else await win.evaluate(() => (window.location.hash = '#/video'));

  // log location.hash and location.pathname
  try {
    const h = await win.evaluate(() => window.location.hash);
    const p = await win.evaluate(() => location.pathname);
    console.log('POST-NAV VIDEO: hash=', h, ' pathname=', p);
  } catch (e) { console.log('failed to read location after video nav', e); }

  // wait and collect console for a short period to see mount/unmount logs
  for (let i = 0; i < 10; i++) {
    await win.waitForTimeout(300);
  }

  console.log('--- Attempting navigation to Storyboard ---');
  const sb = win.locator('nav a', { hasText: 'Storyboard Director' }).first();
  if ((await sb.count()) > 0) await sb.click().catch(() => {});
  else await win.evaluate(() => (window.location.hash = '#/storyboard'));

  try {
    const h2 = await win.evaluate(() => window.location.hash);
    const p2 = await win.evaluate(() => location.pathname);
    console.log('POST-NAV STORYBOARD: hash=', h2, ' pathname=', p2);
  } catch (e) { console.log('failed to read location after storyboard nav', e); }

  for (let i = 0; i < 10; i++) await win.waitForTimeout(300);

  console.log('--- Done: collected console output ---');

} catch (err) {
  console.error('Script failed:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
