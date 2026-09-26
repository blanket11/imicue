import { mkdir, writeFile } from 'node:fs/promises';
import { compareScenarios } from './lib/jev-evaluation.js';

if (process.env.RUN_JEV_EVALUATION !== '1') {
  console.log('SKIP: 実API比較はRUN_JEV_EVALUATION=1を指定した場合だけ実行します。');
} else if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.log('SKIP: TYPESAFE_API_KEYが未設定です。');
} else {
  const report = await compareScenarios({ apiKey: process.env.TYPESAFE_API_KEY, transport: globalThis.fetch });
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/jev-evaluation.json', `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report.results) {
    const rules = row.rules.type === 'recommend' ? row.rules.contentId : row.rules.reason;
    console.log(`${row.id}: Rules=${rules}, Jev=${row.actual}, API=${row.requests.length}, ${row.elapsedMs}ms`);
  }
  console.log(JSON.stringify(report.summary));
  console.log('人の意味評価は未実施。詳細: test-results/jev-evaluation.json');
  if (report.summary.failures || report.summary.completed !== report.summary.planned) process.exitCode = 1;
}
