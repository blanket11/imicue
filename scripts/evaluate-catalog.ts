import { mkdir, writeFile } from 'node:fs/promises';
import { CatalogBudget } from './lib/catalog-budget.js';
import { planCatalogEvaluation, runCatalogEvaluation, type CatalogMethodSelection } from './lib/catalog-evaluation.js';
import type { CatalogSuite } from './lib/catalog-fixtures.js';

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
  if (!arguments_.includes('--live') || arguments_.includes('--plan')) {
    console.log(JSON.stringify({ mode: 'offline-plan', ...plan }, null, 2));
    return;
  }
  if (process.env.RUN_CATALOG_EVALUATION !== '1' || !process.env.TYPESAFE_API_KEY?.trim()) throw new Error('catalog_live_requires_explicit_gate_and_key');
  await mkdir('test-results', { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `test-results/catalog-${suite}-${method}-${runId}.json`;
  const report = await runCatalogEvaluation({ ...options, apiKey: process.env.TYPESAFE_API_KEY, transport: globalThis.fetch,
    budget: new CatalogBudget('test-results/catalog-budget.json'),
    onCheckpoint: report => writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    onProgress: row => console.log(`${row.id}: ${row.method}=${row.actual}, API=${row.requests}, ${row.elapsedMs}ms`),
  });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report.summary));
  console.log(`AI作成の期待ラベルで、人による確認は未了です。詳細: ${path}`);
  if (report.completedEvaluations !== report.plannedEvaluations || report.results.some(row => row.failed)) process.exitCode = 1;
}
try { await main(); }
catch (error) {
  // No SDK error objects or raw errors may expose response/request bodies or credentials.
  const code = error instanceof Error && /^(?:invalid_catalog_|missing_catalog_|catalog_)[a-z_]+$/.test(error.message)
    ? error.message : 'catalog_evaluation_failed';
  console.error(code);
  process.exitCode = 1;
}
