import { evaluateSnapshot } from '@imicue/core';
import { createJevEngine, JEV_MODEL } from '@imicue/server';
import { definition, snapshot, NOW } from '../packages/core/test/fixtures.js';
import { createHarnessRun, evaluationStatuses, prepareLiveHarness } from './lib/live-harness.js';

const run = createHarnessRun('jev-integration');
async function main() {
  if (!await prepareLiveHarness(run, 'RUN_JEV_INTEGRATION', { model: JEV_MODEL })) return;
  const requested = Number(process.env.JEV_INTEGRATION_REQUESTS ?? '1');
  if (!Number.isInteger(requested) || requested < 1 || requested > 5) throw new Error('invalid_integration_request_count');
  const engine = createJevEngine({ model: JEV_MODEL });
  const results = [];
  let failures = 0;
  for (let index = 0; index < requested; index++) {
    const result = await evaluateSnapshot(definition(), snapshot(), engine, { now: NOW });
    const failed = result.type === 'abstain' && ['engine_unavailable', 'invalid_result', 'capacity_limit', 'definition_mismatch'].includes(result.reason);
    if (failed) failures++;
    const row = { request: index + 1, type: result.type, model: result.engine.model, failed,
      ...(result.type === 'abstain' ? { reason: result.reason } : { contentId: result.contentId }) };
    results.push(row);
    console.log(JSON.stringify(row));
    const statuses = evaluationStatuses({ completed: results.length, planned: requested, failures, matches: null });
    await run.save({ model: JEV_MODEL, requested, results, ...statuses,
      ...(!failed && results.length < requested ? { status: 'running', completionStatus: 'running' } : {}) });
    if (failed) { process.exitCode = 1; break; }
  }
  console.log(`終了0は接続試験の完了を示し、推薦品質の合格を示しません。詳細: ${run.path}`);
}
try { await main(); }
catch (error) { await run.fail(error); }
