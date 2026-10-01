import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildJevRequests, JEV_MODEL } from '@imicue/server';
import { validateDefinition, validateSnapshot } from '@imicue/core';
import { CatalogBudget, catalogMeasuredTransport } from '../../scripts/lib/catalog-budget.js';
import { catalogEvaluationInput, catalogFixtures, makeCatalogFixture } from '../../scripts/lib/catalog-fixtures.js';
import { buildCatalogChoiceRequest, planCatalogEvaluation, runCatalogEvaluation } from '../../scripts/lib/catalog-evaluation.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function budget() {
  const path = await mkdtemp(join(tmpdir(), 'imicue-catalog-test-'));
  directories.push(path);
  return new CatalogBudget(join(path, 'budget.json'));
}
const requestBody = JSON.stringify({model: JEV_MODEL, state: {}, questions: {q: { type: 'score', criteria: ['no', 'yes'] }}});
const mockScoresFor = (targetId: string) => async (_url: string, init?: RequestInit) => {
  const request = JSON.parse(String(init?.body));
  return Response.json({ model: JEV_MODEL, usage: {input_tokens: 123, output_tokens: 4},
    answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: 'score',
      score: id === targetId ? 3 : 0, confidence: 0.9, legend: {}, probabilities: {} }])) });
};
const mockScores = mockScoresFor('c099');

describe('catalog fixtures and offline plans', () => {
  it('has family-disjoint development and holdout labels, zero-click qualified browsing, and 100 candidates', () => {
    const development = catalogFixtures('dev');
    const holdout = catalogFixtures('holdout');
    expect(development).toHaveLength(30);
    expect(holdout).toHaveLength(100);
    const devFamilies = new Set(development.map(row => row.familyId));
    for (const fixture of [...development, ...holdout]) {
      const definition = validateDefinition(fixture.source);
      expect(() => validateSnapshot(fixture.snapshot, definition)).not.toThrow();
      expect(Object.keys(definition.contents)).toHaveLength(100);
      expect(fixture.snapshot.observations.reduce((sum, row) => sum + row.qualifiedViews, 0)).toBe(2);
      expect(fixture.snapshot.observations.every(row => row.clicks === 0 && row.actions === 0)).toBe(true);
      expect(fixture.acceptable.every(id => id === 'abstain' || Object.hasOwn(definition.contents, id))).toBe(true);
      expect(fixture.humanReview).toBe('pending_ai_authored');
    }
    expect(holdout.every(row => !devFamilies.has(row.familyId))).toBe(true);
    // Even distractor subjects do not leak the active dev theme into holdout dictionaries.
    expect(JSON.stringify(holdout)).not.toContain('文書の社外共有リンク');
    expect(JSON.stringify(development)).not.toContain('動画の音声から字幕');
  });
  it('keeps exactly the same catalog for feature, case, paraphrase and unrelated visitors', () => {
    const fixtures = ['features', 'cases', 'paraphrase', 'none'].map(situation => makeCatalogFixture({ situation: situation as 'features' | 'cases' | 'paraphrase' | 'none' }));
    for (const fixture of fixtures.slice(1)) expect(fixture.source).toEqual(fixtures[0]!.source);
    expect(fixtures[0]!.acceptable).not.toEqual(fixtures[1]!.acceptable);
    expect(fixtures[0]!.snapshot.observations).not.toEqual(fixtures[1]!.snapshot.observations);
    const held = catalogFixtures('holdout');
    expect(held[0]!.source).toEqual(held[1]!.source);
    expect(new Set(held.filter(row => row.situation === 'features').map(row => row.acceptable[0])).size).toBeGreaterThan(10);
  });
  it('changes actual provider question positions through ID permutation, while preserving semantic identity', () => {
    const original = makeCatalogFixture();
    const reverse = makeCatalogFixture({order:'reverse'});
    expect(original.acceptable).toEqual(['c099']);
    expect(reverse.acceptable).toEqual(['c000']);
    expect(reverse.canonicalIds.c000).toBe('c099');
    expect(original.source.contents.c099!.description).toBe(reverse.source.contents.c000!.description);
    const originalRequest = buildJevRequests(catalogEvaluationInput(original), JEV_MODEL);
    const reversedRequest = buildJevRequests(catalogEvaluationInput(reverse), JEV_MODEL);
    expect(JSON.stringify(originalRequest)).not.toBe(JSON.stringify(reversedRequest));
  });
  it('plans long all-candidate Score within production budgets and reports Choice overflow separately', () => {
    const plan = planCatalogEvaluation({suite:'pilot', method:'both'});
    expect(plan.fixtureCount).toBe(12);
    const full = plan.rows.filter(row => row.method === 'all-score');
    expect(full.every(row => !row.blocked && row.maximumRequests <= 8 && row.requestBytes.every(size => size <= 65536))).toBe(true);
    expect(plan.rows.filter(row => row.blocked).every(row => row.method === 'choice-top3' && row.id.includes('-long-'))).toBe(true);
    expect(plan.maximumRequests).toBeLessThanOrEqual(100);
    expect(() => buildCatalogChoiceRequest(catalogEvaluationInput(makeCatalogFixture({situation:'long'})))).toThrow('capacity_limit');
  });
});

