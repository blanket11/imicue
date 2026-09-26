import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createDecisionHandler, createJevEngine, createNodeServer, JEV_MODEL } from '@imicue/server';
import { definition } from '../examples/vanilla/definition.js';
import { measuredTransport } from './lib/jev-evaluation.js';

const origin = 'http://127.0.0.1:5183';
const driverOrigin = 'http://127.0.0.1:5199';
const endpoint = 'http://127.0.0.1:5193/v1/decide';
const storageKey = 'imicue:demo-contract:demo-1';
const live = process.env.RUN_SAFARI_JEV === '1';
const mode = live ? 'jev' : 'mock';
const artifacts = `test-results/safari-${mode}`;
const measured = measuredTransport(globalThis.fetch, 1);
const checks: string[] = [];
const layouts: unknown[] = [];
let stage = 'prerequisites';
let sessionId = '';
let browserVersion = '';
let driver: ReturnType<typeof spawn> | undefined;
let server: ReturnType<typeof createNodeServer> | undefined;
let recommendation: unknown;

async function command<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${driverOrigin}${path}`, { method,
    headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  // Raw WebDriver errors can contain page content. Retain only the HTTP status.
  if (!response.ok) throw new Error(`webdriver_status_${response.status}`);
  return result.value as T;
}
const sessionCommand = <T = unknown>(method: string, path: string, body?: unknown) => command<T>(method, `/session/${sessionId}${path}`, body);
const execute = <T = unknown>(script: string, ...args: unknown[]) => sessionCommand<T>('POST', '/execute/sync', { script, args });
async function waitFor(script: string, timeout = 12_000): Promise<void> {
  const end = Date.now() + timeout;
  do {
    if (await execute<boolean>(script)) return;
    await delay(100);
  } while (Date.now() < end);
  throw new Error('condition_timeout');
}
async function go(path: string): Promise<void> {
  await sessionCommand('POST', '/url', { url: `${origin}${path}` });
  await waitFor('return !!document.querySelector("#start") && !!document.querySelector("#storage-mode-link");');
  assert.equal(new URL(await sessionCommand<string>('GET', '/url')).origin, origin);
}
async function click(selector: string): Promise<void> {
  const element = await sessionCommand<Record<string, string>>('POST', '/element', { using: 'css selector', value: selector });
  await sessionCommand('POST', `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
}
async function begin(): Promise<void> {
  await click('#consent');
  await click('#start');
  await waitFor('return document.querySelector("#status").textContent === "許可済み・計測中";');
}
async function screenshot(name: string): Promise<void> {
  const encoded = await sessionCommand<string>('GET', '/screenshot');
  await writeFile(`${artifacts}/${name}.png`, Buffer.from(encoded, 'base64'));
}
const emptyObservations = 'return JSON.parse(document.querySelector("#snapshot").textContent).observations.length === 0;';

