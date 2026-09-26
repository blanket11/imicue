import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'site',
  base: '/',
  envDir: false,
  resolve: { conditions: ['imicue-source', 'module', 'browser', 'development|production'] },
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
  build: { outDir: '../dist/site', emptyOutDir: true,
    rolldownOptions: { input: { main: resolve('site/index.html'), notFound: resolve('site/404.html') } },
  },
});
