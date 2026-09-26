import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Tracker } from '../../packages/browser/src/index.js';

const base = 'http://127.0.0.1:5185';
const manifest = JSON.parse(await readFile('dist/browser/manifest.json', 'utf8'));
declare global { interface Window { sessionProbe: Tracker } }

async function mount(page: Page, pageId: string) {
  await page.evaluate(async ({ url, pageId }) => {
    const api = await import(url);
    const definitionUrl = new URL('/definition.js', url).href;
    const { definition } = await import(definitionUrl);
    window.sessionProbe = api.createTracker({ definition, pageId, storage: 'session', engine: api.createRulesEngine() });
  }, { url: `${base}/${manifest.files.es.filename}`, pageId });
}
async function resume(page: Page) {
  await page.evaluate(() => { window.sessionProbe.setConsent('granted'); window.sessionProbe.start(); });
}

test('B07: session opt-in restores across full page loads only after consent and clears on withdrawal', async ({ page }) => {
  await page.goto(`${base}/es/`);
  await mount(page, 'home'); await resume(page);
  await page.evaluate(() => {
    window.sessionProbe.track('demo-feature-used');
    window.sessionProbe.recordOutcome('demo-features-guide', 'completed');
  });
  const before = await page.evaluate(() => window.sessionProbe.getSnapshot());
  expect(before.observations.some((row) => row.signalId === 'demo-feature-used' && row.actions === 1)).toBe(true);

  await page.goto(`${base}/iife/`); // A new document, same origin and tab.
  await mount(page, 'features-guide');
  expect(await page.evaluate(() => window.sessionProbe.getSnapshot().observations)).toEqual([]);
  await page.evaluate(() => window.sessionProbe.setConsent('granted'));
  expect(await page.evaluate(() => window.sessionProbe.getSnapshot().observations)).toEqual([]);
  await page.evaluate(() => window.sessionProbe.start());
  const restored = await page.evaluate(() => window.sessionProbe.getSnapshot());
  expect(restored.pageViewId).not.toBe(before.pageViewId);
  expect(restored.observations.some((row) => row.signalId === 'demo-feature-used' && row.actions === 1)).toBe(true);
  expect(restored.outcomes.some((row) => row.contentId === 'demo-features-guide' && row.kind === 'completed')).toBe(true);

  await page.goto(`${base}/es/`);
  await mount(page, 'home'); await resume(page);
  const decision = await page.evaluate(() => window.sessionProbe.evaluate());
  expect(decision).toBeDefined();
  expect(decision!.assessments.some((row) => row.contentId === 'demo-features-guide')).toBe(false);
  expect(await page.evaluate(() => window.sessionProbe.getSnapshot().observations.length)).toBeGreaterThan(0);
  await page.evaluate(() => window.sessionProbe.setConsent('denied'));
  expect(await page.evaluate(() => sessionStorage.getItem('imicue:demo-contract:demo-1'))).toBeNull();
  await page.reload(); await mount(page, 'home'); await resume(page);
  expect(await page.evaluate(() => window.sessionProbe.getSnapshot().observations)).toEqual([]);
});
