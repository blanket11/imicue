import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type HarnessStatus = 'running' | 'completed' | 'failed' | 'skipped' | 'planned';
export const HARNESS_EXIT_MEANING = 'Exit 0 means the requested run completed or was explicitly skipped/planned; it does not mean recommendation quality passed human review.';

/** Read the key only after explicit opt-in; never return or persist credentials. */
export function liveHarnessGate(flag: string, environment: NodeJS.ProcessEnv = process.env) {
  if (environment[flag] !== '1') return { status: 'skipped', reason: 'run_gate_not_enabled' } as const;
  if (!environment.TYPESAFE_API_KEY?.trim()) return { status: 'failed', reason: 'api_key_missing' } as const;
  return { status: 'ready', reason: null } as const;
}

/** Authored labels remain provisional even if every authored expectation matches. */
export function evaluationStatuses(options: { completed: number; planned: number; failures: number; matches: number | null }) {
  const complete = options.completed === options.planned && options.failures === 0;
  return {
    status: complete ? 'completed' : 'failed',
    completionStatus: options.failures > 0 ? 'failed' : complete ? 'completed' : 'incomplete',
    authoredExpectationStatus: options.matches === null ? 'not_evaluated'
      : options.matches < options.completed - options.failures ? 'mismatched' : complete ? 'all_matched' : 'incomplete',
    humanReviewStatus: 'pending',
    exitCodeMeaning: HARNESS_EXIT_MEANING,
  } as const;
}

export function safeHarnessFailure(error: unknown): string {
  return error instanceof Error && /^(?:(?:invalid|missing|catalog|semantic|jev)_[a-z_]+|shared_provider_limiter_required)$/.test(error.message)
    ? error.message : 'harness_failed';
}

/** Keep one current-run file and one latest file. A new skip/failure replaces old success. */
export function createHarnessRun(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid_harness_name');
  const runAt = new Date().toISOString();
  const runId = `${runAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const path = `test-results/${name}-${runId}.json`;
  const latestPaths = new Set([`test-results/${name}.json`]);
  let last: Record<string, unknown> = {};
  const atomicWrite = async (target: string, text: string) => {
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  };
  const save = async (report: Record<string, unknown>) => {
    last = { schemaVersion: 1, ...report, runAt, updatedAt: new Date().toISOString(), exitCodeMeaning: HARNESS_EXIT_MEANING };
    const text = `${JSON.stringify(last, null, 2)}\n`;
    await atomicWrite(path, text);
    for (const latest of latestPaths) await atomicWrite(latest, text);
  };
  return {
    runAt, path, save,
    addLatest(name: string) {
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid_harness_name');
      latestPaths.add(`test-results/${name}.json`);
    },
    async fail(error: unknown) {
      const failureCode = safeHarnessFailure(error);
      process.exitCode = 1;
      try {
        await save({ requests: [], results: [], ...last, status: 'failed', completionStatus: 'failed',
          authoredExpectationStatus: last.authoredExpectationStatus ?? 'not_evaluated', humanReviewStatus: 'pending', failureCode });
      } catch { console.error('FAIL: harness_report_write_failed'); }
      console.error(`FAIL: ${failureCode}`);
    },
  };
}
export type HarnessRun = ReturnType<typeof createHarnessRun>;

export async function prepareLiveHarness(run: HarnessRun, flag: string, base: Record<string, unknown> = {}) {
  const gate = liveHarnessGate(flag);
  if (gate.status === 'ready') {
    await run.save({ ...base, status: 'running', completionStatus: 'running',
      authoredExpectationStatus: 'not_evaluated', humanReviewStatus: 'pending' });
    return true;
  }
  await run.save({ ...base, status: gate.status, completionStatus: 'not_started',
    authoredExpectationStatus: 'not_evaluated', humanReviewStatus: 'pending', reason: gate.reason,
    requests: [], results: [] });
  if (gate.status === 'failed') {
    console.error('FAIL: 実API実行を指定しましたが、TYPESAFE_API_KEYが未設定です。');
    process.exitCode = 1;
  } else console.log(`SKIP: 実API試験は${flag}=1を指定した場合だけ実行します。`);
  return false;
}