describe('persistent evaluation spending limits (mock transport only)', () => {
  it('serializes independent instances and persists attempts before failed transports, without secret bodies', async () => {
    const store = await budget();
    const second = new CatalogBudget(store.path);
    const seen: number[] = [];
    const transport = vi.fn(async () => {
      seen.push((await store.inspect()).attempts.length);
      throw new Error('synthetic-secret-error-body');
    });
    const a = catalogMeasuredTransport(transport, store, 'first');
    const b = catalogMeasuredTransport(transport, second, 'second');
    await Promise.allSettled([a.fetch('https://api.typesafe.ai/v1/systemone', {method:'POST', body:requestBody}),
      b.fetch('https://api.typesafe.ai/v1/systemone', {method:'POST', body:requestBody})]);
    const state = await store.inspect();
    expect(state.attempts).toHaveLength(2);
    expect(seen.every(count => count > 0)).toBe(true);
    expect(state.attempts.every(row => row.outcome === 'failed' && row.inputTokens === null && row.accountedUsd === row.reservedUsd)).toBe(true);
    expect(await readFile(store.path, 'utf8')).not.toContain('synthetic-secret-error-body');
  });
  it('reconciles numerical usage and blocks at the cumulative 600 attempt or $2 accounting limit', async () => {
    const store = await budget();
    const measured = catalogMeasuredTransport(async () => Response.json({usage:{input_tokens:100, output_tokens:0}, private:'do-not-retain'}), store, 'usage');
    await measured.fetch('https://api.typesafe.ai/v1/systemone', {method:'POST', body:requestBody});
    const state = await store.inspect();
    expect(state.attempts[0]!.accountedUsd).toBeCloseTo(0.0000042);
    expect(state.attempts[0]!.responseBytes).toBe(Buffer.byteLength(JSON.stringify({usage:{input_tokens:100, output_tokens:0}, private:'do-not-retain'}), 'utf8'));
    expect(JSON.stringify(state)).not.toContain('do-not-retain');
    const template = state.attempts[0]!;
    state.attempts = Array.from({length:600}, (_, index) => ({...template, attemptId:`synthetic-${index}`}));
    await writeFile(store.path, JSON.stringify(state));
    await expect(store.reserve(100, 1, 'blocked')).rejects.toThrow('catalog_attempt_budget_exhausted');
    state.attempts = [{...template, accountedUsd:2}];
    await writeFile(store.path, JSON.stringify(state));
    await expect(store.reserve(100, 1, 'blocked')).rejects.toThrow('catalog_cost_budget_exhausted');
  });
  it('reads legacy budget entries as unknown response size without resetting attempts', async () => {
    const store = await budget();
    await store.reserve(100, 1, 'legacy');
    const raw = JSON.parse(await readFile(store.path, 'utf8'));
    delete raw.attempts[0].responseBytes;
    await writeFile(store.path, JSON.stringify(raw));
    const state = await store.inspect();
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]!.responseBytes).toBeNull();
  });
  it('refuses malformed ledgers and unexpected endpoints without any network attempt', async () => {
    const store = await budget();
    await writeFile(store.path, '{broken');
    await expect(store.reserve(100, 1, 'test')).rejects.toThrow('invalid_catalog_budget');
    const transport = vi.fn(mockScores);
    const measured = catalogMeasuredTransport(transport, store, 'test');
    await expect(measured.fetch('https://elsewhere.invalid/', {method:'POST', body:requestBody})).rejects.toThrow('unexpected_catalog_endpoint');
    expect(transport).not.toHaveBeenCalled();
    expect(await readFile(store.path, 'utf8')).toBe('{broken');
  });
});

