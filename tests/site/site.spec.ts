import { expect, test } from '@playwright/test';

test('synthetic Rules decisions, ambiguity, reset, and no collection or outbound API', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${new URL(request.url()).origin}`));
  page.on('pageerror', (error) => errors.push(error.name));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', () => { document.documentElement.dataset.cspViolation = 'true'; });
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear'] as const) {
      Storage.prototype[method] = () => { throw new Error('Playground must not access storage'); };
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('行動の意味から');
  await expect(page.locator('#result')).toContainText('まずは操作を選ぶ');
  for (const [label, expected] of [['機能を使う', '機能ガイド'], ['料金を調べる', '料金ガイド']] as const) {
    await page.getByLabel(label, { exact: true }).check();
    await expect(page.locator('#result h4')).toHaveText(expected);
  }
  await page.getByLabel('どちらも同じくらい見る', { exact: true }).check();
  await expect(page.locator('#result')).toContainText('根拠だけでは絞れません');
  await page.locator('#reason summary').click();
  await expect(page.locator('#reason-content')).toContainText('各2回表示した合成記録');
  await page.getByLabel('まだ操作していない', { exact: true }).check();
  await expect(page.locator('#result')).toContainText('行動の根拠がまだない');
  await page.getByRole('button', { name: '最初の状態に戻す' }).click();
  await expect(page.locator('#result')).toContainText('まずは操作を選ぶ');
  await expect(page.locator('input:checked')).toHaveCount(0);
  await expect(page.locator('#reason')).toBeHidden();
  expect(errors).toEqual([]);
  await expect(page.locator('html')).not.toHaveAttribute('data-csp-violation');
  expect(requests.every((request) => request === 'GET http://127.0.0.1:4187')).toBe(true);
});

test('keyboard controls, copy success and refusal, and narrow layouts', async ({ page, browserName }) => {
  await page.goto('/');
  // macOS WebKit uses Option+Tab to include links in keyboard navigation.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: '本文へ移動' })).toBeFocused();
  await page.getByLabel('機能を使う', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result h4')).toHaveText('機能ガイド');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#result h4')).toHaveText('料金ガイド');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => {
      if (!value.includes('npm ci\nnpm run dev')) throw new Error('invalid_command');
    } } });
  });
  await page.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(page.locator('#copy-status')).toHaveText('コマンドをコピーしました。');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
  });
  await page.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(page.locator('#copy-status')).toContainText('コピーできませんでした');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '最初の状態に戻す' })).toBeVisible();
  }
});

test('static content and documentation remain usable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4187/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('noscript .notice')).toBeVisible();
  await expect(page.locator('noscript .notice')).toContainText('JavaScriptを有効にしてください', { useInnerText: true });
  await expect(page.getByRole('link', { name: '詳しい導入手順' })).toHaveAttribute('href', /^https:\/\/github.com\/blanket11\/imicue/);
  await expect(page.getByLabel('機能を使う', { exact: true })).toBeDisabled();
  await context.close();
});

test('deployment headers block inline scripts and decision requests', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const directives = await page.evaluate(async () => {
    const seen: string[] = [];
    const done = new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CSP did not block both attempts')), 2_000);
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(event.effectiveDirective);
        if (seen.some((item) => item.startsWith('script-src')) && seen.includes('connect-src')) {
          clearTimeout(timeout); resolve(seen);
        }
      });
    });
    const script = document.createElement('script');
    script.textContent = "document.documentElement.dataset.inlineExecuted = 'true'";
    document.body.append(script);
    await fetch('/blocked-decision-request', { method: 'POST', body: '{}' }).catch(() => undefined);
    return done;
  });
  expect(directives).toContain('connect-src');
  await expect(page.locator('html')).not.toHaveAttribute('data-inline-executed');
});

test('missing and private paths return the 404 page with working assets and home link', async ({ page, request }) => {
  const response = await page.goto('/missing/nested/page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  expect(await page.locator('h1').evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Mincho');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
  for (const path of ['/_headers', '/.env.local', '/_worker.js']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  expect((await request.head('/missing/nested/page')).status()).toBe(404);
  expect((await request.post('/')).status()).toBe(405);
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'トップページへ戻る', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4187/');
  await expect(page.getByLabel('機能を使う', { exact: true })).toBeEnabled();
});
