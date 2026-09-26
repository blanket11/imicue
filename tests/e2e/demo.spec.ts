import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../packages/core/src/types.js';

async function snapshot(page: Page): Promise<Snapshot> {
  return JSON.parse((await page.locator('#snapshot').textContent()) ?? '{}') as Snapshot;
}
async function start(page: Page) {
  await page.locator('#consent').check();
  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveText('許可済み・計測中');
}
async function removeSignals(page: Page) {
  await page.evaluate(() => {
    for (const target of document.querySelectorAll('[data-imicue-signal]')) target.removeAttribute('data-imicue-signal');
  });
}

test('B07/P03: explicit consent and start, withdrawal, local-only requests and unaffected form', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.locator('#consent').check();
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.locator('#start').click();
  await page.locator('#feature-action').click();
  await expect.poll(async () => (await snapshot(page)).observations.some((row) => row.signalId === 'demo-feature-used' && row.actions === 1)).toBe(true);
  await page.locator('#revoke').click();
  expect((await snapshot(page)).observations).toEqual([]);
  expect((await snapshot(page)).outcomes).toEqual([]);
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.locator('#example-note').fill('この入力内容は計測しない');
  await page.getByRole('button', { name: '入力操作を完了', exact: true }).click();
  await expect(page.locator('#form-result')).toContainText('入力操作が完了しました');
  expect(await page.locator('#snapshot').textContent()).not.toContain('この入力内容は計測しない');
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true);
});

test('B03: a real 3000px section qualifies inside an 800px viewport', async ({ page }) => {
  await page.goto('/');
  await removeSignals(page);
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.id = 'long-section';
    section.dataset.imicueSignal = 'demo-pricing';
    section.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:3000px;pointer-events:none;opacity:0.02';
    document.body.append(section);
  });
  await start(page);
  await expect.poll(async () => (await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing')?.qualifiedViews, { timeout: 8_000 }).toBe(1);
  await expect.poll(async () => (await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing')?.visibleMs ?? 0, { timeout: 8_000 }).toBeGreaterThan(2_000);
  await page.locator('#stop').click();
  expect((await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing')?.qualifiedViews).toBe(1);
});

test('B04: a real event-loop stall does not count delayed callbacks as viewing', async ({ page }) => {
  await page.goto('/');
  await removeSignals(page);
  await page.evaluate(() => {
    const target = document.createElement('div');
    target.dataset.imicueSignal = 'demo-pricing';
    target.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:800px;pointer-events:none';
    document.body.append(target);
  });
  await start(page);
  await page.waitForTimeout(200); // Allow the real initial IntersectionObserver notification.
  // Block only this test page's event loop. This exercises genuine delayed browser timers,
  // not an overridden clock or visibility property; it is not a physical device-sleep test.
  await page.evaluate(() => {
    const end = performance.now() + 3_500;
    while (performance.now() < end) { /* Intentional bounded main-thread stall. */ }
  });
  await expect(page.locator('#diagnostics')).toContainText('clock_gap');
  const afterResume = (await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing');
  expect(afterResume?.visibleMs ?? 0).toBeLessThan(1_000);
  expect(afterResume?.qualifiedViews ?? 0).toBe(0);
  await page.locator('#status').click(); // An ordinary pointer interaction resumes active measurement.
  await expect.poll(async () => (await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing')?.qualifiedViews, { timeout: 8_000 }).toBe(1);
});

test('B06: real mutations add, rename, ignore, and remove targets', async ({ page }) => {
  await page.goto('/');
  await removeSignals(page);
  await start(page);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'dynamic-signal';
    button.textContent = '追加した対象';
    button.dataset.imicueSignal = 'demo-pricing';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:10';
    document.body.append(button);
  });
  await page.locator('#dynamic-signal').click();
  await expect.poll(async () => (await snapshot(page)).observations.find((row) => row.signalId === 'demo-pricing')?.clicks).toBe(1);
  await page.locator('#dynamic-signal').evaluate((target) => target.setAttribute('data-imicue-signal', 'demo-cases'));
  await page.locator('#dynamic-signal').click();
  await expect.poll(async () => (await snapshot(page)).observations.find((row) => row.signalId === 'demo-cases')?.clicks).toBe(1);
  await page.locator('#dynamic-signal').evaluate((target) => target.setAttribute('data-imicue-ignore', ''));
  await page.locator('#dynamic-signal').click();
  expect((await snapshot(page)).observations.find((row) => row.signalId === 'demo-cases')?.clicks).toBe(1);
  await page.locator('#dynamic-signal').evaluate((target) => target.remove());
  await page.locator('#reset').click();
  expect((await snapshot(page)).observations).toEqual([]);
});

test('the inline card waits during typing, retains focus, and records shown/dismissed', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await page.locator('#example-note').evaluate((input) => (input as HTMLInputElement).focus({ preventScroll: true }));
  await page.locator('#feature-action').evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('#decision-status')).toContainText('案内候補', { timeout: 20_000 });
  await expect(page.locator('#example-note')).toBeFocused();
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await page.locator('#start').evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  });
  await expect(page.locator('.recommendation')).toBeVisible();
  await expect(page.locator('body')).toBeFocused();
  expect((await snapshot(page)).outcomes.some((outcome) => outcome.kind === 'shown')).toBe(true);
  const dismiss = page.getByRole('button', { name: '案内を閉じる' });
  await dismiss.focus();
  await dismiss.press('Enter');
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  expect((await snapshot(page)).outcomes.some((outcome) => outcome.kind === 'dismissed')).toBe(true);
  await expect(page.locator('#features a')).toBeVisible();
});

test('recommendation clicks and the explicit source marker are recorded separately', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await page.locator('#feature-action').click();
  const recommendation = page.locator('.recommendation a');
  await expect(recommendation).toBeVisible({ timeout: 20_000 });
  // A new tab keeps the original in-memory snapshot inspectable after a real link click.
  await recommendation.evaluate((link) => link.setAttribute('target', '_blank'));
  const popupPromise = page.waitForEvent('popup');
  await recommendation.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect((await snapshot(page)).outcomes.some((outcome) => outcome.kind === 'clicked' && outcome.contentId === 'demo-features-guide')).toBe(true);
  await expect(popup).toHaveURL('/guides/features/#imicue-recommendation');
  await start(popup);
  await expect.poll(async () => (await snapshot(popup)).observations.some((row) => row.signalId === 'demo-features-guide-view' && row.source === 'recommendation' && row.qualifiedViews === 1), { timeout: 8_000 }).toBe(true);
  await popup.close();
});

