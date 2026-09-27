import { test, expect } from '@playwright/test';

for (const scenario of [
  { topic: 'features', contentId: 'catalog-099', title: '契約書の全文検索ガイド', remote: false },
  { topic: 'cases', contentId: 'catalog-098', title: '営業チームの契約更新事例', remote: false },
  { topic: 'features', contentId: 'catalog-099', title: '契約書の全文検索ガイド', remote: true },
  { topic: 'features', contentId: 'catalog-099', title: '契約書の全文検索ガイド', remote: false, mobile: true },
]) {
  test(`100 candidates: ${scenario.topic}, ${scenario.remote ? 'remote mock' : 'Rules'}, ${scenario.mobile ? 'mobile' : 'desktop'}, browsing without actions`, async ({ page }) => {
    if (scenario.mobile) await page.setViewportSize({ width: 375, height: 812 });
    await page.clock.install();
    await page.goto(`/catalog/?topic=${scenario.topic}${scenario.remote ? '&engine=remote' : ''}`);
    await expect(page.locator('#catalog-list li')).toHaveCount(100);
    await page.locator('#catalog-consent').check();
    await page.locator('#catalog-start').click();
    await page.locator('#catalog-overview').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await page.clock.runFor(6_000);
    await expect(page.locator('#catalog-observation-count')).toContainText('有効な閲覧 1回');
    await expect(page.locator('#catalog-recommendation')).toBeEmpty();
    await page.locator('#catalog-detail').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    // Let real HTTP/IntersectionObserver callbacks settle between clock ticks.
    for (let second = 0; second < 35; second++) {
      await page.clock.runFor(1_000);
      await page.waitForTimeout(30);
    }
    await expect(page.locator('#catalog-decision-status')).toContainText(`100件を評価した案内候補：${scenario.title}`);
    const decision = JSON.parse((await page.locator('#catalog-decision').textContent())!);
    expect(decision.contentId).toBe(scenario.contentId);
    expect(decision.assessments).toHaveLength(100);
    const snapshot = JSON.parse((await page.locator('#catalog-snapshot').textContent())!);
    expect(snapshot.observations.length).toBe(2);
    expect(snapshot.observations.every((item: { clicks: number; actions: number }) => item.clicks === 0 && item.actions === 0)).toBe(true);
    if (scenario.mobile) {
      await page.locator('#catalog-decision-status').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      // Scrolling changes the snapshot: only a new valid decision may be shown.
      await page.clock.runFor(16_000);
    }
    // Showing an inline card must not generate direct evidence.
    await expect(page.locator('#catalog-recommendation a')).toHaveAttribute('href', `/catalog/guide.html?content=${scenario.contentId}`);
    await page.locator('#catalog-revoke').click();
    await expect(page.locator('#catalog-recommendation')).toBeEmpty();
    await expect(page.locator('#catalog-observation-count')).toContainText('有効な閲覧 0回');
    await page.goto(`/catalog/guide.html?content=${scenario.contentId}`);
    await expect(page.locator('h1')).toHaveText(scenario.title);
  });
}

test('100-candidate catalog stays usable at a mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/catalog/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('100件の登録内容を見る', { exact: true }).click();
  await expect(page.locator('#catalog-list a')).toHaveCount(100);
  await page.locator('#catalog-list a').last().click();
  await expect(page.locator('h1')).toHaveText('契約書の全文検索ガイド');
});
