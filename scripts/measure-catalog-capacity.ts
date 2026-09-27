import { mkdir, writeFile } from 'node:fs/promises';
import { CatalogBudget } from './lib/catalog-budget.js';
import { planCatalogMeasurement, runCatalogMeasurement, type CatalogMeasurementSuite } from './lib/catalog-capacity.js';

async function main() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--suite') { if (!args[++index]) throw new Error('missing_catalog_suite'); }
    else if (!['--plan', '--live'].includes(args[index]!)) throw new Error('invalid_catalog_argument');
  }
  const suite = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : 'capacity';
  if (suite !== 'capacity' && suite !== 'legacy') throw new Error('invalid_catalog_suite');
  const selected = suite as CatalogMeasurementSuite;
  const plan = planCatalogMeasurement(selected);
  if (!args.includes('--live') || args.includes('--plan')) {
    console.log(JSON.stringify({ mode:'offline-plan', ...plan }, null, 2));
    return;
  }
  if (process.env.RUN_CATALOG_EVALUATION !== '1' || !process.env.TYPESAFE_API_KEY?.trim()) throw new Error('catalog_live_requires_explicit_gate_and_key');
  await mkdir('test-results', { recursive:true });
  const path = `test-results/catalog-measurement-${suite}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const report = await runCatalogMeasurement({ suite: selected, apiKey: process.env.TYPESAFE_API_KEY, transport: globalThis.fetch,
    budget: new CatalogBudget('test-results/catalog-budget.json'),
    onCheckpoint: value => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {mode:0o600}) });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {mode:0o600});
  console.log(JSON.stringify(report.summary));
  console.log(`計測結果: ${path}`);
  if (report.completed !== plan.rows.length || report.summary.failures || report.results.some(row => row.proposedMatch === false)) process.exitCode = 1;
}
try { await main(); }
catch (error) {
  const code = error instanceof Error && /^(?:invalid_catalog_|missing_catalog_|catalog_)[a-z_]+$/.test(error.message)
    ? error.message : 'catalog_measurement_failed';
  console.error(code);
  process.exitCode = 1;
}
