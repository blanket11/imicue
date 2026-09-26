import { describe, expect, it, vi } from 'vitest';
import { createRulesEngine, evaluateSnapshot } from '@imicue/core';
import { definition, snapshot, NOW } from '../../core/test/fixtures.js';
import { createRemoteEngine, type RemoteOptions } from '../src/remote.js';

const options = { definition: definition(), signal: new AbortController().signal, now: NOW };
const decision = () => evaluateSnapshot(definition(), snapshot(), createRulesEngine(), { now: NOW });
const remote = (fetch: typeof globalThis.fetch, extra: Partial<RemoteOptions> = {}) => createRemoteEngine({ endpoint: '/v1/decide', baseOrigin: 'https://example.test', fetch, ...extra });

describe('B08/C02 — remote transport with mocked HTTP', () => {
  it('posts only Snapshot with omitted credentials and no caching or redirect', async () => {
    const expected = await decision();
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      expect(url).toBe('https://example.test/v1/decide');
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error' });
      expect(JSON.parse(String(init?.body))).toEqual(snapshot());
      return Response.json(expected);
    });
    expect(await remote(fetch).evaluate(snapshot(), options)).toEqual(expected);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('avoids all network work for insufficient observations and capacity limits', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const engine = remote(fetch);
    expect(await engine.evaluate(snapshot({ observations: [] }), options)).toMatchObject({ reason: 'insufficient_evidence' });
    expect(await engine.evaluate(snapshot({ coverage: { truncated: true } }), options)).toMatchObject({ reason: 'capacity_limit' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['http://example.test/v1/decide', 'https://unknown.test/v1/decide', 'https://u:p@example.test/v1/decide', '/v1/decide?key=x'])('rejects endpoint %s', async (endpoint) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await remote(fetch, { endpoint }).evaluate(snapshot(), options)).toMatchObject({ reason: 'invalid_result' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([400, 409, 413])('latches HTTP %i until the engine is re-created', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('error', { status }));
    const engine = remote(fetch);
    const first = await engine.evaluate(snapshot(), options);
    expect(first).toMatchObject({ type: 'abstain', reason: status === 409 ? 'definition_mismatch' : status === 413 ? 'capacity_limit' : 'invalid_result' });
    await engine.evaluate(snapshot(), options);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('honors Retry-After and does not schedule an automatic retry', async () => {
    let now = NOW;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    const engine = remote(fetch, { now: () => now });
    await engine.evaluate(snapshot(), options);
    now += 59_000;
    await engine.evaluate(snapshot(), options);
    expect(fetch).toHaveBeenCalledOnce();
    now += 1000;
    await engine.evaluate(snapshot(), options);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['snapshotId', 'revision', 'pageViewId', 'definitionVersion', 'contentId', 'extra', 'maxAgeMs', 'score'])('rejects mismatched or invalid %s', async (field) => {
    const data = structuredClone(await decision());
    if (field === 'score') Object.assign(data, { assessments: data.assessments.map((entry, index) => index ? entry : { ...entry, score: 0.1 }) });
    else Object.assign(data, { [field]: field === 'revision' ? 99 : field === 'maxAgeMs' ? 60000 : 'invalid' });
    expect(await remote(async () => Response.json(data)).evaluate(snapshot(), options)).toMatchObject({ type: 'abstain', reason: 'invalid_result' });
  });
  it.each(['json', 'large', 'type', 'length'])('rejects and cancels %s response bodies', async (kind) => {
    const cancel = vi.fn();
    const fetch = async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(kind === 'large' ? ' '.repeat(32769) : 'not json'));
      if (kind === 'json') c.close();
    }, cancel }), { headers: { 'content-type': kind === 'type' ? 'text/html' : 'application/json', ...(kind === 'length' ? { 'content-length': '32769' } : {}) } });
    const result = await remote(fetch, { timeoutMs: 20 }).evaluate(snapshot(), options);
    expect(result).toMatchObject({ reason: 'invalid_result' });
    if (kind !== 'json') expect(cancel).toHaveBeenCalledOnce();
  });
  it('aborts stalled response bodies and ignores late fetch completion', async () => {
    const cancel = vi.fn();
    expect(await remote(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 10 }).evaluate(snapshot(), options)).toMatchObject({ reason: 'engine_unavailable' });
    expect(cancel).toHaveBeenCalledOnce();
    const controller = new AbortController();
    let finish!: (value: Response) => void;
    const pending = remote(async () => new Promise((resolve) => { finish = resolve; })).evaluate(snapshot(), { ...options, signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'engine_unavailable' });
    finish(Response.json(await decision()));
  });
  it('never falls back to local recommendations on a network failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('offline'); });
    expect(await remote(fetch).evaluate(snapshot(), options)).toMatchObject({ type: 'abstain', reason: 'engine_unavailable' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