test('the modal guard defers a new card and the ordinary guide remains available', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await page.evaluate(() => {
    const modal = document.createElement('div');
    modal.id = 'test-modal';
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    document.body.append(modal);
    (document.getElementById('feature-action') as HTMLButtonElement).click();
  });
  await expect(page.locator('#decision-status')).toContainText('案内候補', { timeout: 20_000 });
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await page.locator('#features a').click();
  await expect(page).toHaveURL('/guides/features/');
  await expect(page.getByRole('heading', { name: '機能ガイド', exact: true })).toBeVisible();
});

test('guides are static pages and completion is an explicit outcome', async ({ page }) => {
  for (const slug of ['features', 'pricing', 'cases']) {
    await page.goto(`/guides/${slug}/`);
    await expect(page.locator('h1')).toBeVisible();
    await start(page);
    await page.locator('#complete-guide').click();
    await expect.poll(async () => (await snapshot(page)).outcomes.some((outcome) => outcome.contentId === `demo-${slug}-guide` && outcome.kind === 'completed')).toBe(true);
    await expect(page.locator('#guide-result')).toContainText('記録しました');
  }
});

test('mobile layout has no horizontal overflow and the card cannot cover the primary action', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await start(page);
  await page.locator('#feature-action').evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('#decision-status')).toContainText('案内候補', { timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const card = page.locator('.recommendation');
  if (await card.count()) {
    expect(await card.evaluate((element) => getComputedStyle(element).position)).toBe('static');
  }
  await page.locator('#feature-action').click();
  await expect(page.locator('#feature-result')).toContainText('サンプル契約書');
});

test('B10: 201 DOM targets are bounded and the measured start cost is reported', async ({ page }, testInfo) => {
  await page.goto('/');
  await removeSignals(page);
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 201; index += 1) {
      const target = document.createElement('div');
      target.dataset.imicueSignal = 'demo-pricing';
      target.style.cssText = 'position:fixed;top:0;left:0;width:10px;height:10px;pointer-events:none';
      fragment.append(target);
    }
    document.body.append(fragment);
  });
  await page.locator('#consent').check();
  const startMs = await page.locator('#start').evaluate((button) => {
    const before = performance.now();
    (button as HTMLButtonElement).click();
    return performance.now() - before;
  });
  const scrollMetrics = await page.evaluate(async () => {
    // ResizeObserver delivers its initial notification after layout. Let that
    // initialization refresh finish before attributing scans to scrolling.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
    const original = document.querySelectorAll.bind(document);
    let documentScans = 0;
    Object.defineProperty(document, 'querySelectorAll', { configurable: true, value(selector: string) { documentScans += 1; return original(selector); } });
    const before = performance.now();
    for (let index = 0; index < 20; index += 1) {
      window.scrollTo(0, (index % 2) * 10);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    Reflect.deleteProperty(document, 'querySelectorAll');
    return { elapsedMs: performance.now() - before, documentScans };
  });
  const metrics = { browser: testInfo.project.name, viewport: '1280x800', platform: process.platform, startMs, scrollMetrics };
  console.info('200-element probe:', JSON.stringify(metrics));
  await testInfo.attach('200-elements-start-cost', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(scrollMetrics.documentScans).toBe(0);
  await expect.poll(async () => (await snapshot(page)).coverage.truncated, { timeout: 8_000 }).toBe(true);
  await expect(page.locator('#diagnostics')).not.toHaveText('診断なし');
  await page.locator('#stop').click();
  await expect(page.locator('#status')).toHaveText('許可済み・計測停止中');
});

test('ordinary navigation works with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#pricing a').click();
  await expect(page).toHaveURL('http://127.0.0.1:4173/guides/pricing/');
  await expect(page.getByRole('heading', { name: '料金ガイド', exact: true })).toBeVisible();
  await context.close();
});
