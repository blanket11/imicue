import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('dist/browser/manifest.json', 'utf8'));
for (const [format, entry] of Object.entries(manifest.files)) {
  const bytes = await readFile(`dist/browser/${entry.filename}`);
  assert.doesNotMatch(bytes.toString(), /TYPESAFE_API_KEY|@typesafe-ai|NEXT_PUBLIC_|node_modules\/(react|react-dom)/);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(gzipSync(bytes).length, entry.gzipBytes);
  assert.equal(`sha384-${createHash('sha384').update(bytes).digest('base64')}`, entry.integrity);
  assert.ok(entry.gzipBytes <= 25 * 1024, 'Browser + Core + Rules exceeds 25 KiB gzip');
  console.log(JSON.stringify({ format, ...entry, targetGzipBytes: 25 * 1024 }));
}
