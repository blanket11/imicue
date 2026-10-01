import { CatalogBudget } from './lib/catalog-budget.js';

try {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--confirm-no-running-tests') {
    throw new Error('catalog_budget_recovery_requires_stopped_tests');
  }
  const result = await new CatalogBudget('test-results/catalog-budget.json').recoverLock({ confirmNoRunningTests: true });
  console.log(JSON.stringify(result));
} catch (error) {
  const code = error instanceof Error && /^catalog_budget_[a-z_]+$/.test(error.message)
    ? error.message : 'catalog_budget_lock_recovery_failed';
  console.error(code);
  process.exitCode = 1;
}
