import { test, expect, type Page } from '@playwright/test';

const base = 'http://127.0.0.1:5184';
const endpoint = 'http://127.0.0.1:5193/v1/decide';
async function snapshot(page: Page) { return JSON.parse((await page.locator('#snapshot').textContent())!); }
async function start(page: Page) { await page.locator('#consent').check(); await page.locator('#start').click(); }

test('P01: TOP → features → TOP retains evidence and excludes the viewed guide', async ({ page }) => {
  await page.goto(base);
  await start(page);
  await page.locator('#feature-action').click();
  await expect(page.locator('#decision')).toContainText('demo-features-guide');
  await page.getByRole('link', { name: '機能ガイド', exact: true }).click();
  await page.locator('article').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await snapshot(page)).observations.some(
    (row: { signalId: string; qualifiedViews: number }) => row.signalId === 'demo-features-guide-view' && row.qualifiedViews > 0,
  ), { timeout: 8000 }).toBe(true);
  await page.getByRole('link', { name: '製品の紹介に戻る', exact: true }).click();
  await expect(page.locator('#page-id')).toHaveText('現在のページ：home');
  expect((await snapshot(page)).observations.some(
    (row: { signalId: string; qualifiedViews: number }) => row.signalId === 'demo-features-guide-view' && row.qualifiedViews > 0,
  )).toBe(true);
  await page.locator('#feature-action').click();
  await expect.poll(async () => {
    const value = await page.locator('#decision').textContent();
    if (value === '判定前') return false;
    const decision = JSON.parse(value!);
    return decision.pageViewId === (await snapshot(page)).pageViewId
      && !decision.assessments.some((entry: { contentId: string }) => entry.contentId === 'demo-features-guide');
  }, { timeout: 20000 }).toBe(true);
  await expect(page.locator('#status')).toHaveText('許可済み・計測中');
});

test('P01/P03: static export hydrates, navigates without reload, and keeps one tracker', async ({ page }) => {
  const errors: string[] = []; const posts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto(base);
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  await start(page); await page.locator('#feature-action').click();
  await expect(page.locator('#decision')).toContainText('demo-features-guide', { timeout: 20000 });
  expect((await snapshot(page)).observations.find((row: { signalId: string }) => row.signalId === 'demo-feature-used').actions).toBe(1);
  await page.evaluate(() => Object.assign(window, { navigationMarker: 'same-document' }));
  const before = (await snapshot(page)).pageViewId;
  await page.getByRole('link', { name: '機能ガイド', exact: true }).click();
  await expect(page).toHaveURL(`${base}/guides/features/`);
  await expect(page.locator('#page-id')).toHaveText('現在のページ：features-guide');
  expect((await snapshot(page)).pageViewId).not.toBe(before);
  expect(await page.evaluate(() => (window as unknown as { navigationMarker: string }).navigationMarker)).toBe('same-document');
  await expect(page.locator('#status')).toHaveText('許可済み・計測中');
  await expect(page.locator('#diagnostics')).not.toContainText('duplicate_tracker');
  await page.locator('#complete-guide').click();
  expect((await snapshot(page)).outcomes.some((row: { kind: string }) => row.kind === 'completed')).toBe(true);
  await page.locator('#revoke').click();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.getByRole('link', { name: '製品の紹介に戻る', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('未許可・計測停止中');
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('P01: Next static export connects to a separate mock endpoint and switching modes clears consent', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => { if (request.url() === endpoint && request.method() === 'POST') posts.push(request.url()); });
  await page.goto(base);
  await page.locator('#engine-mode').selectOption('remote');
  await page.locator('#feature-action').click();
  expect(posts).toEqual([]);
  await page.locator('#consent').check();
  await page.evaluate(() => { document.getElementById('start')!.click(); document.getElementById('feature-action')!.click(); });
  await expect(page.locator('#decision')).toContainText('mock-local-v1');
  expect(posts).toHaveLength(1);
  await page.locator('#engine-mode').selectOption('rules');
  await expect(page.locator('#status')).toHaveText('未許可・計測停止中');
  expect((await snapshot(page)).observations).toEqual([]);
  await expect(page.locator('#decision')).toHaveText('判定前');
});

test('P01/B08: navigation invalidates a remote response from the previous page', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  let arrive!: () => void; const received = new Promise<void>((resolve) => { arrive = resolve; });
  await page.route(endpoint, async (route) => {
    const response = await route.fetch(); arrive(); await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.goto(base); await page.locator('#engine-mode').selectOption('remote');
  await page.locator('#consent').check();
  await page.evaluate(() => { document.getElementById('start')!.click(); document.getElementById('feature-action')!.click(); });
  await received;
  await page.getByRole('link', { name: '機能ガイド', exact: true }).click();
  await expect(page.locator('#page-id')).toHaveText('現在のページ：features-guide');
  release();
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await expect(page.locator('#diagnostics')).toContainText('stale_decision');
  const result = await page.locator('#decision').textContent();
  expect(result === '判定前' || !JSON.parse(result!).assessments.some((entry: { contentId: string }) => entry.contentId === 'demo-features-guide')).toBe(true);
});

test('P01: exported guide links work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage(); await page.goto(base);
    await page.getByRole('link', { name: '料金ガイド', exact: true }).click();
    await expect(page.getByRole('heading', { name: '料金ガイド', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
