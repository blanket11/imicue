import { test, expect, type Page } from '@playwright/test';
import type { Decision, Snapshot } from '@imicue/core';

const base = 'http://127.0.0.1:5184';
const endpoint = 'http://127.0.0.1:5193/v1/decide';
async function snapshot(page: Page): Promise<Snapshot> {
  // Reload can finish before React restores the tracker and publishes its first snapshot.
  await expect(page.locator('#snapshot')).toContainText('"schemaVersion": "0.1"');
  return JSON.parse((await page.locator('#snapshot').textContent())!);
}
async function tick(page: Page, seconds: number) {
  for (let i = 0; i < seconds; i++) { await page.clock.runFor(1000); await page.waitForTimeout(100); }
}
async function view(page: Page, signal: string, seconds: number) {
  await page.locator(`[data-imicue-signal="${signal}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(100); await tick(page, seconds);
}
async function recommend(page: Page, first = 'feature-board', second = 'feature-timeline') {
  await view(page, first, 5);
  await view(page, second, 1);
  for (let i = 0; i < 40 && !await page.locator('.recommendation').isVisible(); i++) await tick(page, 1);
}
async function reset(page: Page) {
  await page.locator('#debug-toggle').click(); await page.locator('#reset').click();
  await page.getByRole('button', { name: 'Debugを閉じる' }).click();
}

for (const scenario of [
  { first: 'feature-board', second: 'feature-timeline', id: 'product-features' },
  { first: 'case-creative', second: 'case-operations', id: 'product-cases' },
  { first: 'security', second: 'pricing', id: 'product-documents' },
  { first: 'faq-migration', second: 'rollout', id: 'product-contact' },
]) {
  test(`P01/product: ${scenario.id} appears automatically from views alone`, async ({ page }) => {
    const posts: string[] = []; const errors: string[] = [];
    page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install(); await page.goto(base);
    await expect(page.locator('#status')).toHaveText('計測中');
    await expect(page.locator('#debug-panel')).toBeHidden();
    await expect(page.locator('.recommendation')).toHaveCount(0);
    await recommend(page, scenario.first, scenario.second);
    await expect(page.locator('.recommendation')).toHaveAttribute('data-content-id', scenario.id);
    const value = await snapshot(page);
    expect(value.observations.filter((row) => row.qualifiedViews > 0).length).toBeGreaterThanOrEqual(2);
    expect(value.observations.every((row) => row.clicks === 0 && row.actions === 0)).toBe(true);
    expect(value.outcomes.filter((row) => row.contentId === scenario.id && row.kind === 'shown')).toHaveLength(1);
    await tick(page, 2);
    expect((await snapshot(page)).outcomes.filter((row) => row.kind === 'shown')).toHaveLength(1);
    await page.getByRole('button', { name: '案内を閉じる' }).click();
    await expect(page.locator('.recommendation')).toHaveCount(0);
    expect((await snapshot(page)).outcomes.some((row) => row.contentId === scenario.id && row.kind === 'dismissed')).toBe(true);
    await tick(page, 65); await page.reload();
    expect((await snapshot(page)).outcomes.some((row) => row.contentId === scenario.id && row.kind === 'dismissed')).toBe(true);
    expect(posts).toEqual([]); expect(errors).toEqual([]);
  });
}

test('P01/product: recommendation links retain one tracker, attribution and viewed exclusion across navigation and reload', async ({ page }) => {
  await page.clock.install(); await page.goto(base); await recommend(page);
  const before = await snapshot(page);
  await page.evaluate(() => Object.assign(window, { navigationMarker: 'same-document' }));
  await page.locator('.recommendation a').click();
  await expect(page).toHaveURL(`${base}/features/#imicue-recommendation`);
  await expect(page.locator('#page-id')).toHaveText('Page: features');
  expect((await snapshot(page)).pageViewId).not.toBe(before.pageViewId);
  expect(await page.evaluate(() => (window as unknown as { navigationMarker: string }).navigationMarker)).toBe('same-document');
  expect((await snapshot(page)).outcomes.some((row) => row.kind === 'clicked')).toBe(true);
  await view(page, 'features-detail', 4);
  expect((await snapshot(page)).observations.some((row) => row.signalId === 'features-detail' && row.source === 'recommendation' && row.qualifiedViews > 0)).toBe(true);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('計測中');
  await page.getByRole('link', { name: 'PACELET トップ', exact: true }).first().click();
  await expect(page.locator('#page-id')).toHaveText('Page: home');
  await view(page, 'feature-board', 20);
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await expect(page.locator('#diagnostics')).not.toContainText('duplicate_tracker');
  const value = await snapshot(page);
  expect(value.observations.some((row) => row.signalId === 'features-detail' && row.qualifiedViews > 0)).toBe(true);
  await page.locator('#debug-toggle').click(); await page.locator('#clear-stop').click();
  await expect(page.locator('#status')).toHaveText('計測停止中');
  expect((await snapshot(page)).observations).toEqual([]);
  await page.getByRole('button', { name: 'Debugを閉じる' }).click();
  await page.getByRole('link', { name: '機能', exact: true }).first().click();
  await expect(page.locator('#status')).toHaveText('計測停止中');
  await view(page, 'features-detail', 5);
  expect((await snapshot(page)).observations).toEqual([]);
});

