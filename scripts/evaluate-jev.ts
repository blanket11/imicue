import { mkdir, writeFile } from 'node:fs/promises';
import { compareScenarios } from './lib/jev-evaluation.js';

if (process.env.RUN_JEV_EVALUATION !== '1') {
  console.log('SKIP: 実API比較はRUN_JEV_EVALUATION=1を指定した場合だけ実行します。');
} else if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.log('SKIP: TYPESAFE_API_KEYが未設定です。');
} else {
  const suite = process.env.JEV_EVALUATION_SUITE ?? 'regression';
  if (suite !== 'regression' && suite !== 'freshness' && suite !== 'semantic') throw new Error('invalid_evaluation_suite');
  const variant = process.env.JEV_EVALUATION_VARIANT ?? 'dictionary-ja';
  if (!['dictionary-ja', 'dictionary-en', 'labels'].includes(variant)) throw new Error('invalid_input_variant');
  const report = await compareScenarios({ apiKey: process.env.TYPESAFE_API_KEY, transport: globalThis.fetch, suite,
    variant: variant as 'dictionary-ja' | 'dictionary-en' | 'labels' });
  const path = `test-results/jev-${suite}${variant === 'dictionary-ja' ? '' : `-${variant}`}-evaluation.json`;
  await mkdir('test-results', { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.replace('.json', `-${report.runAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.results) {
    const rules = row.rules.type === 'recommend' ? row.rules.contentId : row.rules.reason;
    console.log(`${row.id}: Rules=${rules}, Jev=${row.actual}, API=${row.requests.length}, ${row.elapsedMs}ms`);
  }
  console.log(JSON.stringify(report.summary));
  console.log(`人による全件レビューは未完了。詳細: ${path}`);
  if (report.summary.failures || report.summary.completed !== report.summary.planned) process.exitCode = 1;
}
