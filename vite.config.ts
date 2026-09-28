import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { conditions: ['imicue-source', 'module', 'browser', 'development|production'] },
  // SDK regression fixtures, separate from the default PACELET demo.
  root: 'examples/vanilla',
  server: { host: '127.0.0.1', port: 5194, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    outDir: '../../dist/demo',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(['index.html', 'guides/features/index.html', 'guides/pricing/index.html', 'guides/cases/index.html', 'catalog/index.html', 'catalog/guide.html', 'collection/index.html']
        .map((file) => [file, resolve('examples/vanilla', file)])),
    },
  },
});
