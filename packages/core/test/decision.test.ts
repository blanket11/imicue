import { describe, expect, it, vi } from 'vitest';
import { canRecommend, createRulesEngine, evaluateSnapshot, validateDefinition, validateSnapshot } from '../src/index.js';
import type { CandidateAssessment, DecisionEngine, Definition, Snapshot } from '../src/index.js';
import { definition, NOW, observation, scenarios, snapshot } from './fixtures.js';

const options = { now: NOW, id: () => 'decision-1' };
const evaluate = (input = snapshot(), source = definition(), engine = createRulesEngine()) => evaluateSnapshot(validateDefinition(source), input, engine, options);

describe('C04 / D01-D04: deterministic rules and shared policy', () => {
  it('C04 produces identical values for the same input, clock and policy', async () => {
    const a = await evaluate();
    expect(a).toEqual(await evaluate());
    expect(a).toMatchObject({ type: 'recommend', contentId: 'feature-guide', policyVersion: 'rules-v1' });
    expect(a.assessments[0]?.score).toBeCloseTo(0.7);
    expect(a.assessments[0]).not.toHaveProperty('providerConfidence');
    expect(Object.isFrozen(a.assessments[0])).toBe(true);
  });

  it.each(scenarios)('$split fixture: $id (authored, awaiting human review)', async (scenario) => {
    const source = definition();
    const config = 'expiresFeature' in scenario ? {
      ...source, contents: { ...source.contents, 'feature-guide': { ...source.contents['feature-guide']!, availableUntil: '2026-09-25T23:59:59Z' } },
    } : source;
    const decision = await evaluate(scenario.input, config);
    expect(decision.type === 'recommend' ? decision.contentId : decision.reason).toBe(scenario.expected);
  });

  it('D01 treats no candidates as a valid abstention', async () => {
    const source = definition();
    const contents = Object.fromEntries(Object.entries(source.contents).map(([key, value]) => [key, { ...value, enabled: false }]));
    expect(await evaluate(snapshot(), { ...source, contents })).toMatchObject({ type: 'abstain', reason: 'no_eligible_content' });
  });

  it.each([
    { pageId: 'guide' },
    { outcomes: [{ contentId: 'feature-guide', kind: 'dismissed' as const, ageMs: 1 }] },
    { outcomes: [{ contentId: 'feature-guide', kind: 'completed' as const, ageMs: 1 }] },
    { observations: [observation(), observation('feature-guide', { source: 'recommendation', qualifiedViews: 1 })] },
  ])('D02 excludes current, dismissed, completed, or viewed candidates: %j', async (patch) => {
    const decision = await evaluate(snapshot(patch));
    expect(decision.type).toBe('abstain');
    expect(decision.assessments.map((item) => item.contentId)).not.toContain('feature-guide');
  });

  it.each([
    { enabled: false },
    { availableUntil: '2026-09-26T00:00:00Z' },
    { availableFrom: '2026-09-26T00:00:01Z' },
    { productId: 'foreign-product' },
  ])('D02 excludes disabled, expired, future, and other-product content: %j', async (patch) => {
    const source = definition();
    const decision = await evaluate(snapshot(), { ...source, contents: { ...source.contents, 'feature-guide': { ...source.contents['feature-guide']!, ...patch } } });
    expect(decision.assessments.map((item) => item.contentId)).not.toContain('feature-guide');
  });

  it('D03 adding recommendation observations does not increase direct scores', async () => {
    const a = await evaluate();
    const b = await evaluate(snapshot({ observations: [observation(), observation('pricing', { source: 'recommendation', clicks: 100 })] }));
    expect(b.assessments).toEqual(a.assessments);
  });

  it('uses max affinity and evidence, not summed topic tags or signal count', async () => {
    const source = definition();
    const contents = { ...source.contents, 'feature-guide': { ...source.contents['feature-guide']!, topicIds: ['features', 'pricing'], relatedSignalIds: ['features', 'pricing'] } };
    const decision = await evaluate(snapshot({ observations: [observation(), observation('pricing')] }), { ...source, contents });
    expect(decision.assessments.find((item) => item.contentId === 'feature-guide')?.score).toBeCloseTo(0.7);
  });

  it('applies topic affinity 0.5 and five-minute half life exactly', async () => {
    const source = definition();
    const contents = { ...source.contents, 'feature-guide': { ...source.contents['feature-guide']!, relatedSignalIds: [] } };
    const decision = await evaluate(snapshot({ observations: [observation('features', { lastSeenAgoMs: 300_000 })] }), { ...source, contents });
    expect(decision.assessments[0]?.score).toBeCloseTo(0.175);
    expect(decision).toMatchObject({ reason: 'below_threshold' });
  });

  it('does not add foreign-product observations to common candidate evidence', async () => {
    const source = definition();
    const contents = { ...source.contents, common: { title: 'Common', description: 'Shared synthetic guide', href: '/common', topicIds: ['features'], enabled: true } };
    expect(await evaluate(snapshot({ observations: [observation('foreign', { clicks: 1 })] }), { ...source, contents })).toMatchObject({ reason: 'insufficient_evidence' });
  });

  it('suppresses only actual shown outcomes younger than 60 seconds', async () => {
    expect(await evaluate(snapshot({ outcomes: [{ contentId: 'case-guide', kind: 'shown', ageMs: 59_999 }] }))).toMatchObject({ reason: 'suppressed' });
    expect(await evaluate(snapshot({ outcomes: [{ contentId: 'case-guide', kind: 'shown', ageMs: 60_000 }] }))).toMatchObject({ type: 'recommend' });
    expect(await evaluate(snapshot({ outcomes: [{ contentId: 'case-guide', kind: 'clicked', ageMs: 0 }] }))).toMatchObject({ type: 'recommend' });
  });

  it('returns capacity_limit without invoking the engine for truncation or 9 eligible candidates', async () => {
    const engine = { ...createRulesEngine(), evaluate: vi.fn() };
    expect(await evaluate(snapshot({ coverage: { truncated: true } }), definition(), engine)).toMatchObject({ reason: 'capacity_limit' });
    const source = definition();
    const contents = { ...source.contents, ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`extra-${index}`, source.contents['feature-guide']!])) };
    expect(await evaluate(snapshot(), { ...source, contents }, engine)).toMatchObject({ reason: 'capacity_limit' });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('returns definition_mismatch without evaluating a different dictionary', async () => {
    const engine = { ...createRulesEngine(), evaluate: vi.fn() };
    expect(await evaluate(snapshot({ definitionVersion: 'old' }), definition(), engine)).toMatchObject({ reason: 'definition_mismatch' });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('single candidate requires no runner-up margin', async () => {
    const source = definition();
    const contents = { ...source.contents, 'case-guide': { ...source.contents['case-guide']!, enabled: false }, 'pricing-guide': { ...source.contents['pricing-guide']!, enabled: false } };
    expect(await evaluate(snapshot({ observations: [observation('features', { visibleMs: 0 })] }), { ...source, contents })).toMatchObject({ type: 'recommend' });
  });
});

describe('D04-D05: adapter output contracts', () => {
  const malformed: unknown[] = [
    [], [{ contentId: 'unknown', score: 1, scoreKind: 'heuristic' }],
    [{ contentId: 'feature-guide', score: NaN, scoreKind: 'heuristic' }],
    [{ contentId: 'feature-guide', score: 1.01, scoreKind: 'heuristic' }],
    [{ contentId: 'feature-guide', score: -0.1, scoreKind: 'heuristic' }],
    [{ contentId: 'feature-guide', score: 0.7, scoreKind: 'heuristic', providerConfidence: 1 }],
  ];
  it.each(malformed)('rejects malformed assessments %j', async (assessments) => {
    const engine: DecisionEngine = { name: 'rules', version: 'mock', evaluate: async () => ({ assessments: assessments as CandidateAssessment[] }) };
    expect(await evaluate(snapshot(), definition(), engine)).toMatchObject({ reason: 'invalid_result', assessments: [] });
  });

  it.each([NaN, Infinity, -1, 1.01])('rejects %s in complete assessment arrays', async (score) => {
    const engine: DecisionEngine = { name: 'rules', version: 'mock', evaluate: async (input) => ({ assessments: input.candidates.map((candidate) => ({ contentId: candidate.contentId, score, scoreKind: 'heuristic' })) }) };
    expect(await evaluate(snapshot(), definition(), engine)).toMatchObject({ reason: 'invalid_result' });
  });

  it('rejects duplicated IDs even if the result count is complete', async () => {
    const engine: DecisionEngine = { name: 'rules', version: 'mock', evaluate: async (input) => ({ assessments: input.candidates.map(() => ({ contentId: 'feature-guide', score: 1, scoreKind: 'heuristic' })) }) };
    expect(await evaluate(snapshot(), definition(), engine)).toMatchObject({ reason: 'invalid_result' });
  });

  it('keeps rubric, raw score and provider confidence distinct in a mock adapter', async () => {
    const engine: DecisionEngine = { name: 'jev', version: 'mock-contract-only', evaluate: async (input) => ({ model: 'synthetic-mock', assessments: input.candidates.map((candidate) => ({ contentId: candidate.contentId, score: candidate.contentId === 'feature-guide' ? 1 : 0, scoreKind: 'rubric', rawScore: { value: candidate.contentId === 'feature-guide' ? 3 : 0, min: 0, max: 3 }, providerConfidence: 0.7 })) }) };
    expect(await evaluate(snapshot(), definition(), engine)).toMatchObject({ type: 'recommend', engine: { name: 'jev', model: 'synthetic-mock' }, assessments: [{ score: 1, rawScore: { value: 3, min: 0, max: 3 }, providerConfidence: 0.7 }, {}, {}] });
  });

  it('handles adapter rejection and pre-abort without hidden retry', async () => {
    const evaluateEngine = vi.fn().mockRejectedValue(new Error('Synthetic failure'));
    const engine: DecisionEngine = { name: 'rules', version: 'mock', evaluate: evaluateEngine };
    expect(await evaluate(snapshot(), definition(), engine)).toMatchObject({ reason: 'engine_unavailable' });
    expect(evaluateEngine).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    expect(await evaluateSnapshot(validateDefinition(definition()), snapshot(), engine, { ...options, signal: controller.signal })).toMatchObject({ reason: 'engine_unavailable' });
    expect(evaluateEngine).toHaveBeenCalledTimes(1);
  });
});

describe('snapshot and rendering boundary', () => {
  it.each([
    { observations: [observation('unknown')] },
    { observations: [observation(), observation()] },
    { observations: [observation('features', { visibleMs: 1_800_001 })] },
    { observations: [observation('features', { qualifiedViews: 1_001 })] },
    { observations: [observation('features', { lastSeenAgoMs: -1 })] },
    { observations: [observation('features', { clicks: 0.5 })] },
    { observations: [observation('features', { actions: 1 })] },
    { observations: [observation('action')] },
    { windowMs: 1_800_001 },
    { pageId: 'unknown' },
    { arbitraryMetadata: 'Synthetic' },
  ])('rejects malformed snapshot before adapter execution: %j', async (patch) => {
    const engine = { ...createRulesEngine(), evaluate: vi.fn() };
    const input = snapshot(patch);
    expect(() => validateSnapshot(input, definition())).toThrow();
    expect(await evaluate(input, definition(), engine)).toMatchObject({ reason: 'invalid_result' });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('revalidates revision, page view, expiry and suppression at display time', async () => {
    const source: Definition = validateDefinition(definition());
    const input: Snapshot = snapshot();
    const decision = await evaluate(input, source);
    expect(canRecommend(source, input, decision, { now: NOW, ageMs: 29_999 })).toBe(true);
    expect(canRecommend(source, input, decision, { now: NOW, ageMs: 30_000 })).toBe(false);
    expect(canRecommend(source, { ...input, revision: 2 }, decision, { now: NOW })).toBe(false);
    expect(canRecommend(source, { ...input, pageViewId: 'another-page-view' }, decision, { now: NOW })).toBe(false);
    expect(canRecommend(source, { ...input, outcomes: [{ contentId: 'case-guide', kind: 'shown', ageMs: 0 }] }, decision, { now: NOW })).toBe(false);
  });
});
