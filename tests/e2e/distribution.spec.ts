import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:5185';
const manifest = JSON.parse(await readFile('dist/browser/manifest.json', 'utf8'));

for (const format of ['es', 'iife']) {
  test(`P02: generated ${format} stays idle before consent, then produces the same Rules result`, async ({ page }) => {
    const errors: string[] = []; const decisions: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST') decisions.push(request.url()); });
    await page.goto(`${base}/${format}/`);
    await page.locator('#action').click();
    expect(JSON.parse((await page.locator('#snapshot').textContent())!).observations).toEqual([]);
    await page.locator('#consent').check();
    await page.locator('#action').click();
    expect(JSON.parse((await page.locator('#snapshot').textContent())!).observations).toEqual([]);
    await page.locator('#start').click();
    await page.locator('#action').click();
    await expect(page.locator('#decision')).toContainText('demo-features-guide');
    const decision = JSON.parse((await page.locator('#decision').textContent())!);
    expect(decision).toMatchObject({ type: 'recommend', contentId: 'demo-features-guide', engine: { name: 'rules' } });
    expect(decision.assessments[0].score).toBeCloseTo(0.6, 2);
    await page.locator('#revoke').click();
    expect(JSON.parse((await page.locator('#snapshot').textContent())!).observations).toEqual([]);
    expect(decisions).toEqual([]); expect(errors).toEqual([]);
  });
}

test('P02: duplicate IIFE scripts preserve the API and duplicate starts produce a diagnostic', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.goto(`${base}/iife/`);
  const before = await page.evaluate(() => Object.keys((window as unknown as { Imicue: object }).Imicue));
  await page.addScriptTag({ url: `${base}/${manifest.files.iife.filename}` });
  expect(warnings).toContain('imicue:global_conflict');
  expect(await page.evaluate(() => Object.keys((window as unknown as { Imicue: object }).Imicue))).toEqual(before);
  await page.locator('#consent').check(); await page.locator('#start').click();
  const result = await page.evaluate(async (url) => {
    const api = (window as unknown as { Imicue: typeof import('../../packages/browser/src/index.js') }).Imicue;
    const { definition } = await import(url);
    const duplicate = api.createTracker({ definition, pageId: 'home' });
    const codes: string[] = []; duplicate.onDiagnostic((event) => codes.push(event.code));
    duplicate.setConsent('granted'); duplicate.start();
    const started = duplicate.getState().started; duplicate.destroy();
    return { codes, started };
  }, `${base}/definition.js`);
  expect(result).toEqual({ codes: ['duplicate_tracker'], started: false });
});

test('P02: existing global names are not overwritten and loading IIFE alone starts no observers', async ({ page }) => {
  await page.addInitScript(() => { Object.assign(window, { Imicue: { marker: 'existing' } }); });
  await page.goto(`${base}/iife/`);
  await expect(page.locator('#status')).toContainText('グローバル名の競合');
  expect(await page.evaluate(() => (window as unknown as { Imicue: { marker: string } }).Imicue.marker)).toBe('existing');
  const isolated = await page.context().newPage();
  // A data-free blank document separates the library script from the demo initializer.
  await isolated.goto(`${base}/definition.js`);
  await isolated.evaluate(() => {
    Object.assign(window, { observed: 0 });
    window.IntersectionObserver = class { constructor() { (window as unknown as { observed: number }).observed++; } } as unknown as typeof IntersectionObserver;
  });
  await isolated.addScriptTag({ url: `${base}/${manifest.files.iife.filename}` });
  expect(await isolated.evaluate(() => (window as unknown as { observed: number }).observed)).toBe(0);
  await isolated.close();
});
