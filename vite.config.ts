import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { conditions: ['imicue-source', 'module', 'browser', 'development|production'] },
  root: 'examples/vanilla',
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    outDir: '../../dist/demo',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(['index.html', 'guides/features/index.html', 'guides/pricing/index.html', 'guides/cases/index.html']
        .map((file) => [file, resolve('examples/vanilla', file)])),
    },
  },
});
