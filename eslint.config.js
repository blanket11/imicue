import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  { ignores: ['**/dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  { files: ['**/*.ts'], extends: [tseslint.configs.recommended] },
);
