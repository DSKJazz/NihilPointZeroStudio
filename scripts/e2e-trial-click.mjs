import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-trial-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

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

  // Navigate to Script Writer/Script Pad and perform autosave probe
  async function clickNav(name) {
    const nav = win.locator('nav');
    if ((await nav.count()) > 0) {
      const btn = nav.locator('button', { hasText: name }).first();
      if ((await btn.count()) > 0) { await btn.click().catch(() => {}); return true; }
      const a = nav.locator('a', { hasText: name }).first();
      if ((await a.count()) > 0) { await a.click().catch(() => {}); return true; }
    }
    const btn = win.locator('button', { hasText: name }).first();
    if ((await btn.count()) > 0) { await btn.click().catch(() => {}); return true; }
    const a = win.locator('a', { hasText: name }).first();
    if ((await a.count()) > 0) { await a.click().catch(() => {}); return true; }
    return false;
  }

  // Use Script Writer or Script Pad if available
  let used = false;
  if (await clickNav('Script Writer')) {
    used = 'writer';
  } else if (await clickNav('Script Pad')) {
    used = 'pad';
  }
  if (!used) console.log('No Script Writer/Pad found; skipping autosave step');
  else {
    await win.waitForTimeout(500);
    const textarea = win.locator('main textarea').first();
    if ((await textarea.count()) > 0) {
      await textarea.fill('E2E autosave probe — do not lose me');
      await win.waitForTimeout(1200); // let autosave debounce run
      console.log('Autosave step: typed into script area and waited');
    } else {
      console.log('Autosave step: no textarea found in writer/pad');
    }
    // navigate back to Today
    await clickNav('🏠 Today');
    await win.waitForTimeout(400);
  }

  // Now perform a trial click on Video Studio nav link
  const nav = win.locator('nav');
  let target;
  if ((await nav.count()) > 0) {
    const a = nav.locator('a', { hasText: 'Video Studio' }).first();
    const b = nav.locator('button', { hasText: 'Video Studio' }).first();
    if ((await a.count()) > 0) target = a;
    else if ((await b.count()) > 0) target = b;
  }
  if (!target) {
    const a2 = win.locator('a', { hasText: 'Video Studio' }).first();
    const b2 = win.locator('button', { hasText: 'Video Studio' }).first();
    if ((await a2.count()) > 0) target = a2;
    else if ((await b2.count()) > 0) target = b2;
  }

  if (!target) {
    console.log('TRIAL-CLICK: Video Studio nav element not found');
  } else {
    try {
      await target.click({ trial: true });
      console.log('TRIAL-CLICK: locator.click({ trial: true }) succeeded — element is clickable (not obscured)');
    } catch (err) {
      console.error('TRIAL-CLICK: locator.click({ trial: true }) FAILED —', err?.message ?? err);
      try {
        const box = await target.boundingBox();
        const visible = await target.isVisible();
        const enabled = await target.isEnabled();
        console.log('TRIAL-CLICK DIAG: boundingBox=', JSON.stringify(box), 'visible=', visible, 'enabled=', enabled);
      } catch (e) {}
    }
  }

} catch (err) {
  console.error('Script failed:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
