import { describe, expect, it, vi } from 'vitest';
import { canRecommend, evaluateSnapshot, validateDecision, type DecisionEngine, type ResolvedEvaluationInput } from '../src/index.js';
import { definition, NOW, observation, snapshot } from './fixtures.js';

function mockEngine() {
  const evaluate = vi.fn(async (input: ResolvedEvaluationInput) => ({ assessments: input.candidates.map(({ contentId }) => ({
    contentId, score: contentId === 'feature-guide' ? 0.9 : 0,
    scoreKind: 'rubric' as const, rawScore: { value: contentId === 'feature-guide' ? 2.7 : 0, min: 0, max: 3 }, providerConfidence: 0.9,
  })) }));
  return { name: 'jev' as const, version: 'mock-freshness', evaluate } satisfies DecisionEngine;
}

describe('Jev evidence freshness (policy v2)', () => {
  it.each([300_001, 600_000, 1_800_000])('skips inference for observations %i ms old, even with explicit actions', async (age) => {
    const engine = mockEngine();
    const input = snapshot({ observations: [observation('features', { clicks: 1, lastSeenAgoMs: age })] });
    expect(await evaluateSnapshot(definition(), input, engine, { now: NOW })).toMatchObject({
      type: 'abstain', reason: 'insufficient_evidence', policyVersion: 'jev-rubric-v2', assessments: [],
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('includes the five-minute boundary and filters old events for an otherwise fresh signal', async () => {
    const engine = mockEngine();
    const input = snapshot({ observations: [observation('features', { lastSeenAgoMs: 300_000 }), observation('pricing', { lastSeenAgoMs: 600_000 })],
      recent: [
        { signalId: 'features', source: 'direct', kind: 'click', ageMs: 300_000 },
        { signalId: 'features', source: 'direct', kind: 'click', ageMs: 300_001 },
        { signalId: 'pricing', source: 'direct', kind: 'click', ageMs: 600_000 },
      ] });
    const decision = await evaluateSnapshot(definition(), input, engine, { now: NOW });
    expect(decision.type).toBe('recommend');
    const sent = engine.evaluate.mock.calls[0]![0];
    expect(sent.observations.map((row) => row.signalId)).toEqual(['features']);
    expect(sent.snapshot.observations.map((row) => row.signalId)).toEqual(['features']);
    expect(sent.snapshot.recent).toHaveLength(1);
    expect(validateDecision(decision, definition(), input, NOW)).toEqual(decision);
    expect(canRecommend(definition(), input, decision, { now: NOW })).toBe(true);
  });

  it('does not let an old action supply the minimum evidence for a single new view', async () => {
    const engine = mockEngine();
    const input = snapshot({ observations: [observation('features', { qualifiedViews: 1 }),
      observation('pricing', { clicks: 1, lastSeenAgoMs: 600_000 })] });
    expect(await evaluateSnapshot(definition(), input, engine, { now: NOW })).toMatchObject({ reason: 'insufficient_evidence' });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it.each(['viewed', 'completed', 'dismissed'] as const)('preserves 30-minute %s exclusions', async (kind) => {
    const engine = mockEngine();
    const input = snapshot(kind === 'viewed' ? { observations: [observation(), observation('feature-guide', { lastSeenAgoMs: 1_700_000 })] }
      : { outcomes: [{ contentId: 'feature-guide', kind, ageMs: 1_700_000 }] });
    const decision = await evaluateSnapshot(definition(), input, engine, { now: NOW });
    expect(decision.type).toBe('abstain');
    expect(engine.evaluate.mock.calls[0]![0].candidates.map((row) => row.contentId)).not.toContain('feature-guide');
  });

  it('rejects an old policy response and a forged recommendation without fresh evidence', async () => {
    const result = await evaluateSnapshot(definition(), snapshot(), mockEngine(), { now: NOW });
    expect(() => validateDecision({ ...result, policyVersion: 'jev-rubric-v1' }, definition(), snapshot(), NOW)).toThrow('invalid_result');
    const stale = snapshot({ observations: [observation('features', { lastSeenAgoMs: 600_000 })] });
    expect(() => validateDecision(result, definition(), stale, NOW)).toThrow('invalid_result');
    expect(canRecommend(definition(), stale, result, { now: NOW })).toBe(false);
  });
});