test('P01/product: weak and competing evidence abstains, expiry and reset remove an offer', async ({ page }) => {
  await page.clock.install(); await page.goto(base);
  await view(page, 'overview', 20);
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await reset(page);
  // Both topics are visible, with no click or action: a close score must not produce a card.
  await view(page, 'feature-timeline', 2); await view(page, 'security', 2);
  await tick(page, 10);
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await reset(page); await recommend(page);
  await expect(page.locator('.recommendation')).toBeVisible();
  await tick(page, 31);
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await reset(page);
  expect((await snapshot(page)).outcomes).toEqual([]);
  await expect(page.locator('.recommendation')).toHaveCount(0);
});

for (const kind of ['resources', 'contact']) {
  test(`P01/product: ${kind} form completes locally, excludes the candidate and stores no input`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { if (request.method() === 'POST' || request.url().includes('synthetic-form')) requests.push(request.url()); });
    await page.clock.install(); await page.goto(`${base}/${kind}/`);
    await page.getByLabel('お名前').fill('synthetic-form-name');
    await page.getByLabel('メールアドレス').fill('synthetic-form@example.test');
    if (kind === 'contact') await page.getByLabel('相談内容').fill('synthetic-form-message');
    await tick(page, 20);
    await expect(page.locator('.recommendation')).toHaveCount(0);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.completion')).toBeFocused();
    await expect(page.locator('.completion')).toContainText('入力内容は送信・保存していません');
    expect((await snapshot(page)).outcomes.some((row) => row.kind === 'completed' && row.contentId === (kind === 'resources' ? 'product-documents' : 'product-contact'))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('synthetic-form');
    await page.getByRole('link', { name: '製品紹介に戻る' }).click();
    expect((await snapshot(page)).outcomes.some((row) => row.kind === 'completed')).toBe(true);
    await page.reload();
    expect((await snapshot(page)).outcomes.some((row) => row.kind === 'completed')).toBe(true);
    expect(requests).toEqual([]);
  });
}

