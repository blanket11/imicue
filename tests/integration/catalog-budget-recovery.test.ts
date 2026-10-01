import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogBudget } from '../../scripts/lib/catalog-budget.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'imicue-budget-recovery-'));
  directories.push(directory);
  const budget = new CatalogBudget(join(directory, 'test-results/catalog-budget.json'));
  await budget.reserve(100, 1, 'pending-before-crash');
  return { directory, budget, before: await readFile(budget.path, 'utf8') };
}
async function lock(budget: CatalogBudget, pid?: number, host = hostname()) {
  await mkdir(`${budget.path}.lock`);
  if (pid !== undefined) await writeFile(`${budget.path}.lock/owner.json`, JSON.stringify({
    schemaVersion: 1, pid, host, ownerId: randomUUID(),
  }));
}

describe('offline catalog budget lock recovery', () => {
  it('refuses recovery without stopped-tests confirmation and leaves the ledger and lock intact', async () => {
    const { budget, before } = await fixture();
    await lock(budget);
    await expect(budget.recoverLock({ confirmNoRunningTests: false })).rejects.toThrow('catalog_budget_recovery_requires_stopped_tests');
    expect(await readFile(budget.path, 'utf8')).toBe(before);
    await access(`${budget.path}.lock`);
  });
  it('refuses a running owner even when the operator supplied confirmation', async () => {
    const { budget, before } = await fixture();
    await lock(budget, process.pid);
    await expect(budget.recoverLock({ confirmNoRunningTests: true })).rejects.toThrow('catalog_budget_owner_running');
    expect(await readFile(budget.path, 'utf8')).toBe(before);
    await access(`${budget.path}.lock/owner.json`);
  });
  it('recovers a killed owner while preserving pending reservations and continuing the cumulative count', async () => {
    const { budget, before } = await fixture();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const exited = once(child, 'exit');
    try {
      await once(child, 'spawn');
      await lock(budget, child.pid!);
      child.kill('SIGKILL');
      await exited;
      expect(await budget.recoverLock({ confirmNoRunningTests: true })).toEqual({ status: 'recovered', retainedAttempts: 1 });
      expect(await readFile(budget.path, 'utf8')).toBe(before);
      expect((await budget.inspect()).attempts[0]?.outcome).toBe('pending');
      await budget.reserve(100, 1, 'after-recovery');
      expect((await budget.inspect()).attempts).toHaveLength(2);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
  });
  it('handles old locks or crashes before owner metadata was published, without altering ledger bytes', async () => {
    const { budget, before } = await fixture();
    await lock(budget);
    await writeFile(`${budget.path}.lock/owner.tmp`, '{interrupted');
    expect(await budget.recoverLock({ confirmNoRunningTests: true })).toEqual({ status: 'recovered', retainedAttempts: 1 });
    expect(await readFile(budget.path, 'utf8')).toBe(before);
    expect(await budget.recoverLock({ confirmNoRunningTests: true })).toEqual({ status: 'not_locked', retainedAttempts: 1 });
  });
  it('does not guess about owners on another machine or damaged ledgers', async () => {
    const { budget } = await fixture();
    await lock(budget, process.pid, `${hostname()}-other`);
    await expect(budget.recoverLock({ confirmNoRunningTests: true })).rejects.toThrow('catalog_budget_owner_unverified');
    await writeFile(budget.path, '{broken');
    await expect(budget.recoverLock({ confirmNoRunningTests: true })).rejects.toThrow('invalid_catalog_budget');
    expect(await readFile(budget.path, 'utf8')).toBe('{broken');
    await access(`${budget.path}.lock/owner.json`);
  });
  it('runs the recovery CLI offline in a separate working directory and retains the original ledger', async () => {
    const { directory, budget, before } = await fixture();
    await lock(budget);
    const output = execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../../scripts/recover-catalog-budget.ts', import.meta.url)), '--confirm-no-running-tests'],
    { cwd: directory, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual({ status: 'recovered', retainedAttempts: 1 });
    expect(await readFile(budget.path, 'utf8')).toBe(before);
  });
});
