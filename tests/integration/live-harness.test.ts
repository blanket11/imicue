import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluationStatuses, liveHarnessGate } from '../../scripts/lib/live-harness.js';

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const cases = [
  { script: 'evaluate-jev', flag: 'RUN_JEV_EVALUATION', report: 'jev-evaluation', alias: 'jev-regression-evaluation', args: [] },
  { script: 'jev-integration', flag: 'RUN_JEV_INTEGRATION', report: 'jev-integration', alias: null, args: [] },
  { script: 'jev-browser', flag: 'RUN_JEV_BROWSER', report: 'jev-browser', alias: null, args: [] },
  { script: 'catalog-browser', flag: 'RUN_CATALOG_BROWSER', report: 'catalog-browser', alias: null, args: [] },
  { script: 'evaluate-catalog', flag: 'RUN_CATALOG_EVALUATION', report: 'catalog-evaluation', alias: 'catalog-pilot-both', args: ['--live'] },
] as const;

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'imicue-harness-cli-'));
  directories.push(directory);
  const preload = join(directory, 'offline-fetch.mjs');
  await writeFile(preload, `import { writeFileSync } from 'node:fs';
let attempts = 0;
globalThis.fetch = async (_url, init) => {
  attempts++;
  if (process.env.HARNESS_MOCK_MODE !== 'scores') throw new Error('synthetic-private-transport-error');
  const request = JSON.parse(init.body);
  return Response.json({ model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 0 },
    answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, {
      type: 'score', score: 0, confidence: 0.9, legend: {}, probabilities: {},
    }])) });
};
process.on('exit', () => writeFileSync('network-attempts.json', JSON.stringify({ attempts })));
`);
  return { directory, preload };
}
async function cli(script: string, context: Awaited<ReturnType<typeof workspace>>, environment: NodeJS.ProcessEnv, args: readonly string[] = []) {
  const scriptPath = fileURLToPath(new URL(`../../scripts/${script}.ts`, import.meta.url));
  // Deliberately do not inherit the caller's API key, live gates or Node preload options.
  try {
    const result = await execute(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', context.preload,
      '--conditions=imicue-source', scriptPath, ...args], { cwd: context.directory, env: { NODE_ENV: 'test', ...environment }, timeout: 15_000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
const reportAt = async (directory: string, name: string) => JSON.parse(await readFile(join(directory, 'test-results', `${name}.json`), 'utf8'));
const attemptsAt = async (directory: string) => JSON.parse(await readFile(join(directory, 'network-attempts.json'), 'utf8')).attempts;

describe('live harness CLI reports, all transports replaced with offline mocks', () => {
  it.each(cases)('$script replaces stale success with a normal ungated skip', async (testCase) => {
    const context = await workspace();
    await mkdir(join(context.directory, 'test-results'));
    const oldSuccess = JSON.stringify({ status: 'completed', runAt: '2000-01-01T00:00:00Z', results: ['old-success'] });
    await writeFile(join(context.directory, 'test-results', `${testCase.report}.json`), oldSuccess);
    if (testCase.alias) await writeFile(join(context.directory, 'test-results', `${testCase.alias}.json`), oldSuccess);
    const result = await cli(testCase.script, context, {}, testCase.args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SKIP:');
    const report = await reportAt(context.directory, testCase.report);
    expect(report).toMatchObject({ status: 'skipped', reason: 'run_gate_not_enabled', completionStatus: 'not_started',
      authoredExpectationStatus: 'not_evaluated', humanReviewStatus: 'pending', results: [], requests: [] });
    expect(report.runAt).not.toBe('2000-01-01T00:00:00Z');
    if (testCase.alias) expect(await reportAt(context.directory, testCase.alias)).toEqual(report);
    expect(await attemptsAt(context.directory)).toBe(0);
    expect((await readdir(join(context.directory, 'test-results'))).some(name => name.startsWith(`${testCase.report}-`) && name.endsWith('.json'))).toBe(true);
  });

  it.each(cases)('$script fails an explicitly requested run with no API key and records the failure', async (testCase) => {
    const context = await workspace();
    const result = await cli(testCase.script, context, { [testCase.flag]: '1' }, testCase.args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('TYPESAFE_API_KEY');
    expect(await reportAt(context.directory, testCase.report)).toMatchObject({ status: 'failed', reason: 'api_key_missing',
      completionStatus: 'not_started', authoredExpectationStatus: 'not_evaluated', humanReviewStatus: 'pending', results: [] });
    expect(await attemptsAt(context.directory)).toBe(0);
  });

  it('records invalid evaluation configuration as a current failure without sending anything', async () => {
    const context = await workspace();
    const result = await cli('evaluate-jev', context, { RUN_JEV_EVALUATION: '1', TYPESAFE_API_KEY: 'synthetic-key', JEV_EVALUATION_SUITE: 'unexpected' });
    expect(result.code).toBe(1);
    expect(await reportAt(context.directory, 'jev-evaluation')).toMatchObject({ status: 'failed', failureCode: 'invalid_evaluation_suite' });
    expect(await attemptsAt(context.directory)).toBe(0);
  });

  it.each([
    { script: 'evaluate-jev', report: 'jev-evaluation', environment: { JEV_EVALUATION_SUITE: 'unexpected' } },
    { script: 'jev-browser', report: 'jev-browser', environment: { JEV_BROWSER_SCENARIO: 'unexpected' } },
  ])('$script keeps disabled live execution skipped even with unused invalid live configuration', async (testCase) => {
    const context = await workspace();
    const result = await cli(testCase.script, context, testCase.environment);
    expect(result.code).toBe(0);
    expect(await reportAt(context.directory, testCase.report)).toMatchObject({ status: 'skipped', reason: 'run_gate_not_enabled' });
    expect(await attemptsAt(context.directory)).toBe(0);
  });

  it('keeps semantic disagreement separate from completion and never promotes authored labels to human review', async () => {
    const context = await workspace();
    const result = await cli('evaluate-jev', context, { RUN_JEV_EVALUATION: '1', TYPESAFE_API_KEY: 'synthetic-key',
      JEV_EVALUATION_SUITE: 'semantic', HARNESS_MOCK_MODE: 'scores' });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('推薦品質の合格を示すものではなく');
    const report = await reportAt(context.directory, 'jev-evaluation');
    expect(report).toMatchObject({ status: 'completed', completionStatus: 'completed', authoredExpectationStatus: 'mismatched', humanReviewStatus: 'pending' });
    expect(report.summary).toMatchObject({ completed: 12, planned: 12, failures: 0, matchesProposedOutcomes: 8 });
    expect(await attemptsAt(context.directory)).toBe(12);
    expect(JSON.stringify(report)).not.toContain('synthetic-key');
  });

  it('records transport failure without treating it as a semantic mismatch or persisting secret error text', async () => {
    const context = await workspace();
    const result = await cli('evaluate-jev', context, { RUN_JEV_EVALUATION: '1', TYPESAFE_API_KEY: 'synthetic-key' });
    expect(result.code).toBe(1);
    const report = await reportAt(context.directory, 'jev-evaluation');
    expect(report).toMatchObject({ status: 'failed', completionStatus: 'failed', authoredExpectationStatus: 'incomplete', humanReviewStatus: 'pending' });
    expect(report.summary.failures).toBe(1);
    expect(await attemptsAt(context.directory)).toBe(1);
    expect(JSON.stringify(report) + result.stdout + result.stderr).not.toMatch(/synthetic-key|synthetic-private-transport-error/);
  });

  it('records catalog authored disagreement while retaining its successful technical completion and budget metrics', async () => {
    const context = await workspace();
    const result = await cli('evaluate-catalog', context, { RUN_CATALOG_EVALUATION: '1', TYPESAFE_API_KEY: 'synthetic-key', HARNESS_MOCK_MODE: 'scores' },
      ['--suite', 'dev', '--method', 'all-score', '--limit', '1', '--live']);
    expect(result.code).toBe(0);
    const report = await reportAt(context.directory, 'catalog-evaluation');
    expect(report).toMatchObject({ status: 'completed', completionStatus: 'completed', authoredExpectationStatus: 'mismatched', humanReviewStatus: 'pending' });
    expect(report.results[0]).toMatchObject({ failed: false, actual: 'abstain', proposedMatch: false, assessedCount: 100 });
    expect(await attemptsAt(context.directory)).toBe(report.summary[0].requests);
    expect(JSON.parse(await readFile(join(context.directory, 'test-results/catalog-budget.json'), 'utf8')).attempts).toHaveLength(report.summary[0].requests);
  });

  it('fails without raw exception output if the current report cannot be written', async () => {
    const context = await workspace();
    await mkdir(join(context.directory, 'test-results/jev-evaluation.json'), { recursive: true });
    const result = await cli('evaluate-jev', context, {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('harness_report_write_failed');
    expect(result.stderr).not.toContain(context.directory);
    expect(await attemptsAt(context.directory)).toBe(0);
  });

  it('lets an explicit offline catalog plan override live flags without touching the budget or transport', async () => {
    const context = await workspace();
    const result = await cli('evaluate-catalog', context, { RUN_CATALOG_EVALUATION: '1', TYPESAFE_API_KEY: 'synthetic-key' }, ['--live', '--plan', '--limit', '1']);
    expect(result.code).toBe(0);
    expect(await reportAt(context.directory, 'catalog-evaluation')).toMatchObject({ status: 'planned', completionStatus: 'not_started', authoredExpectationStatus: 'not_evaluated' });
    expect(await attemptsAt(context.directory)).toBe(0);
    expect(await readdir(join(context.directory, 'test-results'))).not.toContain('catalog-budget.json');
  });
});

describe('separate completion, authored expectations and human review states', () => {
  it('does not access credentials while the live gate is disabled', () => {
    const environment = { RUN_SAMPLE: '0', get TYPESAFE_API_KEY(): string { throw new Error('unexpected_key_read'); } };
    expect(liveHarnessGate('RUN_SAMPLE', environment).status).toBe('skipped');
  });
  it('keeps all matching authored labels provisional', () => {
    expect(evaluationStatuses({ completed: 2, planned: 2, failures: 0, matches: 2 })).toMatchObject({
      completionStatus: 'completed', authoredExpectationStatus: 'all_matched', humanReviewStatus: 'pending' });
  });
});
