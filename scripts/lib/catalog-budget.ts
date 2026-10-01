import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Fetch } from '@typesafe-ai/sdk';

export const CATALOG_MAX_ATTEMPTS = 600;
export const CATALOG_ESTIMATED_USD_LIMIT = 2;
export const CATALOG_INPUT_USD_PER_MILLION = 0.042;
export interface CatalogRequestMetric {
  attemptId: string;
  requestBytes: number;
  responseBytes: number | null;
  questions: number;
  status: number | null;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: 'pending' | 'response' | 'failed';
}
interface Reservation extends CatalogRequestMetric { reservedUsd: number; accountedUsd: number; tag: string }
export interface CatalogBudgetState {
  schemaVersion: 1;
  maxAttempts: 600;
  estimatedUsdLimit: 2;
  inputUsdPerMillion: 0.042;
  attempts: Reservation[];
  runs: { suite: string; fixtureHash: string; startedAt: string }[];
}
const empty = (): CatalogBudgetState => ({ schemaVersion: 1, maxAttempts: 600, estimatedUsdLimit: 2,
  inputUsdPerMillion: 0.042, attempts: [], runs: [] });
const isMissing = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
interface LockOwner { schemaVersion: 1; pid: number; host: string; ownerId: string }

function ownerIsRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return false;
    // Permission errors and unknown OS errors cannot prove that the owner has stopped.
    throw new Error('catalog_budget_owner_unverified', { cause: error });
  }
}

