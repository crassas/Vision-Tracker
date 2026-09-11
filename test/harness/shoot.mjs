/**
 * Screenshot + smoke harness. Drives the real app in a real Chromium with a
 * synthetic camera, and renders the real HUD against synthetic tracking data.
 *
 *   node test/harness/shoot.mjs
 *
 * Model weights are fetched from a Google bucket, so in a network-restricted
 * environment the CV modules will report a fault — the harness asserts the app
 * degrades gracefully rather than crashing, and still proves camera, layout,
 * governor and HUD rendering.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const EXE = process.env.VT_CHROMIUM ?? '/tmp/chromium-wrap';
const BASE = process.env.VT_BASE ?? 'http://localhost:5173';
const FAKE_CAM = readFileSync(new URL('./fake-camera.js', import.meta.url), 'utf8');

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const report = [];
const shoot = async (name, vp, mobile, steps) => {
  const ctx = await browser.newContext({
    viewport: vp, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: mobile ? 3 : 1, permissions: ['camera'],
  });
  await ctx.addInitScript(FAKE_CAM);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
  // Model weights live on a Google bucket. Where that is unreachable the CV
  // modules fault by design; that is not a harness failure, so filter it out
  // and assert only on things the harness genuinely controls.
  const realErr = (e) =>
    !/ERR_CONNECTION|Failed to fetch|net::|storage\.googleapis/i.test(e);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const r = await steps(page);
  // Overflow is the failure this harness exists to catch.
  const overflow = await page.evaluate(() => {
    const bar = document.querySelector('.bar');
    return {
      barScroll: bar ? bar.scrollWidth - bar.clientWidth : -1,
      docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  report.push({ name, ...r, overflow, errs: errs.filter(realErr), netBlocked: errs.length - errs.filter(realErr).length });
  await ctx.close();
};

// HUD proof against synthetic tracking data.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${BASE}/test/harness/hud-proof.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.HUD_DONE === true', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/hud-desktop.png' });
  report.push({ name: 'hud-proof', errs });
  await ctx.close();
}

const arm = async (page) => {
  await page.getByRole('button', { name: /ARM SYSTEM/i }).click();
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    const v = document.querySelector('video');
    const c = document.querySelector('canvas');
    return {
      video: v ? { w: v.videoWidth, h: v.videoHeight, playing: !v.paused } : null,
      canvas: c ? { w: c.width, h: c.height } : null,
      tier: document.querySelectorAll('.gauge')[4]?.textContent,
      sensor: document.querySelectorAll('.gauge')[5]?.textContent,
      log: [...document.querySelectorAll('.log div')].map((d) => d.textContent).slice(0, 6),
    };
  });
};

await shoot('desktop', { width: 1366, height: 768 }, false, async (page) => {
  await page.screenshot({ path: 'docs/app-desktop-idle.png' });
  const s = await arm(page);
  await page.screenshot({ path: 'docs/app-desktop-live.png' });
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/app-desktop-panel.png' });
  return s;
});

await shoot('mobile', { width: 390, height: 844 }, true, async (page) => {
  await page.screenshot({ path: 'docs/app-mobile-idle.png' });
  const s = await arm(page);
  await page.screenshot({ path: 'docs/app-mobile-live.png' });
  return s;
});

await shoot('mobile-narrow', { width: 320, height: 700 }, true, async (page) => {
  const s = await arm(page);
  await page.screenshot({ path: 'docs/app-mobile-narrow.png' });
  return s;
});

await browser.close();
console.log(JSON.stringify(report, null, 2));

const bad = report.filter((r) => (r.overflow && (r.overflow.barScroll > 0 || r.overflow.docScroll > 0)) || r.errs?.length);
if (bad.length) {
  console.error('\nFAILURES:\n' + JSON.stringify(bad, null, 2));
  process.exit(1);
}
console.log('\nAll viewports: no overflow, no page errors.');
