import { mkdir, writeFile } from 'node:fs/promises';
import { createRulesEngine, evaluateSnapshot, validateDefinition } from '@imicue/core';
import { definition, NOW, scenarios } from '../packages/core/test/fixtures.js';

// Reuse the regression fixtures; do not present authored expectations as human labels.
const results = [];
for (const scenario of scenarios) {
  const source = definition();
  const configured = 'expiresFeature' in scenario ? {
    ...source, contents: { ...source.contents, 'feature-guide': {
      ...source.contents['feature-guide']!, availableUntil: '2026-09-25T23:59:59Z',
    } },
  } : source;
  const decision = await evaluateSnapshot(validateDefinition(configured), scenario.input, createRulesEngine(), {
    now: NOW, id: () => `evaluation-${scenario.id}`,
  });
  const actual = decision.type === 'recommend' ? decision.contentId : decision.reason;
  results.push({ id: scenario.id, split: scenario.split, expected: scenario.expected,
    actual, regressionPassed: actual === scenario.expected, decision });
}
const report = {
  schemaVersion: 1, evaluatedAt: new Date(NOW).toISOString(), engine: 'rules-v1',
  humanReview: 'pending', qualityComparison: 'not_performed', realApiRequests: 0,
  development: results.filter((row) => row.split === 'development').length,
  holdout: results.filter((row) => row.split === 'holdout').length,
  results,
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/rules-evaluation.json', `${JSON.stringify(report, null, 2)}\n`);
for (const row of results) console.log(`${row.regressionPassed ? 'PASS' : 'FAIL'} ${row.split}/${row.id}: ${row.actual}`);
console.log('test-results/rules-evaluation.json（このコマンドはRulesの回帰確認のみ。人の意味評価・Jev比較は行いません）');
if (results.some((row) => !row.regressionPassed)) process.exitCode = 1;
