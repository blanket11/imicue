import { expect, test, type Page } from '@playwright/test';

const endpoint = 'http://127.0.0.1:5193/v1/decide';
async function begin(page: Page) {
  await page.locator('#consent').check();
  await page.evaluate(() => {
    // Isolate transport from view-duration changes while the response is pending.
    for (const target of document.querySelectorAll('[data-imicue-signal]')) target.removeAttribute('data-imicue-signal');
    document.getElementById('start')!.click();
    document.getElementById('feature-action')!.click();
  });
}

test('M3: static demo uses the local mock endpoint only after consent and start', async ({ page }) => {
  const posts: string[] = [];
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url() === endpoint && request.method() === 'POST') posts.push(request.postData() ?? '');
    if (!['http://127.0.0.1:4173', 'http://127.0.0.1:5193'].includes(new URL(request.url()).origin)) external.push(request.url());
  });
  await page.goto('/?engine=remote');
  await expect(page.locator('#mode-description')).toContainText('モック');
  await page.locator('#feature-action').click();
  await page.locator('#consent').check();
  await page.locator('#feature-action').click();
  expect(posts).toEqual([]);
  await begin(page);
  await expect(page.locator('#decision')).toContainText('mock-local-v1');
  await expect(page.locator('#scores')).toContainText('rubric（モック）');
  expect(posts).toHaveLength(1);
  const payload = JSON.parse(posts[0]!);
  expect(Object.keys(payload)).not.toContain('dictionary');
  expect(payload.observations.some((row: { signalId: string }) => row.signalId === 'demo-feature-used')).toBe(true);
  expect(external).toEqual([]);
});

test('B08: consent withdrawal discards a delayed remote response and clears data', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response }).catch(() => undefined); // The browser may have already aborted.
  });
  await page.goto('/?engine=remote');
  await begin(page);
  await ready;
  await page.locator('#revoke').click();
  release();
  await expect(page.locator('#status')).toHaveText('未許可・計測停止中');
  await expect(page.locator('#decision')).toHaveText('判定前');
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  expect(JSON.parse((await page.locator('#snapshot').textContent())!).observations).toEqual([]);
  await page.locator('#feature-action').click();
  await expect(page.locator('#decision')).toHaveText('判定前');
});

test('M3: unavailable endpoint abstains without switching to local rules', async ({ page }) => {
  await page.route(endpoint, (route) => route.abort('failed'));
  await page.goto('/?engine=remote');
  await begin(page);
  await expect(page.locator('#decision')).toContainText('engine_unavailable');
  await expect(page.locator('#recommendation-slot')).toBeEmpty();
  await expect(page.locator('#decision-status')).toContainText('通常のガイドは利用できます');
  await page.getByRole('link', { name: '機能ガイド', exact: true }).first().click();
  await expect(page).toHaveURL(/\/guides\/features\/\?engine=remote/);
});
