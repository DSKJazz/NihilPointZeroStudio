import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-writer-diag-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
const logs = [];
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  win.on('console', (msg) => {
    const text = `[PAGE-CONSOLE] ${msg.type()} ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  win.on('pageerror', (err) => {
    const text = `[PAGE-ERROR] ${String(err?.message ?? err)}`;
    logs.push(text);
    console.error(text);
  });

  // dismiss onboarding if present
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

  // Go to Script Writer (or Script Pad) and autosave
  const nav = win.locator('nav');
  let used = null;
  if ((await nav.count()) > 0) {
    if ((await nav.locator('a', { hasText: 'Script Writer' }).count()) > 0 || (await nav.locator('button', { hasText: 'Script Writer' }).count()) > 0) {
      await nav.locator('a', { hasText: 'Script Writer' }).first().click().catch(() => {});
      used = 'writer';
    } else if ((await nav.locator('a', { hasText: 'Script Pad' }).count()) > 0 || (await nav.locator('button', { hasText: 'Script Pad' }).count()) > 0) {
      await nav.locator('a', { hasText: 'Script Pad' }).first().click().catch(() => {});
      used = 'pad';
    }
  }
  await win.waitForTimeout(500);
  console.log('DIAG: navigated to', used);

  const ta = win.locator('main textarea').first();
  if ((await ta.count()) > 0) {
    await ta.fill('E2E diag autosave probe');
    await win.waitForTimeout(1200);
    console.log('DIAG: typed into textarea and waited');
  } else {
    console.log('DIAG: textarea not found in writer/pad');
  }

  // Now attempt navigation to Video Studio
  console.log('DIAG: attempting nav to Video');
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else {
    await win.evaluate(() => (window.location.hash = '#/video'));
  }

  // wait a bit for any lifecycle
  await win.waitForTimeout(1000);

  // capture diagnostics after attempted nav
  const hash = await win.evaluate(() => window.location.hash).catch(() => '');
  const pathn = await win.evaluate(() => location.pathname).catch(() => '');
  const mainText = await win.locator('main').innerText().catch(() => '');
  const headings = await win.locator('main h1, main h2, main h3, main [role="heading"]').allInnerTexts().catch(() => []);
  console.log('DIAG-RESULT hash=', hash, ' pathname=', pathn);
  console.log('DIAG-RESULT main.length=', mainText.length);
  console.log('DIAG-RESULT headings=', JSON.stringify(headings));
  console.log('DIAG-RESULT main excerpt:', mainText.slice(0, 500).replace(/\n/g, ' '));

  // check for unmount trace in captured console logs
  const sawUnmount = logs.some((l) => l.includes('WriterPage unmounted'));
  const sawMount = logs.some((l) => l.includes('WriterPage mounted'));
  console.log('DIAG-TRACE saw WriterPage mounted in logs?', sawMount);
  console.log('DIAG-TRACE saw WriterPage unmounted in logs?', sawUnmount);

  // Also check if Video heading exists
  const hasVideoHeading = headings.some((h) => /video/i.test(h));
  console.log('DIAG-TRACE video heading present?', hasVideoHeading);

  // Dump captured console messages count
  console.log('DIAG: captured console messages count =', logs.length);

  // Print the full console log lines for review
  console.log('--- Full page console log ---');
  for (const l of logs) console.log(l);

} catch (err) {
  console.error('DIAG-SCRIPT ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
