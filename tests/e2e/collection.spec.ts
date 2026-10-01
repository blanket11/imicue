import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../../packages/core/src/types.js';

const key = 'imicue:reading-notes:demo-1';
const endpoint = 'http://127.0.0.1:5193/v1/decide';
async function snapshot(page: Page): Promise<Snapshot> {
  return JSON.parse((await page.locator('#snapshot').textContent())!);
}
async function actions(page: Page) {
  return (await snapshot(page)).observations.find((item) => item.signalId === 'demo-feature-used')?.actions ?? 0;
}

test('manual starts without consent, stops, resets and destroys through public controls', async ({ page }) => {
  await page.goto('/collection/?mode=manual&storage=session');
  await expect(page.locator('#status')).toHaveText('手動開始・計測停止中');
  await page.locator('#feature-action').click();
  expect(await actions(page)).toBe(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  await page.locator('#start').click(); await page.locator('#feature-action').click();
  await expect.poll(() => actions(page)).toBe(1);
  await expect(page.locator('#recommendation-slot a')).toHaveText('検索ガイドを見る');
  await page.locator('#stop').click(); await page.locator('#feature-action').click();
  expect(await actions(page)).toBe(1);
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await page.locator('#start').click(); await page.locator('#reset').click();
  await expect(page.locator('#status')).toHaveText('手動開始・計測中');
  expect(await actions(page)).toBe(0);
  await page.locator('#destroy').click(); await page.locator('#feature-action').click();
  await expect(page.locator('#status')).toHaveText('破棄済み');
  expect(await actions(page)).toBe(0);
});

test('auto records on page load and restores across pages, stop plus reset removes the session', async ({ page }) => {
  await page.goto('/collection/?mode=auto&storage=session');
  await expect(page.locator('#status')).toHaveText('自動開始・計測中');
  await page.locator('#feature-action').click();
  await expect.poll(() => actions(page)).toBe(1);
  await page.locator('#page-link').click();
  await expect(page.locator('#page-title')).toHaveText('読書メモの検索ガイド');
  expect(await actions(page)).toBe(1);
  await page.locator('#page-link').click();
  await expect(page.locator('#page-title')).toHaveText('開始するタイミングを選ぶ');
  expect(await actions(page)).toBe(1);
  await page.locator('#clear-stop').click();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  await page.reload();
  await expect(page.locator('#status')).toHaveText('自動開始・計測中');
  expect(await actions(page)).toBe(0);
});

test('disabled never restores or contacts the remote endpoint and can erase earlier storage', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto('/collection/?mode=auto&storage=session');
  await page.locator('#feature-action').click();
  const stored = await page.evaluate((key) => sessionStorage.getItem(key), key);
  expect(stored).not.toBeNull();
  await page.goto('/collection/?mode=disabled&storage=session&engine=remote');
  await expect(page.locator('#status')).toHaveText('計測しない・計測停止中');
  await expect(page.locator('#start')).toBeDisabled();
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).not.toBeNull();
  expect(posts).toEqual([]);
  await page.locator('#reset').click();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
});

test('auto uses the existing mock remote protocol and stop invalidates a held response', async ({ page }, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let delivered!: () => void;
  const responseDelivered = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    arrived(); await held;
    await route.fulfill({ response }).catch(() => undefined);
    delivered();
  });
  await page.goto('/collection/?mode=auto&engine=remote');
  await page.locator('#feature-action').click(); await ready;
  await page.locator('#clear-stop').click(); release();
  await responseDelivered;
  await expect(page.locator('#diagnostics')).toContainText('stale_decision');
  const capture = testInfo.outputPath('completed-delayed-response.png');
  await page.screenshot({ path: capture });
  await testInfo.attach('completed-delayed-response', { path: capture, contentType: 'image/png' });
  await expect(page.locator('#status')).toHaveText('自動開始・計測停止中');
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  expect((await snapshot(page)).observations).toEqual([]);
  await expect(page.locator('#decision')).toHaveText('判定前');
});

test('explicit manual receives the mock result after start', async ({ page }) => {
  await page.goto('/collection/?mode=manual&engine=remote');
  await page.locator('#start').click(); await page.locator('#feature-action').click();
  await expect(page.locator('#decision')).toContainText('mock-local-v1');
  await expect(page.locator('#recommendation-slot a')).toHaveText('検索ガイドを見る');
});