test('P01/product: remote mock works and switching engines clears records', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.clock.install(); await page.goto(base);
  await page.locator('#debug-toggle').click(); await page.locator('#engine-mode').selectOption('remote');
  await page.getByRole('button', { name: 'Debugを閉じる' }).click();
  await view(page, 'feature-board', 5);
  await view(page, 'feature-timeline', 35);
  const browsing = await snapshot(page);
  expect(browsing.observations.filter((row) => row.qualifiedViews > 0).length).toBeGreaterThanOrEqual(2);
  expect(browsing.observations.every((row) => row.clicks === 0 && row.actions === 0)).toBe(true);
  // This case verifies transport and engine switching. Freeze the observed input
  // after real views: advancing the clock across a visibility pulse while HTTP
  // is pending would correctly discard the response as an older revision.
  await page.evaluate(() => {
    for (const target of document.querySelectorAll('[data-imicue-signal]')) target.removeAttribute('data-imicue-signal');
  });
  await page.waitForTimeout(100);
  const stable = await snapshot(page);
  const latestResponse = page.waitForResponse((response) => response.url() === endpoint
    && response.request().method() === 'POST'
    && response.request().postDataJSON().revision === stable.revision);
  void latestResponse.catch(() => undefined);
  release();
  for (let second = 0; second < 20 && !await page.locator('.recommendation').isVisible(); second++) await tick(page, 1);
  const response = await latestResponse;
  expect(response.status()).toBe(200);
  const remoteDecision = await response.json() as Decision;
  expect(remoteDecision).toMatchObject({ type: 'recommend', contentId: 'product-features', engine: { model: 'mock-local-v1' } });
  await expect(page.locator('#decision')).toContainText('mock-local-v1');
  expect(JSON.parse((await page.locator('#decision').textContent())!).snapshotId).toBe(remoteDecision.snapshotId);
  await expect(page.locator('.recommendation')).toHaveAttribute('data-content-id', 'product-features');
  expect((await snapshot(page)).outcomes.some((row) => row.kind === 'shown' && row.contentId === 'product-features')).toBe(true);
  await page.locator('#debug-toggle').click(); await page.locator('#engine-mode').selectOption('rules');
  await expect.poll(async () => (await snapshot(page)).outcomes).toEqual([]);
  await expect.poll(async () => (await snapshot(page)).observations).toEqual([]);
  await expect.poll(async () => {
    const text = await page.locator('#decision').textContent();
    return text?.startsWith('{') ? JSON.parse(text) as Decision : null;
  }).toMatchObject({ type: 'abstain', reason: 'insufficient_evidence', engine: { name: 'rules' } });
  expect((JSON.parse((await page.locator('#decision').textContent())!) as Decision).decisionId).not.toBe(remoteDecision.decisionId);
  await expect(page.locator('#status')).toHaveText('計測中');
  await expect(page.locator('.recommendation')).toHaveCount(0);
});

test('P01/B08: navigation invalidates a pending remote response', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  let arrived = false;
  await page.route(endpoint, async (route) => {
    const response = await route.fetch(); arrived = true; await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.clock.install(); await page.goto(base);
  await page.locator('#debug-toggle').click(); await page.locator('#engine-mode').selectOption('remote');
  await page.getByRole('button', { name: 'Debugを閉じる' }).click();
  await view(page, 'feature-board', 4);
  await view(page, 'feature-timeline', 1);
  for (let i = 0; i < 20 && !arrived; i++) await tick(page, 1);
  await expect.poll(() => arrived).toBe(true);
  await page.getByRole('link', { name: '機能', exact: true }).first().click();
  await expect(page.locator('#page-id')).toHaveText('Page: features');
  release(); await tick(page, 1);
  await expect(page.locator('.recommendation')).toHaveCount(0);
  await expect(page.locator('#diagnostics')).toContainText('stale_decision');
});

test('P01/product: mobile keyboard, reduced motion and protected actions', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install(); await page.goto(base);
  await page.locator('#debug-toggle').press('Enter');
  await expect(page.locator('#debug-panel')).toBeVisible();
  await page.locator('#reset').press('Escape');
  await expect(page.locator('#debug-toggle')).toBeFocused();
  await expect(page.locator('#debug-panel')).toBeHidden();
  await recommend(page);
  await expect(page.locator('.recommendation')).toBeVisible();
  const card = await page.locator('.recommendation').boundingBox();
  const debug = await page.locator('#debug-toggle').boundingBox();
  expect(card!.y + card!.height).toBeLessThan(debug!.y);
  await page.getByRole('button', { name: '案内を閉じる' }).press('Escape');
  await expect(page.locator('#main')).toBeFocused();
  for (const route of ['/', '/features/', '/cases/', '/resources/', '/contact/']) {
    await page.goto(`${base}${route}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('.form-panel')).toBeVisible();
  await expect(page.locator('.recommendation')).toHaveCount(0);
});

test('P01: static navigation works without JavaScript; forms cannot submit', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); await page.goto(base);
    await page.getByRole('link', { name: '機能', exact: true }).first().click();
    await expect(page.locator('h1')).toHaveText('次に進めることが、見える。');
    await page.getByRole('link', { name: 'お問い合わせ', exact: true }).first().click();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.getByText('完了表示を試すにはJavaScriptを有効にしてください。フォームは送信できません。')).toBeVisible();
  } finally { await context.close(); }
});
