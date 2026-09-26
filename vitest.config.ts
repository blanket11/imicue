import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['imicue-source', 'module', 'browser', 'development|production'] },
  test: { include: ['packages/**/*.test.ts', 'tests/integration/**/*.test.{ts,tsx}'], environment: 'node' },
});
