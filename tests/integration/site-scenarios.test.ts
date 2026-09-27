import { describe, expect, it, vi } from 'vitest';
import { createRulesEngine, evaluateSnapshot } from '@imicue/core';
import { definition, makeSnapshot } from '../../site/scenarios.js';

describe('public site browsing examples use the actual Rules engine', () => {
  it.each([
    ['features', '読書メモを検索するガイド'],
    ['cases', '読みかけの本を整理する方法'],
  ] as const)('recommends the matching candidate from %s browsing without clicks or actions', async (scenario, title) => {
    const snapshot = makeSnapshot(scenario);
    expect(snapshot.observations).toHaveLength(2);
    for (const observation of snapshot.observations) {
      expect(observation).toMatchObject({ source: 'direct', qualifiedViews: 1, visibleMs: 30_000, clicks: 0, actions: 0 });
      expect(definition.signals[observation.signalId]?.kind).toBe('content');
    }
    const decision = await evaluateSnapshot(definition, snapshot, createRulesEngine());
    expect(decision.type).toBe('recommend');
    if (decision.type !== 'recommend') throw new Error('expected_recommendation');
    expect(definition.contents[decision.contentId]?.title).toBe(title);
    expect(decision.engine.name).toBe('rules');
    expect(decision.assessments).toHaveLength(2);
    expect(decision.assessments.every((assessment) => assessment.scoreKind === 'heuristic')).toBe(true);
  });

  it('abstains when both subjects have equally strong browsing evidence', async () => {
    const snapshot = makeSnapshot('both');
    expect(snapshot.observations).toHaveLength(4);
    const decision = await evaluateSnapshot(definition, snapshot, createRulesEngine());
    expect(decision).toMatchObject({ type: 'abstain', reason: 'ambiguous' });
    expect(decision.assessments).toHaveLength(2);
    const scores = decision.assessments.map((assessment) => assessment.score);
    expect(scores[0]).toBeGreaterThan(0);
    expect(scores[0]).toBe(scores[1]);
  });

  it('abstains without scoring when no browsing evidence exists', async () => {
    const rules = createRulesEngine();
    const evaluate = vi.fn(rules.evaluate);
    const engine = { ...rules, evaluate };
    const snapshot = makeSnapshot('empty');
    expect(snapshot.observations).toEqual([]);
    const decision = await evaluateSnapshot(definition, snapshot, engine);
    expect(decision).toMatchObject({ type: 'abstain', reason: 'insufficient_evidence', assessments: [] });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
