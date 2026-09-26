import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRulesEngine, type DecisionEngine } from '@imicue/core';
import { definition, snapshot, NOW } from '../../core/test/fixtures.js';
import { createDecisionHandler, createMemoryLimiter, createNodeServer, type HandlerOptions } from '../src/index.js';

const origin = 'http://127.0.0.1:5183';
const request = (body: unknown = snapshot(), headers: HeadersInit = {}) => new Request('http://localhost/v1/decide', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const setup = (extra: Partial<HandlerOptions> = {}) => createDecisionHandler({
  definitions: [definition()], engine: createRulesEngine(), origins: [origin], mode: 'development', now: () => NOW, ...extra,
});
afterEach(() => vi.unstubAllEnvs());

describe('S01/S02 — fixed HTTP boundary', () => {
  it('resolves server definitions and returns a non-cacheable correlated decision', async () => {
    const response = await setup()(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(await response.json()).toMatchObject({ type: 'recommend', contentId: 'feature-guide', snapshotId: 'snapshot-1' });
  });
  it.each([
    { dictionary: {} }, { baseURL: 'https://attacker.example' }, { apiKey: 'secret' }, { prompt: 'override' },
    { pageId: 'constructor' }, { observations: [{ ...snapshot().observations[0], visibleMs: -1 }] },
    { observations: [...snapshot().observations, ...snapshot().observations] },
    { observations: [{ ...snapshot().observations[0], signalId: '__proto__' }] },
    { recent: Array(101).fill({ signalId: 'features', kind: 'click', source: 'direct', ageMs: 0 }) },
    { coverage: { truncated: false, extra: 'secret' } },
  ])('rejects untrusted fields before invoking the provider: %j', async (change) => {
    const engine = { ...createRulesEngine(), evaluate: vi.fn() };
    const response = await setup({ engine })(request({ ...snapshot(), ...change }));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":{"code":"invalid_snapshot"}}');
    expect(engine.evaluate).not.toHaveBeenCalled();
  });
  it('distinguishes unknown versions, origins, methods and content types', async () => {
    const handler = setup();
    expect((await handler(request({ ...snapshot(), definitionVersion: 'old' }))).status).toBe(409);
    expect((await handler(request(snapshot(), { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await handler(request(snapshot(), { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await handler(new Request('http://localhost/v1/decide', { headers: { origin } }))).status).toBe(405);
    const cors = await handler(new Request('http://localhost/v1/decide', { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type',
    } }));
    expect(cors.status).toBe(204);
    expect(cors.headers.has('access-control-allow-credentials')).toBe(false);
  });
  it('rejects malformed JSON and UTF-8 without reflecting the body', async () => {
    for (const body of ['{"secret":', new Uint8Array([0xff])]) {
      const response = await setup()(new Request('http://localhost/v1/decide', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body }));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('secret');
    }
  });
  it('counts streamed bytes, cancels excess input, and bounds stalled reads', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(32769)); }, cancel });
    const response = await setup()(new Request('http://localhost/v1/decide', { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body, duplex: 'half',
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await setup()(request({}, { 'content-length': '32769' }))).status).toBe(413);
    const stalled = new Request('http://localhost/v1/decide', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: new ReadableStream(), duplex: 'half' } as RequestInit);
    expect((await setup({ timeoutMs: 10 })(stalled)).status).toBe(504);
  });
  it('does not call a provider for preflight abstention', async () => {
    const engine = { ...createRulesEngine(), evaluate: vi.fn() };
    expect(await (await setup({ engine })(request(snapshot({ observations: [] })))).json()).toMatchObject({ type: 'abstain', reason: 'insufficient_evidence' });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });
  it('redacts provider errors and charges failed attempts globally', async () => {
    const engine: DecisionEngine = { name: 'jev', version: 'test', evaluate: vi.fn(async () => { throw new Error('secret-key-provider-body'); }) };
    const handler = setup({ engine, limiter: createMemoryLimiter({ perMinute: 1 }) });
    const failed = await handler(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('secret');
    const limited = await handler(request({ ...snapshot(), pageViewId: 'new-client', snapshotId: 'new-snapshot' }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(engine.evaluate).toHaveBeenCalledOnce();
  });
  it('holds concurrency until timed-out provider work actually settles', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const engine: DecisionEngine = { ...createRulesEngine(), evaluate: vi.fn(async (input, options) => { await pending; return createRulesEngine().evaluate(input, options); }) };
    const handler = setup({ engine, limiter: createMemoryLimiter({ concurrent: 1 }), timeoutMs: 10 });
    expect((await handler(request())).status).toBe(504);
    expect((await handler(request())).status).toBe(429);
    expect(engine.evaluate).toHaveBeenCalledOnce();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await handler(request())).status).toBe(200);
  });
  it('fails closed in production without an explicitly shared limiter', () => {
    expect(() => setup({ mode: 'production' })).toThrow('shared_limiter_required');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => setup()).toThrow('shared_limiter_required');
  });
  it.each(['http://example.com', 'https://example.com/path', 'https://example.com/'])('rejects unsafe origin config %s', (entry) => {
    expect(() => setup({ origins: [entry] })).toThrow('invalid_origin');
  });
});

describe('S03 — rolling global limits', () => {
  it('atomically reserves concurrency and never refunds request budgets', async () => {
    let time = 0;
    const limiter = createMemoryLimiter({ concurrent: 2, perMinute: 2, perDay: 3, now: () => time });
    const [a, b, c] = await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    if (a.ok) { a.release(); a.release(); }
    if (b.ok) b.release();
    expect(await limiter.acquire()).toMatchObject({ ok: false, retryAfterMs: 60_000 });
    time = 60_000;
    const d = await limiter.acquire();
    expect(d.ok).toBe(true);
    if (d.ok) d.release();
    time = 120_000;
    expect(await limiter.acquire()).toMatchObject({ ok: false, retryAfterMs: 86_280_000 });
    time = 86_400_000;
    expect((await limiter.acquire()).ok).toBe(true);
  });
});

it('Node adapter returns 413 on chunked overflow before the client finishes uploading', async () => {
  const server = createNodeServer(setup());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing_address');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/v1/decide', method: 'POST', headers: { origin, 'content-type': 'application/json' } }, (res) => {
        res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); });
      });
      req.on('error', reject);
      req.write(Buffer.alloc(32769, 32));
    });
    expect(status).toBe(413);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
