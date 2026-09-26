import { build } from 'vite';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const { version } = JSON.parse(await readFile('packages/browser/package.json', 'utf8'));
const manifest = { version, files: {} };
for (const format of ['es', 'iife']) {
  const filename = `imicue-${version}${format === 'iife' ? '.iife' : ''}.js`;
  await build({ configFile: false, logLevel: 'warn',
    resolve: { conditions: ['imicue-source', 'module', 'browser', 'production'] },
    define: { __IMICUE_VERSION__: JSON.stringify(version) },
    plugins: [{ name: 'browser-boundary', generateBundle() {
      for (const id of this.getModuleIds()) {
        if (/packages\/server|@typesafe-ai|node_modules\/(react|react-dom)\//.test(id)) throw new Error('Unexpected browser dependency');
      }
    } }],
    build: { outDir: 'dist/browser', emptyOutDir: format === 'es', minify: true,
      lib: { entry: resolve(`scripts/${format === 'es' ? 'browser' : 'iife'}-entry.ts`), name: 'ImicueBundle', formats: [format], fileName: () => filename },
    },
  });
  const bytes = await readFile(`dist/browser/${filename}`);
  manifest.files[format] = { filename, bytes: bytes.length, gzipBytes: gzipSync(bytes).length,
    integrity: `sha384-${createHash('sha384').update(bytes).digest('base64')}` };
}
await writeFile('dist/browser/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await copyFile('LICENSE', 'dist/browser/LICENSE');
await copyFile('examples/vanilla/definition.js', 'dist/browser/definition.js');
await copyFile('examples/distribution/demo.js', 'dist/browser/demo.js');
await copyFile('examples/distribution/demo.css', 'dist/browser/demo.css');
await copyFile('examples/vanilla/styles.css', 'dist/browser/styles.css');
await writeFile('dist/browser/es-entry.js', `import * as api from './${manifest.files.es.filename}';\nimport { mount } from './demo.js';\nmount(api);\n`);
await writeFile('dist/browser/iife-entry.js', "import { mount } from './demo.js';\nmount(window.Imicue);\n");
for (const format of ['es', 'iife']) {
  const template = await readFile(`examples/distribution/${format}.html`, 'utf8');
  const asset = manifest.files[format];
  const folder = `dist/browser/${format}`;
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/index.html`, template.replaceAll('{{filename}}', asset.filename).replaceAll('{{integrity}}', asset.integrity));
}
console.log(JSON.stringify(manifest));
