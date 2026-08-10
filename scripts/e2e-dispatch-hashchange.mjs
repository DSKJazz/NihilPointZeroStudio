import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-dispatch-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  win.on('console', (msg) => console.log('[PAGE-CONSOLE]', msg.type(), msg.text()));

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

  // go to writer and autosave
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
    await ta.fill('E2E dispatch probe');
    await win.waitForTimeout(1200);
    console.log('ACTION: typed into writer');
  }

  // click nav to video
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else await win.evaluate(() => (window.location.hash = '#/video'));

  await win.waitForTimeout(800);
  console.log('ACTION: dispatched synthetic hashchange');
  await win.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await win.waitForTimeout(800);

  // capture final main heading
  const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => []);
  console.log('FINAL HEADINGS:', JSON.stringify(headings));

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
