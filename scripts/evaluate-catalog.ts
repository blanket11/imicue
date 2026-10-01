import { CatalogBudget } from './lib/catalog-budget.js';
import { planCatalogEvaluation, runCatalogEvaluation, type CatalogMethodSelection } from './lib/catalog-evaluation.js';
import type { CatalogSuite } from './lib/catalog-fixtures.js';
import { createHarnessRun, prepareLiveHarness } from './lib/live-harness.js';

const run = createHarnessRun('catalog-evaluation');

async function main() {
  const arguments_ = process.argv.slice(2);
  const permitted = new Set(['--suite', '--method', '--limit', '--offset', '--live', '--plan']);
  for (let index = 0; index < arguments_.length; index++) {
    const item = arguments_[index]!;
    if (!permitted.has(item)) throw new Error('invalid_catalog_argument');
    if (!['--live', '--plan'].includes(item)) {
      if (!arguments_[index + 1] || arguments_[index + 1]!.startsWith('--')) throw new Error('missing_catalog_argument');
      index++;
    }
  }
  const value = (flag: string) => { const index = arguments_.indexOf(flag); return index < 0 ? undefined : arguments_[index + 1]; };
  const suite = value('--suite') ?? 'pilot';
  if (!['pilot', 'dev', 'holdout', 'stability'].includes(suite)) throw new Error('invalid_catalog_suite');
  const method = value('--method') ?? (suite === 'pilot' ? 'both' : 'all-score');
  if (!['all-score', 'choice-top3', 'both'].includes(method)) throw new Error('invalid_catalog_method');
  const options = { suite: suite as CatalogSuite, method: method as CatalogMethodSelection,
    ...(value('--limit') !== undefined ? { limit: Number(value('--limit')) } : {}),
    ...(value('--offset') !== undefined ? { offset: Number(value('--offset')) } : {}) };
  const plan = planCatalogEvaluation(options);
  run.addLatest(`catalog-${suite}-${method}`);
  if (!arguments_.includes('--live') || arguments_.includes('--plan')) {
    const report = { mode: 'offline-plan', ...plan, status: 'planned', completionStatus: 'not_started',
      authoredExpectationStatus: 'not_evaluated', humanReviewStatus: 'pending', results: [] };
    await run.save(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!await prepareLiveHarness(run, 'RUN_CATALOG_EVALUATION', plan)) return;
  const report = await runCatalogEvaluation({ ...options, apiKey: process.env.TYPESAFE_API_KEY!, transport: globalThis.fetch,
    budget: new CatalogBudget('test-results/catalog-budget.json'),
    onCheckpoint: report => run.save({ ...report, status: 'running', completionStatus: 'running' }),
    onProgress: row => console.log(`${row.id}: ${row.method}=${row.actual}, API=${row.requests}, ${row.elapsedMs}ms`),
  });
  await run.save(report);
  console.log(JSON.stringify(report.summary));
  console.log(`終了0は試験の完了を示します。AI作成の期待ラベルとの一致は推薦品質の合格を示さず、人による確認は未了です。詳細: ${run.path}`);
  if (report.status !== 'completed') process.exitCode = 1;
}
try { await main(); }
catch (error) { await run.fail(error); }
