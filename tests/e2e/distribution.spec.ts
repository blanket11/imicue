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

  test(`P02: generated ${format} evaluates all 100 candidates from views and honors withdrawal`, async ({ page }) => {
    const errors: string[] = []; const posts: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.clock.install();
    await page.goto(`${base}/${format}/`);
    const before = await page.evaluate(async ({ format, url }) => {
      const api: typeof import('../../packages/browser/src/index.js') & { createRulesEngine: typeof import('../../packages/core/src/index.js').createRulesEngine }
        = format === 'iife' ? (window as unknown as { Imicue: typeof api }).Imicue : await import(url);
      const root = document.createElement('main');
      root.style.cssText = 'position:fixed;inset:0;padding:0;margin:0;background:white;';
      for (const signalId of ['overview', 'features']) {
        const section = document.createElement('section');
        section.dataset.imicueSignal = signalId;
        section.style.cssText = 'height:200px;width:100%;padding:0;margin:0;';
        section.textContent = signalId;
        root.append(section);
      }
      document.body.replaceChildren(root);
      const definition = {
        schemaVersion: '0.1', siteId: 'distribution-scale', definitionVersion: 'scale-v1',
        signals: { overview: { kind: 'content', description: 'Synthetic overview' }, features: { kind: 'content', description: 'Synthetic feature details' } },
        contents: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`candidate-${String(index).padStart(3, '0')}`, {
          title: `Synthetic guide ${index}`, description: `Synthetic guide ${index}`, href: `/guide/${index}/`, enabled: true,
          relatedSignalIds: index === 99 ? ['features'] : [],
        }])),
        pages: { home: {} },
      };
      const tracker = api.createTracker({ definition, pageId: 'home', root, engine: api.createRulesEngine() });
      const harness: { tracker: typeof tracker; decision?: import('../../packages/core/src/index.js').Decision } = { tracker };
      Object.assign(window, { distributionScale: harness });
      tracker.onDecision((decision) => { harness.decision = decision; });
      tracker.start();
      const beforeConsent = tracker.getState().started;
      tracker.setConsent('granted');
      return { beforeConsent, afterConsent: tracker.getState().started, observations: tracker.getSnapshot().observations };
    }, { format, url: `${base}/${manifest.files.es.filename}` });
    expect(before).toEqual({ beforeConsent: false, afterConsent: false, observations: [] });
    await page.evaluate(() => (window as unknown as { distributionScale: { tracker: import('../../packages/browser/src/index.js').Tracker } }).distributionScale.tracker.start());
    await page.waitForTimeout(100);
    await page.clock.runFor(3_000);
    const initial = await page.evaluate(() => {
      const harness = (window as unknown as { distributionScale: { tracker: import('../../packages/browser/src/index.js').Tracker; decision?: import('../../packages/core/src/index.js').Decision } }).distributionScale;
      return { snapshot: harness.tracker.getSnapshot(), decision: harness.decision };
    });
    expect(initial.snapshot.observations).toHaveLength(2);
    expect(initial.snapshot.observations.every((row) => row.qualifiedViews === 1 && row.clicks === 0 && row.actions === 0)).toBe(true);
    expect(initial.decision).toMatchObject({ type: 'abstain', reason: 'below_threshold' });
    // The first 17s evaluation has only 15s committed visibility; after decay its score is below 0.35.
    // Reach the 32s evaluation with 30s committed visibility without changing the evidence policy.
    await page.clock.runFor(30_000);
    const completed = await page.evaluate(() => {
      const harness = (window as unknown as { distributionScale: { tracker: import('../../packages/browser/src/index.js').Tracker; decision: import('../../packages/core/src/index.js').Decision } }).distributionScale;
      const decision = harness.decision;
      const displayBefore = harness.tracker.canDisplay(decision);
      harness.tracker.setConsent('denied');
      const state = harness.tracker.getState();
      const observations = harness.tracker.getSnapshot().observations;
      const displayAfter = harness.tracker.canDisplay(decision);
      harness.tracker.destroy();
      return { decision, displayBefore, displayAfter, state, observations };
    });
    expect(completed.decision).toMatchObject({ type: 'recommend', contentId: 'candidate-099', engine: { name: 'rules' } });
    expect(completed.decision.assessments).toHaveLength(100);
    expect(completed.displayBefore).toBe(true);
    expect(completed.displayAfter).toBe(false);
    expect(completed.state).toMatchObject({ consent: 'denied', started: false });
    expect(completed.observations).toEqual([]);
    expect(posts).toEqual([]);
    expect(errors).toEqual([]);
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
