import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateSnapshot, type ResolvedEvaluationInput } from '@imicue/core';
import { observation, scaleDefinition, snapshot, NOW } from '../../core/test/fixtures.js';
import { buildJevRequest, buildJevRequests, createJevEngine, createMemoryProviderLimiter, JEV_MAX_BATCHES, JEV_MODEL, JEV_REQUEST_MAX_BYTES,
  JEV_STATE_QUESTION_MAX_BYTES, type ProviderUsageLimiter } from '../src/index.js';

function input(count = 100, length = 20): ResolvedEvaluationInput {
  const source = scaleDefinition(count);
  return { snapshot: snapshot(), page: {}, observations: [{ ...observation(), definition: source.signals.features! }],
    candidates: Object.entries(source.contents).map(([contentId, item]) => ({ contentId, ...item, description: 'あ'.repeat(length) })) };
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const signal = () => new AbortController().signal;
const data = (request: ReturnType<typeof buildJevRequest>) => ({ model: JEV_MODEL, usage: { input_tokens: 200, output_tokens: 10 },
  answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: 'score', score: id.startsWith('candidate-099') ? 2.7 : 0.1, confidence: 0.8 }])) });
const read = (init?: RequestInit) => JSON.parse(String(init?.body)) as ReturnType<typeof buildJevRequest>;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('C100 — complete bounded Jev batches with synthetic fetch only', () => {
  it.each([9, 21, 100])('evaluates all %i candidates and can select the last registered one', async (count) => {
    const source = scaleDefinition(count);
    const last = Object.keys(source.contents).at(-1)!;
    const seen: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const request = read(init); seen.push(...Object.keys(request.questions));
      const result = data(request);
      for (const [id, answer] of Object.entries(result.answers)) answer.score = id === last ? 2.7 : 0;
      return Response.json(result);
    });
    const engine = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch });
    const result = await evaluateSnapshot(source, snapshot(), engine, { now: NOW });
    expect(result).toMatchObject({ type: 'recommend', contentId: last });
    expect(result.assessments).toHaveLength(count);
    expect(new Set(seen).size).toBe(count);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(JEV_MAX_BATCHES);
  });
  it('keeps shared state byte-identical, moves candidates into questions, and deterministically packs all 100 descriptions', () => {
    const base = input(100, 1000);
    const source = { ...base, observations: ['features', 'cases'].map((signalId) => ({ ...base.observations[0]!, signalId,
      definition: { ...base.observations[0]!.definition, description: 'あ'.repeat(1000) } })) };
    const plan = buildJevRequests(source, JEV_MODEL);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.length).toBeLessThanOrEqual(JEV_MAX_BATCHES);
    expect(plan).toEqual(buildJevRequests({ ...source, candidates: [...source.candidates].reverse() }, JEV_MODEL));
    const state = JSON.stringify(plan[0]!.state);
    const ids: string[] = [];
    for (const request of plan) {
      expect(JSON.stringify(request.state)).toBe(state);
      expect(request.state).not.toHaveProperty('candidates');
      expect(bytes(request)).toBeLessThanOrEqual(JEV_REQUEST_MAX_BYTES);
      for (const [id, question] of Object.entries(request.questions)) {
        ids.push(id);
        expect(bytes({ model: request.model, state: request.state, questions: { [id]: question } })).toBeLessThanOrEqual(JEV_STATE_QUESTION_MAX_BYTES);
        expect(question).toMatchObject({ instructions: { candidate: { contentId: id, description: 'あ'.repeat(1000) } } });
        expect(question.criteria).toEqual(Object.values(plan[0]!.questions)[0]!.criteria);
      }
    }
    expect(new Set(ids).size).toBe(100);
    expect(() => buildJevRequest(source, JEV_MODEL)).toThrow('capacity_limit');
  });
  it('rejects a complete plan above eight requests before reserving or calling the API', async () => {
    const source = input(100, 2000);
    const limiter = createMemoryProviderLimiter();
    const reserve = vi.spyOn(limiter, 'reservePlan');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const engine = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch, providerLimiter: limiter });
    expect(() => buildJevRequests(source, JEV_MODEL)).toThrow('capacity_limit');
    await expect(engine.evaluate(source, { signal: signal() })).rejects.toThrow('capacity_limit');
    expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects duplicate IDs and oversized shared evidence before sending', async () => {
    const source = input(2);
    const oversized = { ...source, observations: [{ ...source.observations[0]!, definition: { ...source.observations[0]!.definition, description: 'あ'.repeat(9000) } }] };
    expect(() => buildJevRequests(oversized, JEV_MODEL)).toThrow('capacity_limit');
    expect(() => buildJevRequests({ ...source, candidates: [source.candidates[0]!, source.candidates[0]!] }, JEV_MODEL)).toThrow('capacity_limit');
  });
  it('reserves the entire plan before any attempt and rejects an insufficient whole-plan quota', async () => {
    const source = input();
    const count = buildJevRequests(source, JEV_MODEL).length;
    expect(count).toBeGreaterThan(1);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const engine = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch,
      providerLimiter: createMemoryProviderLimiter({ perDay: count - 1 }) });
    await expect(engine.evaluate(source, { signal: signal() })).rejects.toThrow('engine_unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds active attempts to two and reports numeric usage for every successful batch', async () => {
    let active = 0; let peak = 0;
    const onUsage = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      return Response.json(data(read(init)));
    });
    const source = input(100, 1000);
    const engine = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch, onUsage });
    const result = await engine.evaluate(source, { signal: signal() });
    expect(result.assessments).toHaveLength(100); expect(peak).toBe(2);
    expect(onUsage).toHaveBeenCalledTimes(buildJevRequests(source, JEV_MODEL).length);
    expect(onUsage.mock.calls[0]![0]).toEqual({ model: JEV_MODEL, inputTokens: 200, outputTokens: 10, batchIndex: 0, batchCount: fetch.mock.calls.length });
  });
  it.each(['missing', 'unknown', 'cross-batch', 'model', 'non-finite', 'confidence'])('discards the whole result after %s output in one batch', async (kind) => {
    const source = input();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const request = read(init); const result = data(request);
      if (Object.hasOwn(request.questions, 'candidate-000')) {
        const first = Object.keys(result.answers)[0]!;
        if (kind === 'missing') Reflect.deleteProperty(result.answers, first);
        if (kind === 'unknown') Object.assign(result.answers, { unknown: result.answers[first] });
        if (kind === 'cross-batch') { Reflect.deleteProperty(result.answers, first); Object.assign(result.answers, { 'candidate-099': { type: 'score', score: 3, confidence: 1 } }); }
        if (kind === 'model') result.model = 'jev-1.12.0';
        if (kind === 'non-finite') result.answers[first]!.score = NaN;
        if (kind === 'confidence') result.answers[first]!.confidence = 2;
      }
      return Response.json(result);
    });
    await expect(createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch }).evaluate(source, { signal: signal() })).rejects.toThrow('invalid_result');
  });
  it('aborts peer requests and never starts the remaining batches after a failed attempt', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      signals.push(init!.signal!);
      if (signals.length === 1) return new Response('failure', { status: 500 });
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    });
    await expect(createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch }).evaluate(input(100, 1000), { signal: signal() })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals[1]!.aborted).toBe(true);
  });
  it('shares concurrency across engine instances and holds slots until aborted local fetches settle', async () => {
    const limiter = createMemoryProviderLimiter({ concurrent: 1 });
    let finish!: () => void;
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return Response.json(data(read(init)));
    });
    const first = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch, providerLimiter: limiter });
    const second = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch, providerLimiter: limiter });
    const running = first.evaluate(input(2), { signal: controller.signal });
    const rejected = expect(running).rejects.toThrow('engine_unavailable');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); controller.abort();
    await expect(second.evaluate(input(2), { signal: signal() })).rejects.toThrow('engine_unavailable');
    expect(fetch).toHaveBeenCalledOnce(); finish(); await rejected;
    expect((await limiter.reservePlan(1)).ok).toBe(true);
  });
  it('enforces an overall three-second deadline across batches without retry', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json(data(read(init)))), 1100);
      init!.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
    }));
    const running = createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch }).evaluate(input(100, 1000), { signal: signal() });
    const rejected = expect(running).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000); await rejected;
    expect(fetch.mock.calls.length).toBeLessThan(buildJevRequests(input(100, 1000), JEV_MODEL).length);
  });
  it('does not reserve or send a pre-aborted evaluation', async () => {
    const limiter = createMemoryProviderLimiter(); const reserve = vi.spyOn(limiter, 'reservePlan');
    const fetch = vi.fn<typeof globalThis.fetch>(); const controller = new AbortController(); controller.abort();
    await expect(createJevEngine({ model: JEV_MODEL, apiKey: 'synthetic', fetch, providerLimiter: limiter }).evaluate(input(), { signal: controller.signal })).rejects.toThrow('engine_unavailable');
    expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a shared provider limiter in production and rejects excess configured concurrency', () => {
    expect(() => createJevEngine({ model: JEV_MODEL, mode: 'production' })).toThrow('shared_provider_limiter_required');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createJevEngine({ model: JEV_MODEL, mode: 'development' })).toThrow('shared_provider_limiter_required');
    const limiter: ProviderUsageLimiter = { shared: true, concurrent: 3, reservePlan: vi.fn() };
    expect(() => createJevEngine({ model: JEV_MODEL, providerLimiter: limiter })).toThrow('invalid_provider_concurrency');
  });
});