describe('catalog live runner with offline mock transport', () => {
  it('assesses all 100 candidates through production policy, accounts every batch, and tracks reused holdout runs', async () => {
    const store = await budget();
    const targetId = catalogFixtures('holdout')[0]!.acceptable[0]!;
    const transport = mockScoresFor(targetId);
    const report = await runCatalogEvaluation({suite:'holdout', method:'all-score', limit:1,
      apiKey:'synthetic-key', transport, budget:store});
    expect(report.results[0]).toMatchObject({actual:targetId, failed:false, eligibleCount:100, assessedCount:100, scope:'all-candidates', proposedMatch:true});
    expect(report.holdoutStatus).toBe('first_live_use');
    expect(report).toMatchObject({ completionStatus: 'completed', authoredExpectationStatus: 'all_matched', humanReviewStatus: 'pending' });
    expect(report.results[0]!.requests.length).toBeGreaterThan(1);
    expect(report.summary[0]!.precision.value).toBe(1);
    expect(report.summary[0]!.responseBytes).toBeGreaterThan(0);
    expect(report.summary[0]!.responseBytesKnownRequests).toBe(report.summary[0]!.requests);
    expect(report.results[0]!.snapshotBytes).toBeGreaterThan(0);
    expect(report.summary[0]!.inputTokens).toBe(123 * report.summary[0]!.requests);
    const again = await runCatalogEvaluation({suite:'holdout', method:'all-score', limit:1,
      apiKey:'synthetic-key', transport, budget:store});
    expect(again.holdoutStatus).toBe('previously_used');
    expect((await store.inspect()).attempts.length).toBe(report.summary[0]!.requests * 2);
    expect(JSON.stringify(again)).not.toContain('synthetic-key');
  });
  it('marks top-three as a partial-scope experiment and computes recall without a production Decision', async () => {
    const store = await budget();
    const transport = async (url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (!request.questions.select) return mockScores(url, init);
      return Response.json({model:JEV_MODEL, usage:{input_tokens:200, output_tokens:10}, answers:{ select:{type:'choice', choice:'c099', confidence:0.8,
        probabilities:Object.fromEntries(Object.keys(request.questions.select.criteria).map(id => [id, id === 'c099' ? 0.8 : id === 'c098' || id === 'c097' ? 0.1 : 0]))}}});
    };
    const report = await runCatalogEvaluation({suite:'pilot', method:'choice-top3', limit:1,
      apiKey:'synthetic-key', transport, budget:store});
    expect(report.results[0]).toMatchObject({actual:'c099', scope:'shortlist-only', eligibleCount:100, assessedCount:3, shortlistHit:true});
    expect(report.results[0]).not.toHaveProperty('decision');
    expect(report.summary[0]!.shortlistHit.value).toBe(1);
  });
  it('shares a three-second deadline across Choice and its Score stage', async () => {
    const store = await budget();
    let scoreSignal: AbortSignal | null | undefined;
    const transport = async (_url: string, init?: RequestInit): Promise<Response> => {
      const request = JSON.parse(String(init?.body));
      if (request.questions.select) {
        await new Promise(resolve => setTimeout(resolve, 1_200));
        return Response.json({model:JEV_MODEL, usage:{input_tokens:1, output_tokens:0}, answers:{select:{type:'choice', choice:'c099', confidence:1,
          probabilities:Object.fromEntries(Object.keys(request.questions.select.criteria).map(id => [id, id === 'c099' ? 1 : 0]))}}});
      }
      scoreSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('mock-aborted'));
        if (scoreSignal?.aborted) abort();
        else scoreSignal?.addEventListener('abort', abort, {once:true});
      });
    };
    const start = performance.now();
    const report = await runCatalogEvaluation({suite:'pilot', method:'choice-top3', limit:1,
      apiKey:'synthetic-key', transport, budget:store});
    expect(performance.now() - start).toBeLessThan(3_700);
    expect(scoreSignal?.aborted).toBe(true);
    expect(report.results[0]).toMatchObject({failed:true, actual:'engine_unavailable'});
    expect(report.results[0]!.requests).toHaveLength(2);
    expect((await store.inspect()).attempts).toHaveLength(2);
  });
  it('stops after a technical failure and does not count it as a correct abstention or retry', async () => {
    const store = await budget();
    const transport = vi.fn(async () => new Response('secret-error', {status:429}));
    const report = await runCatalogEvaluation({suite:'dev', method:'all-score', limit:2,
      apiKey:'synthetic-key', transport, budget:store});
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({failed:true, proposedMatch:false, actual:'engine_unavailable', assessedCount:0});
    // Up to two parallel requests may already be in flight. None is retried.
    expect(transport.mock.calls.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(report)).not.toMatch(/secret-error|synthetic-key/);
  });
});

