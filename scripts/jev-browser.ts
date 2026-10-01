import assert from 'node:assert/strict';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { createDecisionHandler, createJevEngine, createNodeServer, JEV_MODEL } from '@imicue/server';
import { JEV_POLICY_VERSION } from '@imicue/core';
import { definition } from '../examples/vanilla/definition.js';
import { measuredTransport } from './lib/jev-evaluation.js';
import { createHarnessRun, evaluationStatuses, prepareLiveHarness } from './lib/live-harness.js';

// Separate from normal E2E: synthetic demo actions, at most three paid requests in total.
const run = createHarnessRun('jev-browser');
async function main() {
  const scenario = process.env.JEV_BROWSER_SCENARIO ?? 'single-action';
  const validScenario = ['single-action', 'feature-and-action'].includes(scenario);
  if (scenario === 'feature-and-action') run.addLatest(`jev-browser-${scenario}`);
  if (!await prepareLiveHarness(run, 'RUN_JEV_BROWSER', { model: JEV_MODEL, ...(validScenario ? { scenario } : {}) })) return;
  if (!['single-action', 'feature-and-action'].includes(scenario)) throw new Error('invalid_browser_scenario');
  const measured = measuredTransport(globalThis.fetch, 3);
  const server = createNodeServer(createDecisionHandler({ definitions: [definition],
    engine: createJevEngine({ model: JEV_MODEL, apiKey: process.env.TYPESAFE_API_KEY, fetch: measured.fetch }),
    mode: 'development', origins: ['http://127.0.0.1:5194'],
  }));
  const results = [];
  let stage = 'listen';
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(5193, '127.0.0.1', resolve);
    });
    for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
      stage = `${name}:launch`;
      const browser = await launcher.launch();
      try {
        const page = await browser.newPage();
        const offset = measured.requests.length;
        let posts = 0;
        let unexpectedTraffic = false;
        let credentialInBrowser = false;
        let pageErrors = 0;
        page.on('pageerror', () => { pageErrors++; });
        page.on('request', (request) => {
          const origin = new URL(request.url()).origin;
          if (!['http://127.0.0.1:5194', 'http://127.0.0.1:5193'].includes(origin)) unexpectedTraffic = true;
          if (request.headers().authorization) credentialInBrowser = true;
          if (request.method() === 'POST') posts++;
        });
        stage = `${name}:before-consent`;
        await page.goto('http://127.0.0.1:5194/?engine=remote');
        await page.locator('#feature-action').click();
        await page.locator('#consent').check();
        await page.locator('#feature-action').click();
        assert.equal(posts, 0);
        stage = `${name}:decision`;
        await page.evaluate((scenario) => {
          // Keep view-duration updates from changing the snapshot while the request is pending.
          for (const target of document.querySelectorAll('[data-imicue-signal]')) {
            if (scenario !== 'feature-and-action' || target.id !== 'features') target.removeAttribute('data-imicue-signal');
          }
          document.getElementById('start')!.click();
          if (scenario === 'feature-and-action') document.querySelector<HTMLElement>('#features h2')!.click();
          document.getElementById('feature-action')!.click();
          for (const target of document.querySelectorAll('[data-imicue-signal]')) target.removeAttribute('data-imicue-signal');
        }, scenario);
        await expect(page.locator('#decision')).toContainText(JEV_MODEL, { timeout: 15_000 });
        const decision = JSON.parse((await page.locator('#decision').textContent())!);
        assert.equal(decision.policyVersion, JEV_POLICY_VERSION);
        assert.equal(measured.requests.length - offset, 1);
        assert.equal(posts, 1);
        assert.equal(unexpectedTraffic || credentialInBrowser, false);
        assert.equal(pageErrors, 0);
        let cardShown = false;
        if (decision.type === 'recommend') {
          stage = `${name}:card`;
          await page.locator('#recommendation-slot').scrollIntoViewIfNeeded();
          await expect(page.locator('.recommendation a')).toBeVisible();
          await expect(page.locator('.recommendation a')).toHaveAttribute('href', /\/guides\/(features|pricing|cases)\/\?engine=remote#imicue-recommendation$/);
          cardShown = true;
        }
        stage = `${name}:revoke`;
        await page.locator('#revoke').click();
        await expect(page.locator('#decision')).toHaveText('判定前');
        await expect(page.locator('#recommendation-slot')).toBeEmpty();
        assert.deepEqual(JSON.parse((await page.locator('#snapshot').textContent())!).observations, []);
        results.push({ browser: name, status: 'passed', type: decision.type,
          result: decision.type === 'recommend' ? decision.contentId : decision.reason,
          cardShown, assessments: decision.assessments,
          policyVersion: decision.policyVersion, requests: measured.requests.slice(offset) });
        console.log(`${name}: PASS (real API, consent/start, withdrawal, no browser credential)`);
      } finally { await browser.close(); }
    }
    stage = 'complete';
  } catch {
    // Never print exception payloads: API and browser errors may contain request context.
    console.error(`FAIL: ${stage}`);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await run.save({ model: JEV_MODEL, stage, scenario, requests: measured.requests, results,
      ...evaluationStatuses({ completed: results.length, planned: 3, failures: stage === 'complete' ? 0 : 1, matches: null }) });
    console.log(`終了0はブラウザ接続試験の完了を示し、推薦品質の合格を示しません。詳細: ${run.path}`);
  }
}
try { await main(); }
catch (error) { await run.fail(error); }
