import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHeaderName, validateHeaderValue } from 'node:http';

// Only the single global rule used by this site. This is not a Pages emulator.
export async function readSiteHeaders(path) {
  const lines = (await readFile(path, 'utf8')).trimEnd().split(/\r?\n/);
  assert.equal(lines.shift(), '/*', 'Site headers must use one global rule');
  const headers = {};
  for (const line of lines) {
    assert.ok(line.length <= 2_000, 'Pages header line is too long');
    const match = /^ {2}([A-Za-z-]+): (.+)$/.exec(line);
    assert.ok(match, 'Unsupported site header syntax');
    const [, name, value] = match;
    const key = name.toLowerCase();
    assert.ok(!Object.hasOwn(headers, key), 'Duplicate site header');
    validateHeaderName(key);
    validateHeaderValue(key, value);
    headers[key] = value;
  }
  assert.ok(headers['content-security-policy'], 'CSP is required');
  return headers;
}