describe('resource measurements and metadata (mock transport only)', () => {
  it('keeps metadata input-free and plans 200/1000-character capacity and fixed legacy cases', async () => {
    const { catalogEvaluationMetadata } = await import('../../scripts/lib/catalog-evaluation.js');
    const { planCatalogMeasurement } = await import('../../scripts/lib/catalog-capacity.js');
    const metadata = catalogEvaluationMetadata();
    expect(metadata.policyVersion).toBe('jev-rubric-v4');
    expect(metadata.promptHash).toMatch(/^[a-f0-9]{64}$/);
    const capacity = planCatalogMeasurement('capacity');
    expect(capacity.rows.map(row => [row.descriptionChars, row.candidates])).toEqual([[200,100],[1000,100]]);
    expect(capacity.maximumRequests).toBe(12);
    expect(capacity.rows.every(row => row.requestBytes.every(size => size <= 65536))).toBe(true);
    const legacy = planCatalogMeasurement('legacy');
    expect(legacy.rows.map(row => row.id)).toEqual(['Q01','Q02','Q12']);
    expect(legacy.maximumRequests).toBe(3);
    expect(capacity.promptHash).toBe(metadata.promptHash);
  });
  it('pads synthetic descriptions without truncating meaning and measures every candidate without quality claims', async () => {
    const { runCatalogMeasurement } = await import('../../scripts/lib/catalog-capacity.js');
    const store = await budget();
    const lengths = new Set<number>();
    const transport = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      for (const value of Object.values(body.questions)) {
        const question = value as {instructions:{candidate:{description:string}}};
        lengths.add(question.instructions.candidate.description.length);
      }
      return mockScores(url, init);
    };
    const report = await runCatalogMeasurement({suite:'capacity', apiKey:'synthetic-key', transport, budget:store});
    expect(lengths).toEqual(new Set([200,1000]));
    expect(report.results.every(row => row.completedAllCandidates && row.assessedCount === 100 && row.proposedMatch === null && row.actual === null)).toBe(true);
    expect(report.summary.requests).toBe(12);
    expect(report.results.every(row => row.decisionBodyBytes > 0 && row.snapshotBytes > 0)).toBe(true);
    expect(report.summary.responseBytes).toBeGreaterThan(0);
    expect((await store.inspect()).attempts).toHaveLength(12);
  });
  it('uses the same cumulative ledger for the three legacy regressions', async () => {
    const { runCatalogMeasurement } = await import('../../scripts/lib/catalog-capacity.js');
    const store = await budget();
    const report = await runCatalogMeasurement({suite:'legacy', apiKey:'synthetic-key', transport:mockScoresFor('c1'), budget:store});
    expect(report.results).toHaveLength(3);
    expect(report.results.every(row => row.proposedMatch === true && row.completedAllCandidates)).toBe(true);
    expect(report.summary.requests).toBe(3);
    expect((await store.inspect()).attempts).toHaveLength(3);
  });
});
