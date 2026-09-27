import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Copy only manifests and generated files: source conditions cannot hide broken declarations.
const fixture = resolve('dist/consumer-check');
await rm(fixture, { recursive: true, force: true });
await mkdir(`${fixture}/node_modules/@imicue`, { recursive: true });
for (const name of ['core', 'browser', 'server']) {
  const directory = `${fixture}/node_modules/@imicue/${name}`;
  await mkdir(directory);
  const pkg = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  await writeFile(`${directory}/package.json`, JSON.stringify(pkg));
  await cp(`packages/${name}/dist`, `${directory}/dist`, { recursive: true });
}
await writeFile(`${fixture}/package.json`, '{"type":"module","private":true}');
await writeFile(`${fixture}/tsconfig.json`, JSON.stringify({ compilerOptions: {
  target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: ['node'],
}, include: ['consumer.ts'] }));
await writeFile(`${fixture}/consumer.ts`, `
import { createTracker, createRemoteEngine, type Tracker } from '@imicue/browser';
import { createRulesEngine, type Definition, type Decision } from '@imicue/core';
import { createDecisionHandler, createJevEngine } from '@imicue/server';
declare const definition: Definition;
const tracker: Tracker = createTracker({ definition, pageId: 'home', engine: createRulesEngine() });
tracker.onDecision((result: Decision) => { if (result.type === 'recommend') tracker.canDisplay(result); });
createRemoteEngine({ endpoint: '/v1/decide' });
createDecisionHandler({ definitions: [definition], engine: createJevEngine({ model: 'jev-1.13.0' }), mode: 'development', origins: ['http://localhost'] });
// @ts-expect-error Consent must be explicit, with a fixed value.
tracker.setConsent(true);
// @ts-expect-error Arbitrary user metadata is not supported.
tracker.track('action', { email: 'synthetic@example.test' });
`);
execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', fixture], { stdio: 'inherit' });
await writeFile(`${fixture}/browser-consumer.ts`, "import { createTracker, type TrackerOptions } from '@imicue/browser';\ndeclare const options: TrackerOptions;\nexport const tracker = createTracker(options);\n");
await writeFile(`${fixture}/browser-tsconfig.json`, JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: [] }, include: ['browser-consumer.ts'] }));
execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', `${fixture}/browser-tsconfig.json`], { stdio: 'inherit' });
// Exercise the package files and declarations a compiled consumer (including static Next clients) receives.
await writeFile(`${fixture}/scale-consumer.ts`, `
import assert from 'node:assert/strict';
import { createRulesEngine, evaluateSnapshot, validateDefinition, validateDecision, type Definition, type Snapshot } from '@imicue/core';
import { createTracker } from '@imicue/browser';
const definition: Definition = validateDefinition({
  schemaVersion: '0.1', siteId: 'compiled-scale', definitionVersion: 'scale-v1',
  signals: { overview: { kind: 'content', description: 'Synthetic overview' }, features: { kind: 'content', description: 'Synthetic feature' } },
  contents: Object.fromEntries(Array.from({ length: 100 }, (_, index) => ['candidate-' + String(index).padStart(3, '0'), {
    title: 'Synthetic guide', description: 'Synthetic guide', href: '/guide/' + index, enabled: true,
    relatedSignalIds: index === 99 ? ['features'] : [],
  }])),
  pages: { home: {}, ...Object.fromEntries(Array.from({ length: 100 }, (_, index) => ['page-' + index, { contentId: 'candidate-' + String(index).padStart(3, '0') }])) },
});
const snapshot: Snapshot = {
  schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion,
  snapshotId: 'snapshot', pageViewId: 'page-view', revision: 1, pageId: 'home', windowMs: 1800000,
  observations: ['overview', 'features'].map((signalId) => ({ signalId, source: 'direct', qualifiedViews: 1,
    visibleMs: 30000, clicks: 0, actions: 0, lastSeenAgoMs: 0 })),
  recent: [], outcomes: [], coverage: { truncated: false },
};
const decision = await evaluateSnapshot(definition, snapshot, createRulesEngine(), { now: 0 });
assert.equal(decision.type, 'recommend');
assert.equal(decision.type === 'recommend' && decision.contentId, 'candidate-099');
assert.equal(decision.assessments.length, 100);
assert.deepEqual(validateDecision(decision, definition, snapshot, 0), decision);
const tracker = createTracker({ definition, pageId: 'home' });
assert.deepEqual(tracker.getSnapshot().observations, []);
assert.equal(tracker.getState().consent, 'unknown');
tracker.destroy();
`);
await writeFile(`${fixture}/scale-tsconfig.json`, JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
  noEmit: false, outDir: './compiled-scale', rootDir: '.',
}, include: ['scale-consumer.ts'] }));
execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', `${fixture}/scale-tsconfig.json`], { stdio: 'inherit' });
execFileSync(process.execPath, [`${fixture}/compiled-scale/scale-consumer.js`], { cwd: fixture, stdio: 'inherit' });
// Each import runs in a fresh Node process with browser accessors that fail loudly.
execFileSync(process.execPath, ['--input-type=module', '-e', `
for (const name of ['window', 'document', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, name, { get() { throw new Error('DOM touched on import: ' + name); } });
const core = await import('@imicue/core');
const browser = await import('@imicue/browser');
if (typeof core.createRulesEngine !== 'function' || typeof browser.createTracker !== 'function') throw new Error('missing exports');
`], { cwd: fixture, stdio: 'inherit' });
const manifest = JSON.parse(await readFile('dist/browser/manifest.json', 'utf8'));
const standalone = await import(`../dist/browser/${manifest.files.es.filename}`);
assert.deepEqual(Object.keys(standalone).sort(), ['createRemoteEngine', 'createRulesEngine', 'createTracker', 'version']);
assert.equal(standalone.version, manifest.version);
for (const route of ['index.html', 'guides/features/index.html', 'guides/pricing/index.html', 'guides/cases/index.html']) {
  assert.match(await readFile(`examples/next-static/out/${route}`, 'utf8'), /DemoContract/);
}
let scanned = 0;
async function scan(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${file.name}`;
    if (file.isDirectory()) await scan(path);
    else if (/\.(js|html|json|txt|map)$/.test(file.name)) {
      const text = await readFile(path, 'utf8');
      assert.doesNotMatch(text, /IMICUE_SYNTHETIC_SECRET_M4|TYPESAFE_API_KEY|@typesafe-ai\/sdk|https:\/\/api\.typesafe\.ai/, `Server-only data in ${path}`);
      scanned++;
    }
  }
}
await scan('examples/next-static/out');
await scan('dist/browser');
await scan('dist/site');
console.log(JSON.stringify({ declarationConsumer: 'passed', compiled100CandidateConsumer: 'passed', importWithoutDOM: 'passed', staticFilesScanned: scanned }));
