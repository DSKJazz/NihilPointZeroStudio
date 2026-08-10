import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-disable-prod-logs-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  const logs = [];
  win.on('console', (msg) => {
    try { logs.push({ type: msg.type(), text: msg.text(), location: msg.location ? msg.location() : null, timestamp: Date.now() }); } catch (e) {}
  });

  // set diag flag early
  await win.evaluate(() => { window.__npz_diag_disable_producer = true; });

  // dismiss onboarding
  const labels = ['Skip tour', 'Skip', 'Close', 'Dismiss', "Got it", 'Start', 'Get started', "Let's go", 'Start tour'];
  for (const l of labels) {
    const b = win.locator('button', { hasText: l }).first();
    if ((await b.count()) > 0) { await b.click().catch(() => {}); await win.waitForTimeout(200); const still = await win.locator('div[role="dialog"], div[class*="fixed"][class*="inset-0"]').count().catch(() => 0); if (still === 0) break; }
  }

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
  const ta = win.locator('main textarea').first();
  if ((await ta.count()) > 0) { await ta.fill('E2E disable simple probe'); await win.waitForTimeout(1200); }

  // navigate to video
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else await win.evaluate(() => (window.location.hash = '#/video'));

  await win.waitForTimeout(1500);
  const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => []);
  const mainText = await win.locator('main').innerText().catch(() => '');
  console.log('---PAGE-HEADINGS---')
  console.log(JSON.stringify(headings, null, 2))
  console.log('---MAIN-LEN---')
  console.log(mainText.length)
  console.log('---MAIN-EXCERPT---')
  console.log(mainText.slice(0,500))
  console.log('---PAGE-CONSOLE-COUNT---')
  console.log(logs.length)
  for (const l of logs.slice(-200)) console.log('[PAGE-CONSOLE]', l.type, l.timestamp, l.text)

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
