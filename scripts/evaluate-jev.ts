import { compareScenarios } from './lib/jev-evaluation.js';
import { createHarnessRun, prepareLiveHarness } from './lib/live-harness.js';

const run = createHarnessRun('jev-evaluation');
async function main() {
  const suite = process.env.JEV_EVALUATION_SUITE ?? 'regression';
  const variant = process.env.JEV_EVALUATION_VARIANT ?? 'dictionary-ja';
  const validSuite = ['regression', 'freshness', 'semantic'].includes(suite);
  const validVariant = ['dictionary-ja', 'dictionary-en', 'labels'].includes(variant);
  if (validSuite && validVariant) run.addLatest(`jev-${suite}${variant === 'dictionary-ja' ? '' : `-${variant}`}-evaluation`);
  if (!await prepareLiveHarness(run, 'RUN_JEV_EVALUATION', { ...(validSuite ? { suite } : {}), ...(validVariant ? { variant } : {}) })) return;
  if (suite !== 'regression' && suite !== 'freshness' && suite !== 'semantic') throw new Error('invalid_evaluation_suite');
  if (!validVariant) throw new Error('invalid_input_variant');
  const report = await compareScenarios({ apiKey: process.env.TYPESAFE_API_KEY!, transport: globalThis.fetch, suite,
    variant: variant as 'dictionary-ja' | 'dictionary-en' | 'labels' });
  await run.save(report);
  for (const row of report.results) {
    const rules = row.rules.type === 'recommend' ? row.rules.contentId : row.rules.reason;
    console.log(`${row.id}: Rules=${rules}, Jev=${row.actual}, API=${row.requests.length}, ${row.elapsedMs}ms`);
  }
  console.log(JSON.stringify(report.summary));
  console.log(`終了0は試験の完了を示します。推薦品質の合格を示すものではなく、人による確認は未了です。詳細: ${run.path}`);
  if (report.status !== 'completed') process.exitCode = 1;
}
try { await main(); }
catch (error) { await run.fail(error); }
