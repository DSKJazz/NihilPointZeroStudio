import { _electron as electron } from 'playwright-core';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataHome = join(tmpdir(), 'npz-e2e-writer-mut-' + Date.now());
mkdirSync(dataHome, { recursive: true });
let app;
try {
  app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('main', { timeout: 15000 });

  win.on('console', (msg) => console.log('[PAGE-CONSOLE]', msg.type(), msg.text()));
  win.on('pageerror', (err) => console.error('[PAGE-ERROR]', err?.message ?? err));

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

  // install mutation observer in page context
  await win.evaluate(() => {
    window.__npz_mutations = [];
    const target = document.querySelector('main') || document.body;
    const snapshot = () => ({ ts: new Date().toISOString(), text: (document.querySelector('main')?.innerText || '').slice(0, 400) });
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        window.__npz_mutations.push({
          ts: new Date().toISOString(),
          type: m.type,
          added: m.addedNodes ? Array.from(m.addedNodes).map(n => ({ tag: n.nodeName, text: (n.textContent||'').slice(0,200) })) : [],
          removed: m.removedNodes ? Array.from(m.removedNodes).map(n => ({ tag: n.nodeName, text: (n.textContent||'').slice(0,200) })) : [],
          attrName: m.attributeName || null,
          snapshot: snapshot()
        });
      }
    });
    obs.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__npz_mutation_observer = obs;
    console.log('[MUTATION] observer installed on', target ? target.nodeName : 'none');
  });

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
    await ta.fill('E2E mutation probe');
    await win.waitForTimeout(1200);
    console.log('ACTION: typed into writer textarea and waited');
  } else console.log('ACTION: writer textarea missing');

  // now navigate to Video Studio
  console.log('ACTION: attempting nav to Video Studio');
  if ((await nav.count()) > 0 && (await nav.locator('a', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('a', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else if ((await nav.count()) > 0 && (await nav.locator('button', { hasText: 'Video Studio' }).count()) > 0) {
    await nav.locator('button', { hasText: 'Video Studio' }).first().click().catch(() => {});
  } else await win.evaluate(() => (window.location.hash = '#/video'));

  await win.waitForTimeout(1500);

  const result = await win.evaluate(() => {
    const hash = window.location.hash;
    const main = document.querySelector('main');
    const text = main ? main.innerText : '';
    const headings = Array.from((main?.querySelectorAll('h1,h2,h3,[role="heading"]')||[])).map(x=>x.textContent||'');
    const writerH = headings.find(h=>/script writer/i.test(String(h)));
    const videoH = headings.find(h=>/video/i.test(String(h)));
    return { hash, mainLength: text.length, headingList: headings, writerHeadingPresent: !!writerH, videoHeadingPresent: !!videoH, mainExcerpt: text.slice(0,400) };
  });

  console.log('DIAG-RESULTS:', JSON.stringify(result, null, 2));

  const mutations = await win.evaluate(() => (window.__npz_mutations || []).slice(-60));
  console.log('MUTATION-COUNT (last 60):', mutations.length);
  for (const m of mutations) console.log('MUT', JSON.stringify(m));

} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(dataHome, { recursive: true, force: true }); } catch (e) {}
}
