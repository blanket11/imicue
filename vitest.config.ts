import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    conditions: ['imicue-source', 'module', 'browser', 'development|production'],
    // Workspace imports in integration tests must not fall back to a stale dist build.
    alias: Object.fromEntries(['core', 'browser', 'server'].map((name) => [
      `@imicue/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
    ])),
  },
  test: { include: ['packages/**/*.test.ts', 'tests/integration/**/*.test.{ts,tsx}'], environment: 'node' },
});
