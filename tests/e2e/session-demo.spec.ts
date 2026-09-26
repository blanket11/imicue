import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../packages/core/src/types.js';

async function snapshot(page: Page): Promise<Snapshot> {
  return JSON.parse((await page.locator('#snapshot').textContent())!);
}
async function begin(page: Page) {
  await page.locator('#consent').check(); await page.locator('#start').click();
}
const storageKey = 'imicue:demo-contract:demo-1';

test('session demo: TOP → guide → TOP preserves records after renewed consent, withdrawal removes them', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto('/');
  await page.locator('#storage-mode-link').click();
  await expect(page).toHaveURL('/?storage=session');
  await expect(page.locator('#storage-description')).toContainText('直近30分');
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  await begin(page); await page.locator('#feature-action').click();
  await page.getByRole('link', { name: '機能ガイド', exact: true }).click();
  await expect(page).toHaveURL('/guides/features/?storage=session');
  await expect(page.locator('#consent')).not.toBeChecked();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.locator('#consent').check();
  expect((await snapshot(page)).observations).toEqual([]);
  await page.locator('#start').click();
  expect((await snapshot(page)).observations.some((row) => row.signalId === 'demo-feature-used' && row.actions === 1)).toBe(true);
  await page.locator('#complete-guide').click();
  await page.getByRole('link', { name: 'デモのトップへ戻る', exact: true }).click();
  await expect(page).toHaveURL('/?storage=session');
  expect((await snapshot(page)).observations).toEqual([]);
  await begin(page);
  expect((await snapshot(page)).outcomes.some((row) => row.kind === 'completed' && row.contentId === 'demo-features-guide')).toBe(true);
  await expect(page.locator('#session-summary')).toContainText('検索例の操作');
  await expect.poll(async () => {
    const text = await page.locator('#decision').textContent();
    if (text === '判定前') return false;
    return !JSON.parse(text!).assessments.some((row: { contentId: string }) => row.contentId === 'demo-features-guide');
  }).toBe(true);
  await page.locator('#revoke').click();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  await page.reload(); await begin(page);
  expect((await snapshot(page)).outcomes).toEqual([]);
  expect((await snapshot(page)).observations.some((row) => row.signalId === 'demo-feature-used')).toBe(false);
  expect(posts).toEqual([]);
});

test('session demo: browser Back restores the latest archive without restoring consent', async ({ page }) => {
  await page.goto('/?storage=session'); await begin(page);
  await page.locator('#feature-action').click();
  await page.getByRole('link', { name: '機能ガイド', exact: true }).click();
  await begin(page); await page.locator('#complete-guide').click();
  await page.goBack();
  await expect(page).toHaveURL('/?storage=session');
  await expect(page.locator('#consent')).not.toBeChecked();
  await expect(page.locator('#status')).toHaveText('未許可・計測停止中');
  await begin(page);
  expect((await snapshot(page)).outcomes.some((row) => row.kind === 'completed')).toBe(true);
  await page.locator('#stop').click();
  await page.locator('#reset').click();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  await page.reload(); await begin(page);
  expect((await snapshot(page)).outcomes).toEqual([]);
});

test('session demo: recommendation and ordinary links preserve remote and storage modes', async ({ page }) => {
  await page.goto('/?engine=remote&storage=session');
  await begin(page);
  await page.locator('#feature-action').click();
  await page.locator('#recommendation-slot').scrollIntoViewIfNeeded();
  await expect(page.locator('#decision')).toContainText('mock-local-v1');
  const link = page.locator('.recommendation a');
  await expect(link).toHaveAttribute('href', /\/guides\/features\/\?engine=remote&storage=session#imicue-recommendation/, { timeout: 20000 });
  await link.click();
  await expect(page).toHaveURL('/guides/features/?engine=remote&storage=session#imicue-recommendation');
  await expect(page.locator('#consent')).not.toBeChecked();
  await expect(page.getByRole('link', { name: 'デモのトップへ戻る', exact: true })).toHaveAttribute('href', /\/\?engine=remote&storage=session$/);
  await page.locator('#storage-mode-link').click();
  await expect(page).toHaveURL('/guides/features/?engine=remote#imicue-recommendation');
  await expect(page.locator('#storage-description')).toContainText('メモリ');
});

test('session demo: unavailable storage reports the limitation and still records in memory', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Unavailable', 'SecurityError'); } });
  });
  await page.goto('/?storage=session'); await begin(page);
  await expect(page.locator('#storage-warning')).toContainText('このページ内だけ');
  await page.locator('#feature-action').click();
  expect((await snapshot(page)).observations.some((row) => row.signalId === 'demo-feature-used')).toBe(true);
});
