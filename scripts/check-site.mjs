import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readSiteHeaders } from './lib/site-headers.mjs';

const files = [];
async function inspect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      assert.equal(path, 'assets', 'Unexpected directory in site output');
      await inspect(`${directory}/${entry.name}`, `${path}/`);
    } else {
      assert.ok(entry.isFile(), 'Only regular site assets are allowed');
      assert.match(path, /^(?:index\.html|404\.html|_headers|assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:js|css))$/, `Unexpected site asset: ${path}`);
      const bytes = await readFile(`${directory}/${entry.name}`);
      assert.ok(bytes.length <= 25 * 1024 * 1024, `Pages file limit exceeded: ${path}`);
      assert.doesNotMatch(bytes.toString('utf8'), /TYPESAFE_API_KEY|@typesafe-ai\/sdk|https:\/\/api\.typesafe\.ai|IMICUE_SYNTHETIC_SECRET/);
      files.push(path);
    }
  }
}
await inspect('dist/site');
for (const name of ['index.html', '404.html', '_headers']) assert.ok(files.includes(name), `Missing ${name}`);
assert.ok(files.length <= 20_000, 'Pages file count exceeded');
assert.equal(await readFile('dist/site/_headers', 'utf8'), await readFile('site/public/_headers', 'utf8'));
await readSiteHeaders('dist/site/_headers');
for (const name of ['index.html', '404.html']) {
  const html = await readFile(`dist/site/${name}`, 'utf8');
  const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1].slice(1));
  assert.ok(references.length, `Missing built assets in ${name}`);
  for (const asset of references) assert.ok(files.includes(asset), `Missing referenced site asset: ${asset}`);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|\sstyle=|\son[a-z]+=/i, `Inline execution in ${name}`);
}
console.log(JSON.stringify({ siteAssets: files.length, headers: 'passed', outputBoundary: 'passed' }));
