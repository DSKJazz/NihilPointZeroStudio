import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-writer-mut-filter-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

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

  await win.evaluate(() => {
    window.__npz_mutations = [];
    const target = document.querySelector('main') || document.body;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        window.__npz_mutations.push({
          ts: new Date().toISOString(),
          type: m.type,
          added: m.addedNodes ? Array.from(m.addedNodes).map(n => (n.textContent||'').slice(0,400)) : [],
          removed: m.removedNodes ? Array.from(m.removedNodes).map(n => (n.textContent||'').slice(0,400)) : []
        });
      }
    });
    obs.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__npz_obs = obs;
    console.log('[MUT-FILTER] observer installed');
  });

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
    await ta.fill('E2E mutation filter probe');
    await win.waitForTimeout(1200);
    console.log('ACTION: typed into writer');
  }

  // nav to video
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else await win.evaluate(() => (window.location.hash = '#/video'));

  await win.waitForTimeout(1200);

  const filtered = await win.evaluate(() => {
    const muts = window.__npz_mutations || [];
    const hits = muts.filter(m => (
      m.removed.some(r => /script writer/i.test(r)) || m.added.some(a => /script writer/i.test(a))
    ));
    return { total: muts.length, hits };
  });

  console.log('MUTATION-FILTER RESULT:', JSON.stringify(filtered, null, 2));

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
