import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  { ignores: ['**/dist/**', '**/.next/**', '**/out/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', '**/next-env.d.ts'] },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  { files: ['**/*.{ts,tsx}'], extends: [tseslint.configs.recommended] },
);
