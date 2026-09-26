import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

// This is a local inspection artifact, not a published package or an M4 distribution build.
const result = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    minify: true,
    lib: { entry: resolve('scripts/bundle-entry.ts'), formats: ['es'] },
  },
  plugins: [{
    name: 'imicue-inspection',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (/packages\/server|@typesafe-ai|node_modules\/(react|react-dom)\//.test(id)) {
          throw new Error(`Unexpected browser dependency: ${id}`);
        }
      }
    },
  }],
});
const outputs = Array.isArray(result) ? result : [result];
let bytes = 0;
let gzipBytes = 0;
for (const output of outputs) {
  if (!('output' in output)) throw new Error('Unexpected watch build');
  for (const chunk of output.output) {
    if (chunk.type !== 'chunk') continue;
    if (/TYPESAFE_API_KEY|@typesafe-ai|NEXT_PUBLIC_/.test(chunk.code)) throw new Error('Unexpected provider or key configuration in browser bundle');
    bytes += Buffer.byteLength(chunk.code);
    gzipBytes += gzipSync(chunk.code).byteLength;
  }
}
console.log(JSON.stringify({ artifact: 'Browser + Core + Rules', bytes, gzipBytes, targetGzipBytes: 25 * 1024 }));
if (gzipBytes > 25 * 1024) throw new Error('Browser bundle exceeds the initial 25 KiB gzip target');
