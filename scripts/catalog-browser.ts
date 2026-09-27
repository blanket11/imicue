import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { createDecisionHandler, createJevEngine, createMemoryProviderLimiter, createNodeServer, JEV_MODEL } from '@imicue/server';
import { catalogDefinition } from '../examples/vanilla/catalog/definition.js';
import { CatalogBudget, catalogMeasuredTransport, type CatalogRequestMetric } from './lib/catalog-budget.js';
import { createCatalogBrowserAttemptCap, inspectCatalogBrowserDecision, CATALOG_BROWSER_MAX_ATTEMPTS,
  type CatalogBrowserName, type CatalogBrowserTopic } from './lib/catalog-browser.js';

const origin = 'http://127.0.0.1:5183';
const endpoint = 'http://127.0.0.1:5193/v1/decide';
const scenarios = [
  { browser: 'chromium', topic: 'features', launcher: chromium },
  { browser: 'firefox', topic: 'cases', launcher: firefox },
  { browser: 'webkit', topic: 'features', launcher: webkit },
] as const;
interface Result {
  browser: CatalogBrowserName;
  topic: CatalogBrowserTopic;
  stage: string;
  status: 'passed' | 'failed';
  httpPosts: number;
  preConsentPosts: number;
  preStartPosts: number;
  httpStatus: number | null;
  snapshotBytes: number | null;
  decisionBytes: number | null;
  httpHeadersMs: number | null;
  httpResponseMs: number | null;
  browserAcceptedMs: number | null;
  unexpectedTraffic: boolean;
  browserCredential: boolean;
  browserServerSdk: boolean;
  pageErrors: number;
  accepted: boolean;
  cardShown: boolean;
  withdrawn: boolean;
  staleDiagnostic: boolean;
  decision: ReturnType<typeof inspectCatalogBrowserDecision> | null;
  requests: readonly CatalogRequestMetric[];
}