try {
  if (process.platform !== 'darwin') throw new Error('macos_required');
  if (live && !process.env.TYPESAFE_API_KEY?.trim()) throw new Error('key_required');
  assert.equal((await fetch(origin, { signal: AbortSignal.timeout(3_000) })).status, 200);
  const occupied = await fetch(`${driverOrigin}/status`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
  if (occupied) throw new Error('driver_port_in_use');
  await mkdir(artifacts, { recursive: true });
  if (live) {
    server = createNodeServer(createDecisionHandler({ definitions: [definition], mode: 'development', origins: [origin],
      engine: createJevEngine({ model: JEV_MODEL, apiKey: process.env.TYPESAFE_API_KEY, fetch: measured.fetch }),
    }));
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(5193, '127.0.0.1', resolve);
    });
  }
  stage = 'driver-start';
  driver = spawn('/usr/bin/safaridriver', ['--port', '5199'], { stdio: 'ignore' });
  let launchFailed = false;
  driver.once('error', () => { launchFailed = true; });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (launchFailed || driver.exitCode !== null) throw new Error('driver_unavailable');
    if (await fetch(`${driverOrigin}/status`).then((response) => response.ok, () => false)) break;
    await delay(100);
  }
  stage = 'session-start';
  const session = await command<{ sessionId: string; capabilities: { browserVersion: string } }>('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  });
  sessionId = session.sessionId;
  browserVersion = session.capabilities.browserVersion;
  await sessionCommand('POST', '/window/rect', { width: 1280, height: 900 });

  stage = 'consent-and-view';
  await go('/');
  await click('#feature-action');
  assert.equal(await execute(emptyObservations), true);
  await click('#consent');
  await click('#feature-action');
  assert.equal(await execute(emptyObservations), true);
  await click('#start');
  await execute('document.querySelector("#features").scrollIntoView();');
  await waitFor('return JSON.parse(document.querySelector("#snapshot").textContent).observations.some(row => row.signalId === "demo-features" && row.qualifiedViews >= 1 && row.visibleMs >= 3000);');
  await click('#stop');
  await click('#reset');
  await click('#feature-action');
  assert.equal(await execute(emptyObservations), true);
  checks.push('consent/start, 3-second qualified view, stop/reset');

  stage = 'session-round-trip';
  await go('/?storage=session');
  await begin();
  await click('#feature-action');
  await click('nav a[href*="/guides/features/"]');
  await waitFor('return document.body.dataset.pageId === "features-guide";');
  assert.equal(await execute(emptyObservations), true);
  await click('#consent');
  assert.equal(await execute(emptyObservations), true);
  await click('#start');
  await waitFor('return JSON.parse(document.querySelector("#snapshot").textContent).observations.some(row => row.signalId === "demo-feature-used" && row.actions >= 1);');
  await click('#complete-guide');
  await click('nav a[href*="/?storage=session"]');
  await waitFor('return document.body.dataset.pageId === "home";');
  assert.equal(await execute(emptyObservations), true);
  await begin();
  await waitFor('return JSON.parse(document.querySelector("#snapshot").textContent).outcomes.some(row => row.kind === "completed" && row.contentId === "demo-features-guide");');
  await waitFor('const text = document.querySelector("#decision").textContent; return text !== "判定前" && !JSON.parse(text).assessments.some(row => row.contentId === "demo-features-guide");');
  await screenshot('session-round-trip');
  await click('#revoke');
  assert.equal(await execute('return sessionStorage.getItem(arguments[0]);', storageKey), null);
  await sessionCommand('POST', '/refresh', {});
  await begin();
  assert.equal(await execute('return JSON.parse(document.querySelector("#snapshot").textContent).outcomes.length;'), 0);
  checks.push('TOP → guide → TOP, restored action, completed exclusion, withdrawal clears storage');

  stage = 'history-back';
  await click('#feature-action');
  await click('nav a[href*="/guides/features/"]');
  await waitFor('return document.body.dataset.pageId === "features-guide";');
  await begin();
  await click('#complete-guide');
  await sessionCommand('POST', '/back', {});
  await waitFor('return document.body.dataset.pageId === "home" && document.querySelector("#status").textContent === "未許可・計測停止中";');
  await begin();
  await waitFor('return JSON.parse(document.querySelector("#snapshot").textContent).outcomes.some(row => row.kind === "completed");');
  await click('#revoke');
  checks.push('Back restores the latest archive after renewed consent');

  stage = 'remote-before-consent';
  await go('/?engine=remote');
  await click('#feature-action');
  await click('#consent');
  await click('#feature-action');
  assert.equal(await execute(emptyObservations), true);
  assert.equal(await execute('return performance.getEntriesByName(arguments[0]).length;', endpoint), 0);
  stage = 'remote-decision';
  await execute(`
    for (const target of document.querySelectorAll('[data-imicue-signal]')) if (target.id !== 'features') target.removeAttribute('data-imicue-signal');
    document.getElementById('start').click();
    document.querySelector('#features h2').click();
    document.getElementById('feature-action').click();
    for (const target of document.querySelectorAll('[data-imicue-signal]')) target.removeAttribute('data-imicue-signal');
  `);
  const model = live ? JEV_MODEL : 'mock-local-v1';
  await waitFor(`return document.querySelector('#decision').textContent.includes('${model}');`);
  recommendation = await execute('return JSON.parse(document.querySelector("#decision").textContent);');
  assert.equal((recommendation as { type: string }).type, 'recommend');
  assert.equal((recommendation as { contentId: string }).contentId, 'demo-features-guide');
  if (live) assert.equal(measured.requests.length, 1);
  await execute('document.querySelector("#recommendation-slot").scrollIntoView();');
  await waitFor('const link = document.querySelector(".recommendation a"); return !!link && link.getBoundingClientRect().height > 0;');
  assert.match(await execute<string>('return document.querySelector(".recommendation a").href;'), /\/guides\/features\/\?engine=remote#imicue-recommendation$/);
  await screenshot('remote-recommendation');
  await click('#revoke');
  await waitFor('return document.querySelector("#decision").textContent === "判定前" && !document.querySelector(".recommendation");');
  assert.equal(await execute(emptyObservations), true);
  checks.push(`${mode} HTTP decision, recommendation card and withdrawal`);

  stage = 'viewport-stress';
  for (const width of [1280, 640]) {
    await sessionCommand('POST', '/window/rect', { width, height: 900 });
    for (const path of ['/', '/guides/features/']) {
      await go(path);
      const bounds = await execute<{ width: number; height: number; scrollWidth: number; clientWidth: number }>('return {width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth};');
      const name = `layout-${width}-${path === '/' ? 'home' : 'guide'}`;
      await screenshot(name);
      layouts.push({ route: path, requestedWidth: width, ...bounds, touch: false, evidence: `${artifacts}/${name}.png` });
      assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1);
    }
  }
  checks.push('no horizontal overflow on TOP and guide at two desktop window widths');
  stage = 'complete';
  console.log(`Safari ${browserVersion}: PASS (${checks.length} scoped checks, ${measured.requests.length} real API requests)`);
} catch {
  console.error(`Safari verification failed at: ${stage}`);
  process.exitCode = 1;
  if (sessionId) await screenshot('failure').catch(() => undefined);
} finally {
  if (sessionId) await command('DELETE', `/session/${sessionId}`).catch(() => undefined);
  driver?.kill('SIGTERM');
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/report.json`, `${JSON.stringify({
    session: { driver: 'safaridriver', browser: `Safari ${browserVersion}`, buildMode: 'development', baseUrl: origin,
      auth: 'none', dataFixture: 'synthetic Vanilla demo', probesRun: ['functional-flow', 'viewport-stress'],
      probesSkipped: [
        { probe: 'console-network', reason: 'WebDriver transport has no full console/network event collection in this harness' },
        { probe: 'failure-injection/layout-shift/web-vitals', reason: 'no interception/throttling in this native driver harness' },
        { probe: 'axe-scan/target-size/focus-walk/theme-locale-matrix', reason: 'outside this scoped Safari functional smoke test' },
      ] }, mode, stage, checks, layouts, recommendation, requests: measured.requests,
  }, null, 2)}\n`);
}