/** Budget state is persisted before transport starts. A crash or missing usage retains its reservation. */
export class CatalogBudget {
  constructor(readonly path: string) {}
  private async read(): Promise<CatalogBudgetState> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as CatalogBudgetState;
      if (state.schemaVersion !== 1 || state.maxAttempts !== 600 || state.estimatedUsdLimit !== 2 || state.inputUsdPerMillion !== 0.042
        || !Array.isArray(state.attempts) || !Array.isArray(state.runs) || state.attempts.length > 600
        || state.attempts.some(row => !row || typeof row.attemptId !== 'string' || !Number.isFinite(row.accountedUsd) || row.accountedUsd < 0
          || !Number.isFinite(row.reservedUsd) || row.reservedUsd < 0)) throw new Error('invalid_catalog_budget');
      // Older ledger entries predate response-size measurement; unknown is never zero.
      state.attempts = state.attempts.map(row => ({ ...row, responseBytes: row.responseBytes ?? null }));
      return state;
    } catch (error) { if (isMissing(error)) return empty(); throw new Error('invalid_catalog_budget', { cause: error }); }
  }
  private async edit<T>(callback: (state: CatalogBudgetState) => T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`;
    const start = performance.now();
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw new Error('catalog_budget_lock_failed', { cause: error });
        if (performance.now() - start > 5_000) throw new Error('catalog_budget_locked', { cause: error });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const owner: LockOwner = { schemaVersion: 1, pid: process.pid, host: hostname(), ownerId: randomUUID() };
      await writeFile(`${lock}/owner.tmp`, JSON.stringify(owner), { mode: 0o600 });
      await rename(`${lock}/owner.tmp`, `${lock}/owner.json`);
      const state = await this.read();
      const result = callback(state);
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true });
    }
  }
  async inspect(): Promise<CatalogBudgetState> { return this.read(); }
  /** Offline, operator-triggered recovery. All catalog runners must remain stopped until it completes. */
  async recoverLock(options: { confirmNoRunningTests: boolean }): Promise<{ status: 'recovered' | 'not_locked'; retainedAttempts: number }> {
    if (options.confirmNoRunningTests !== true) throw new Error('catalog_budget_recovery_requires_stopped_tests');
    // Validate the ledger before touching its lock. Never reset reservations, including pending attempts.
    const state = await this.read();
    const lock = `${this.path}.lock`;
    let owner: LockOwner | undefined;
    try {
      const raw = JSON.parse(await readFile(`${lock}/owner.json`, 'utf8')) as Partial<LockOwner>;
      if (raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.pid) || !raw.pid || raw.pid < 1
        || typeof raw.host !== 'string' || typeof raw.ownerId !== 'string') throw new Error('catalog_budget_invalid_lock_owner');
      owner = raw as LockOwner;
    } catch (error) {
      // Old locks and a crash before owner.json was written need the explicit stopped-tests confirmation.
      if (!isMissing(error)) throw new Error('catalog_budget_invalid_lock_owner', { cause: error });
    }
    if (owner) {
      if (owner.host !== hostname()) throw new Error('catalog_budget_owner_unverified');
      if (ownerIsRunning(owner.pid)) throw new Error('catalog_budget_owner_running');
    }
    // Move only the stopped lock out of the acquisition path; the ledger bytes are untouched.
    const retired = `${lock}.${randomUUID()}.recovering`;
    try { await rename(lock, retired); }
    catch (error) {
      if (isMissing(error)) return { status: 'not_locked', retainedAttempts: state.attempts.length };
      throw new Error('catalog_budget_lock_recovery_failed', { cause: error });
    }
    await rm(retired, { recursive: true });
    return { status: 'recovered', retainedAttempts: state.attempts.length };
  }
  async startRun(suite: string, fixtureHash: string) {
    if (!/^(pilot|dev|holdout|stability|capacity|legacy)$/.test(suite) || !/^[a-f0-9]{64}$/.test(fixtureHash)) throw new Error('invalid_catalog_run');
    return this.edit(state => {
      const previousRuns = state.runs.filter(row => row.suite === suite).length;
      state.runs.push({ suite, fixtureHash, startedAt: new Date().toISOString() });
      return previousRuns;
    });
  }
  async reserve(requestBytes: number, questions: number, tag: string): Promise<CatalogRequestMetric> {
    if (!count(requestBytes) || !count(questions) || questions < 1 || !/^[a-z0-9_-]{1,160}$/.test(tag)) throw new Error('invalid_catalog_reservation');
    return this.edit(state => {
      // Deliberately conservative budgeting proxy, NOT a provider tokenizer or invoice guarantee.
      // Multiply bytes by question count only as a high reservation proxy; the provider
      // processes shared state once. This is not a strict token upper bound. Reconcile known usage.
      const reservedUsd = (requestBytes + 1024) * (questions + 1) / 1_000_000 * CATALOG_INPUT_USD_PER_MILLION;
      if (state.attempts.length >= CATALOG_MAX_ATTEMPTS) throw new Error('catalog_attempt_budget_exhausted');
      if (state.attempts.reduce((sum, row) => sum + row.accountedUsd, 0) + reservedUsd > CATALOG_ESTIMATED_USD_LIMIT) {
        throw new Error('catalog_cost_budget_exhausted');
      }
      const metric: CatalogRequestMetric = { attemptId: randomUUID(), requestBytes, questions, status: null, elapsedMs: 0,
        inputTokens: null, outputTokens: null, responseBytes: null, outcome: 'pending' };
      state.attempts.push({ ...metric, reservedUsd, accountedUsd: reservedUsd, tag });
      return metric;
    });
  }
  async settle(metric: CatalogRequestMetric): Promise<void> {
    await this.edit(state => {
      const row = state.attempts.find(item => item.attemptId === metric.attemptId);
      if (!row || row.outcome !== 'pending') throw new Error('unknown_catalog_attempt');
      Object.assign(row, metric);
      row.accountedUsd = metric.inputTokens === null ? row.reservedUsd : metric.inputTokens / 1_000_000 * CATALOG_INPUT_USD_PER_MILLION;
    });
  }
}

/** Only metrics are retained. Never persist request/response bodies, headers, keys, URLs or error messages. */
export function catalogMeasuredTransport(transport: Fetch, budget: CatalogBudget, tag: string) {
  const requests: CatalogRequestMetric[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url !== 'https://api.typesafe.ai/v1/systemone' || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('unexpected_catalog_endpoint');
    const body = JSON.parse(init.body) as { model?: unknown; questions?: Record<string, unknown> };
    if (body.model !== 'jev-1.13.0' || !body.questions || typeof body.questions !== 'object') throw new Error('invalid_catalog_request');
    if (init.signal?.aborted) throw new Error('catalog_request_aborted');
    const metric = await budget.reserve(Buffer.byteLength(init.body, 'utf8'), Object.keys(body.questions).length, tag);
    requests.push(metric);
    const start = performance.now();
    try {
      const response = await transport(url, { ...init, redirect: 'error' });
      metric.status = response.status;
      metric.outcome = 'response';
      try {
        const text = await response.clone().text();
        // Decoded UTF-8 body bytes, excluding transport headers/compression. Never persist text.
        metric.responseBytes = Buffer.byteLength(text, 'utf8');
        if (response.ok) {
          const data = JSON.parse(text) as { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
          metric.inputTokens = count(data.usage?.input_tokens) ? data.usage.input_tokens : null;
          metric.outputTokens = count(data.usage?.output_tokens) ? data.usage.output_tokens : null;
        }
      } catch { /* Unreadable bodies/absent usage remain unknown; retain the reservation. */ }
      return response;
    } catch { metric.outcome = 'failed'; throw new Error('catalog_transport_failed'); }
    finally {
      metric.elapsedMs = Math.round((performance.now() - start) * 100) / 100;
      await budget.settle(metric);
    }
  };
  return { fetch, requests };
}
