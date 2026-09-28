import { expect, test } from '@playwright/test';

test('browsing examples update records, meaning and Rules results without collection or outbound API', async ({ page }) => {
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('サイト内の閲覧から');
  await expect(page.getByRole('button', { name: '本を探す', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#result h4')).toHaveText('読書メモを検索するガイド');
  for (const [label, topic, expected] of [
    ['本を探す', '本の検索機能', '読書メモを検索するガイド'],
    ['読書記録', '読みかけ', '読みかけの本を整理する方法'],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('#observations')).toContainText(topic);
    await expect(page.locator('#observations')).toContainText('30秒');
    await expect(page.locator('#mapping')).toContainText(expected);
    await expect(page.locator('#result h4')).toHaveText(expected);
  }
  await page.getByRole('button', { name: '両方を見た場合', exact: true }).click();
  await expect(page.locator('#observations')).toContainText('検索');
  await expect(page.locator('#observations')).toContainText('読みかけ');
  await expect(page.locator('#mapping')).toContainText('読書メモを検索するガイド');
  await expect(page.locator('#mapping')).toContainText('読みかけの本を整理する方法');
  await expect(page.locator('#result')).toContainText('見送ります');
  await expect(page.locator('#result')).toContainText('同点');
  await page.locator('#reason summary').click();
  await expect(page.locator('#reason-content')).toContainText('関心や購入の確率ではありません');
  await page.getByRole('button', { name: '記録がない場合', exact: true }).click();
  await expect(page.locator('#result')).toContainText('見送ります');
  await expect(page.locator('#result')).toContainText('記録がない');
  await expect(page.locator('#mapping')).not.toContainText('読みかけの本を整理する方法');
  await page.getByRole('button', { name: '最初の閲覧例に戻す' }).click();
  await expect(page.getByRole('button', { name: '本を探す', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#result h4')).toHaveText('読書メモを検索するガイド');
  await expect(page.locator('#observations')).toContainText('本の検索機能');
  await expect(page.locator('#observations')).not.toContainText('読みかけ');
  await expect(page.locator('#mapping')).toContainText('読書メモを検索するガイド');
  await expect(page.locator('#reason')).not.toHaveAttribute('open');
  expect(errors).toEqual([]);
  await expect(page.locator('html')).not.toHaveAttribute('data-csp-violation');
  expect(requests.every((request) => request === 'GET http://127.0.0.1:4187')).toBe(true);
});

test('rapid selection changes keep the final records, meaning and result together', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '本を探す', exact: true })).toBeEnabled();
  // Dispatch within one browser turn so earlier asynchronous evaluations can finish after a newer selection.
  await page.locator('#scenario-options').evaluate((options) => {
    for (const value of ['cases', 'empty', 'features', 'both', 'cases']) {
      options.querySelector<HTMLButtonElement>(`button[data-scenario="${value}"]`)!.click();
    }
  });
  await expect(page.getByRole('button', { name: '読書記録', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#observations')).toContainText('読みかけ');
  await expect(page.locator('#observations')).not.toContainText('本の検索機能');
  await expect(page.locator('#mapping')).toContainText('読みかけの本を整理する方法');
  await expect(page.locator('#mapping')).not.toContainText('読書メモを検索するガイド');
  await expect(page.locator('#result h4')).toHaveText('読みかけの本を整理する方法');
});

test('keyboard controls, copy success and refusal, and narrow layouts', async ({ page, browserName }) => {
  await page.goto('/');
  // macOS WebKit uses Option+Tab to include links in keyboard navigation.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: '本文へ移動' })).toBeFocused();
  await page.getByRole('button', { name: '本を探す', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result h4')).toHaveText('読書メモを検索するガイド');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: '読書記録', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result h4')).toHaveText('読みかけの本を整理する方法');
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
    await expect(page.getByRole('button', { name: '最初の閲覧例に戻す' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '本を探す', exact: true })).toBeDisabled();
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
  expect(await page.locator('h1').evaluate((element) => getComputedStyle(element).fontFamily)).toBe(await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily));
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
  await expect(page.getByRole('button', { name: '本を探す', exact: true })).toBeEnabled();
});


test('the mock guide opens with useful content, closes by keyboard, and text uses one font family', async ({ page }) => {
  await page.goto('/');
  const family = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  const families = await page.locator('h1,h2,h3,h4,button').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontFamily));
  expect(families.every((value) => value === family)).toBe(true);
  expect(family).not.toMatch(/Mincho|(?:^|,)\s*serif/);
  await page.getByRole('button', { name: 'ガイドの表示例を見る' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#guide-title')).toHaveText('読書メモを検索するガイド');
  await expect(page.locator('#guide-steps li')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'ガイドの表示例を見る' })).toBeFocused();
  await page.getByRole('button', { name: '読書記録', exact: true }).click();
  await expect(page.locator('#mock-page h3')).toContainText('読みかけ');
  await page.getByRole('button', { name: 'ガイドの表示例を見る' }).click();
  await expect(page.locator('#guide-title')).toHaveText('読みかけの本を整理する方法');
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
