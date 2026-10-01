import { describe, expect, it, vi } from 'vitest';
import { createRulesEngine, evaluateSnapshot } from '@imicue/core';
import { createLatestEvaluation } from '../../site/latest-evaluation.js';
import { definition, makeSnapshot, type Scenario } from '../../site/scenarios.js';

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = () => refuse(new Error('synthetic_evaluation_failure'));
  });
  return { promise, resolve, reject };
}

describe('public site latest evaluation publisher', () => {
  it.each(['resolve', 'reject'] as const)('ignores an older evaluation that finishes with %s after the latest result', async (completion) => {
    const older = deferred();
    const latest = deferred();
    const publish = vi.fn();
    const reject = vi.fn();
    const run = createLatestEvaluation(async (scenario: Scenario) => {
      await (scenario === 'cases' ? older.promise : latest.promise);
      return evaluateSnapshot(definition, makeSnapshot(scenario), createRulesEngine());
    }, publish, reject);

    const oldRun = run('cases');
    const latestRun = run('features');
    latest.resolve();
    await latestRun;
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'recommend', contentId: 'product-features' }));

    older[completion]();
    await oldRun;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
  });

  it('publishes a failure from the latest evaluation and suppresses an older success', async () => {
    const older = deferred();
    const latest = deferred();
    const publish = vi.fn();
    const reject = vi.fn();
    const run = createLatestEvaluation(async (input: 'older' | 'latest') => {
      await (input === 'older' ? older.promise : latest.promise);
      return input;
    }, publish, reject);
    const oldRun = run('older');
    const latestRun = run('latest');
    latest.reject();
    await latestRun;
    older.resolve();
    await oldRun;
    expect(reject).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
