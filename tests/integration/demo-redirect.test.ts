import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoRedirect } from '../../scripts/dev-demo.mjs';
import type { AddressInfo } from 'node:net';

// Exercise actual HTTP responses: old bookmarks must land on the same storage origin.
describe('former product demo address', () => {
  const server = createDemoRedirect();
  let origin: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  it.each(['/', '/features/', '/resources/?example=1'])('redirects %s to the current demo without caching', async (path) => {
    const response = await fetch(origin + path, { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:5183' + path);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not forward form submissions', async () => {
    const response = await fetch(origin + '/contact/', { method: 'POST', body: 'example', redirect: 'manual' });
    expect(response.status).toBe(405);
    expect(response.headers.get('location')).toBeNull();
  });
  it('does not accept a host supplied in the request path as the redirect destination', async () => {
    const response = await fetch(origin + '//example.invalid/features/', { redirect: 'manual' });
    expect(new URL(response.headers.get('location')!).origin).toBe('http://127.0.0.1:5183');
  });
});
