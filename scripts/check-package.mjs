import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(root.private, true);
for (const name of ['core', 'browser', 'server']) {
  const cwd = `packages/${name}`;
  const pkg = JSON.parse(await readFile(`${cwd}/package.json`, 'utf8'));
  assert.equal(pkg.private, true, '公開フラグは明示的な公開作業まで維持する');
  assert.equal(pkg.version, root.version);
  assert.equal(pkg.license, 'Apache-2.0');
  // Local manifest calculation only: no lifecycle scripts, registry, tarball or publish.
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const files = pack.files.map((file) => file.path);
  for (const path of ['package.json', 'README.md', 'dist/index.js', 'dist/index.d.ts', 'dist/LICENSE']) {
    assert.ok(files.includes(path), `${pkg.name}: missing ${path}`);
  }
  for (const path of files) {
    assert.match(path, /^(package\.json|README\.md|dist\/(?:LICENSE|[a-zA-Z0-9/_-]+\.(?:js|d\.ts)))$/, `${pkg.name}: unexpected packed file ${path}`);
  }
  assert.equal(await readFile(`${cwd}/dist/LICENSE`, 'utf8'), await readFile('LICENSE', 'utf8'));
  for (const [dependency, version] of Object.entries(pkg.dependencies ?? {})) {
    if (dependency.startsWith('@imicue/')) assert.equal(version, root.version);
  }
  console.log(JSON.stringify({ package: pkg.name, version: pkg.version, files: files.length, tarballBytes: pack.size, dryRun: true }));
}