async function main() {
  const key = process.env.TYPESAFE_API_KEY;
  if (process.env.RUN_CATALOG_BROWSER !== '1' || !key?.trim()) {
    console.log('SKIP: RUN_CATALOG_BROWSER=1とTYPESAFE_API_KEYが必要です。');
    return;
  }
  if (process.argv.slice(2).length) throw new Error('catalog_browser_unexpected_argument');
  const budget = new CatalogBudget('test-results/catalog-budget.json');
  if (600 - (await budget.inspect()).attempts.length < CATALOG_BROWSER_MAX_ATTEMPTS) throw new Error('catalog_browser_insufficient_attempt_budget');
  const cap = createCatalogBrowserAttemptCap();
  const providerLimiter = createMemoryProviderLimiter();
  let active: { handler: ReturnType<typeof createDecisionHandler>; posts: number } | undefined;
  const server = createNodeServer(async (request) => {
    if (!active) return Response.json({ error: { code: 'engine_unavailable' } }, { status: 503 });
    // One browser decision only. Further automatic evaluations never reach an engine or paid transport.
    if (request.method === 'POST' && ++active.posts > 1) return Response.json({ error: { code: 'rate_limited' } }, {
      status: 429, headers: { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store', 'Retry-After': '3600' },
    });
    return active.handler(request);
  });
  const results: Result[] = [];
  let stage = 'listen';
  let listening = false;
  await mkdir('test-results', { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `test-results/catalog-browser-${runId}.json`;
  const save = async () => {
    const requested = results.filter(row => row.httpPosts > 0);
    const recommendations = results.filter(row => row.decision?.type === 'recommend');
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, model: JEV_MODEL, sdk: '0.6.0', stage,
      definitionVersion: catalogDefinition.definitionVersion, catalogSize: 100, realTimeBrowsing: true,
      timingMeaning: {
        clock: 'Node performance.now; elapsed from the Playwright event for the first decision POST.',
        httpHeadersMs: 'Until Playwright reports the HTTP response headers.',
        httpResponseMs: 'Until the harness has received the complete decision response body.',
        browserAcceptedMs: 'Until the harness observes the same snapshotId in the browser decision DOM. Includes Playwright IPC and polling delay; not an exact application callback timestamp.',
        byteCounts: 'Actual UTF-8 snapshot POST body and decision response body bytes; excludes HTTP headers. Raw bodies are not retained.',
      },
      maxProviderAttempts: CATALOG_BROWSER_MAX_ATTEMPTS, maxAttemptsPerBrowser: 8, maxDecisionsPerBrowser: 1,
      requests: cap.count(), results, summary: {
        attemptedBrowsers: results.length, passedBrowsers: results.filter(row => row.status === 'passed').length,
        accepted: { numerator: requested.filter(row => row.accepted).length, denominator: requested.length },
        cardShown: { numerator: recommendations.filter(row => row.cardShown).length, denominator: recommendations.length },
        semanticMatch: { numerator: results.filter(row => row.decision?.semanticMatch).length, denominator: requested.length },
      }, caveat: 'Three synthetic browser checks are not a production completion-rate or semantic-quality estimate.' }, null, 2)}\n`, { mode: 0o600 });
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5193, '127.0.0.1', resolve); });
    listening = true;
    for (const scenario of scenarios) {
      const measured = catalogMeasuredTransport(globalThis.fetch, budget, `browser-${scenario.browser}-${scenario.topic}`);
      const engine = createJevEngine({ model: JEV_MODEL, apiKey: key, fetch: cap.wrap(scenario.browser, measured.fetch), providerLimiter });
      active = { handler: createDecisionHandler({ definitions: [catalogDefinition], engine, mode: 'development', origins: [origin] }), posts: 0 };
      const row: Result = { browser: scenario.browser, topic: scenario.topic, stage: 'launch', status: 'failed', httpPosts: 0,
        preConsentPosts: 0, preStartPosts: 0, httpStatus: null, unexpectedTraffic: false, browserCredential: false,
        snapshotBytes: null, decisionBytes: null, httpHeadersMs: null, httpResponseMs: null, browserAcceptedMs: null,
        browserServerSdk: false, pageErrors: 0, accepted: false, cardShown: false, withdrawn: false, staleDiagnostic: false,
        decision: null, requests: measured.requests };
      results.push(row);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        stage = `${scenario.browser}:launch`;
        browser = await scenario.launcher.launch();
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        let sentSnapshot: unknown;
        let sentAt: number | undefined;
        const elapsed = () => sentAt === undefined ? null : Math.round((performance.now() - sentAt) * 100) / 100;
        page.on('pageerror', () => { row.pageErrors++; });
        page.on('request', (request) => {
          const url = request.url();
          if (![origin, 'http://127.0.0.1:5193'].includes(new URL(url).origin)) row.unexpectedTraffic = true;
          if (/typesafe|packages\/server/i.test(decodeURIComponent(url))) row.browserServerSdk = true;
          const headers = request.headers();
          if (headers.authorization || Object.values(headers).some(value => value.includes(key)) || url.includes(key)
            || request.postData()?.includes(key)) row.browserCredential = true;
          if (request.method() === 'POST') {
            row.httpPosts++;
            if (url === endpoint && sentSnapshot === undefined) {
              sentAt ??= performance.now();
              row.snapshotBytes = request.postDataBuffer()?.byteLength ?? null;
              try { sentSnapshot = request.postDataJSON(); } catch { /* Report invalid result without retaining request text. */ }
            }
          }
        });
        row.stage = 'before-consent';
        await page.goto(`${origin}/catalog/?engine=remote&topic=${scenario.topic}`);
        await expect(page.locator('#catalog-list li')).toHaveCount(100);
        await page.locator('#catalog-overview').scrollIntoViewIfNeeded();
        await page.waitForTimeout(2200);
        row.preConsentPosts = row.httpPosts;
        await page.locator('#catalog-consent').check();
        await page.locator('#catalog-overview').scrollIntoViewIfNeeded();
        await page.waitForTimeout(2200);
        row.preStartPosts = row.httpPosts;
        if (row.preConsentPosts || row.preStartPosts) throw new Error('catalog_browser_early_request');
        row.stage = 'browsing';
        const responsePromise = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST', { timeout: 25_000 })
          .then(response => { row.httpHeadersMs = elapsed(); return response; });
        // Avoid an unhandled rejection if an earlier UI step fails.
        void responsePromise.catch(() => undefined);
        await page.locator('#catalog-start').click();
        await page.locator('#catalog-overview').scrollIntoViewIfNeeded();
        await page.waitForTimeout(3100);
        await page.locator('#catalog-detail').scrollIntoViewIfNeeded();
        await page.waitForTimeout(3100);
        await page.locator('main > section[data-imicue-ignore]').scrollIntoViewIfNeeded();
        row.stage = 'response';
        const response = await responsePromise;
        row.httpStatus = response.status();
        const responseBytes = await response.body();
        row.decisionBytes = responseBytes.byteLength;
        row.httpResponseMs = elapsed();
        const raw: unknown = JSON.parse(responseBytes.toString('utf8'));
        row.decision = inspectCatalogBrowserDecision(raw, sentSnapshot, scenario.topic);
        if (row.decision.valid) {
          try {
            await expect.poll(async () => {
              try {
                const displayed = JSON.parse((await page.locator('#catalog-decision').textContent()) ?? '');
                return displayed.snapshotId === (raw as { snapshotId?: unknown }).snapshotId;
              } catch { return false; }
            }, { timeout: 1800 }).toBe(true);
            row.browserAcceptedMs = elapsed();
            row.accepted = true;
          } catch { /* A stale response must remain visible as a failed acceptance check. */ }
        }
        if (row.accepted && row.decision?.type === 'recommend') {
          row.stage = 'card';
          // Do not scroll again: that could change the evidence and disguise a stale display failure.
          row.cardShown = await page.locator('#catalog-recommendation a').isVisible();
          if (row.cardShown) {
            const href = await page.locator('#catalog-recommendation a').getAttribute('href');
            row.cardShown = href === catalogDefinition.contents[row.decision.result]!.href;
          }
        }
        row.staleDiagnostic = (await page.locator('#catalog-diagnostics').textContent())?.includes('stale_decision') ?? false;
        row.stage = 'withdrawal';
        await page.locator('#catalog-revoke').click();
        await expect(page.locator('#catalog-recommendation')).toBeEmpty();
        await expect(page.locator('#catalog-decision')).toHaveText('判定前');
        const cleared = JSON.parse((await page.locator('#catalog-snapshot').textContent()) ?? '{}');
        row.withdrawn = Array.isArray(cleared.observations) && cleared.observations.length === 0;
        row.status = row.httpStatus === 200 && row.httpPosts === 1 && row.decision.valid && row.accepted && row.withdrawn
          && !row.unexpectedTraffic && !row.browserCredential && !row.browserServerSdk && row.pageErrors === 0
          && row.decision.semanticMatch && (row.decision.type !== 'recommend' || row.cardShown) ? 'passed' : 'failed';
        row.stage = 'complete';
      } catch { /* Store the bounded stage name, never Playwright/SDK error objects or page bodies. */ }
      finally {
        if (browser) await browser.close().catch(() => undefined);
        active = undefined;
        stage = `${scenario.browser}:${row.stage}`;
        await save();
        console.log(`${scenario.browser}: ${row.status}, accepted=${row.accepted}, card=${row.cardShown}, API=${row.requests.length}`);
      }
    }
    stage = 'complete';
    if (results.some(row => row.status !== 'passed')) process.exitCode = 1;
  } catch {
    console.error(`FAIL: ${stage}`); process.exitCode = 1;
  } finally {
    active = undefined;
    if (listening) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await save();
    console.log(`100候補の実ブラウザ試験結果: ${path}`);
  }
}
try { await main(); }
catch {
  console.error('catalog_browser_failed'); process.exitCode = 1;
}
