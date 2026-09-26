import { defineConfig } from 'vite';

export default defineConfig({
  root: 'site',
  base: './',
  envDir: false,
  resolve: { conditions: ['imicue-source', 'module', 'browser', 'development|production'] },
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
  build: { outDir: '../dist/site', emptyOutDir: true },
});
