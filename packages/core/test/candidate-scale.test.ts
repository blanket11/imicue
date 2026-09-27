import { describe, expect, it, vi } from 'vitest';
import { evaluateSnapshot, validateDecision, validateDefinition, type DecisionEngine } from '../src/index.js';
import { NOW, scaleDefinition, snapshot } from './fixtures.js';

const mockEngine = (): DecisionEngine => ({
  name: 'jev', version: 'synthetic-scale-contract',
  async evaluate(input) {
    return { assessments: input.candidates.map((candidate) => {
      const raw = candidate.relatedSignalIds?.includes('features') ? 2.9999999999999996 : 0.0000030000000000000005;
      return { contentId: candidate.contentId, score: raw / 3, scoreKind: 'rubric' as const,
        rawScore: { value: raw, min: 0, max: 3 }, providerConfidence: 0.9999999999999999 };
    }) };
  },
});

describe('100-candidate complete evaluation contracts (offline engine only)', () => {
  it('permits a bounded long-description catalog above the former 16 KiB total limit', async () => {
    const source = scaleDefinition();
    const definition = validateDefinition({ ...source, contents: Object.fromEntries(Object.entries(source.contents)
      .map(([id, content]) => [id, { ...content, description: 'あ'.repeat(1000), modelDescription: 'い'.repeat(1000) }])) });
    const engine = { ...mockEngine(), evaluate: vi.fn(mockEngine().evaluate) };
    const decision = await evaluateSnapshot(definition, snapshot(), engine, { now: NOW });
    expect(decision).toMatchObject({ type: 'recommend', contentId: 'candidate-099', policyVersion: 'jev-rubric-v4' });
    expect(decision.assessments).toHaveLength(100);
    expect(engine.evaluate).toHaveBeenCalledOnce();
    expect(validateDecision(decision, definition, snapshot(), NOW)).toEqual(decision);
  });

  it('bounds the full resolved input at 1 MiB before any engine work', async () => {
    const source = scaleDefinition();
    const definition = validateDefinition({ ...source, contents: Object.fromEntries(Object.entries(source.contents)
      .map(([id, content]) => [id, { ...content, href: `/${'x'.repeat(11_000)}` }])) });
    const engine = { ...mockEngine(), evaluate: vi.fn(mockEngine().evaluate) };
    expect(await evaluateSnapshot(definition, snapshot(), engine, { now: NOW })).toMatchObject({ reason: 'capacity_limit', assessments: [] });
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it.each(['missing', 'duplicate', 'outside', 'nonfinite'] as const)('rejects %s results without claiming a partial winner', async (kind) => {
    const definition = validateDefinition(scaleDefinition());
    const engine: DecisionEngine = { ...mockEngine(), async evaluate(input, options) {
      const output = await mockEngine().evaluate(input, options);
      const assessments = output.assessments.map((item) => ({ ...item }));
      if (kind === 'missing') assessments.shift();
      if (kind === 'duplicate') assessments[0]!.contentId = assessments[1]!.contentId;
      if (kind === 'outside') assessments[0]!.contentId = 'outside';
      if (kind === 'nonfinite') assessments[0]!.score = NaN;
      return { assessments };
    } };
    expect(await evaluateSnapshot(definition, snapshot(), engine, { now: NOW }))
      .toMatchObject({ type: 'abstain', reason: 'invalid_result', assessments: [] });
  });

  it('still excludes dismissed and viewed destinations before collecting all remaining results', async () => {
    const source = scaleDefinition();
    const definition = validateDefinition({ ...source, signals: { ...source.signals,
      guide: { kind: 'content', contentId: 'candidate-000', description: 'Synthetic guide body' } } });
    const input = snapshot({ outcomes: [{ contentId: 'candidate-001', kind: 'dismissed', ageMs: 1_700_000 }],
      observations: [...snapshot().observations, { ...snapshot().observations[0]!, signalId: 'guide', lastSeenAgoMs: 1_700_000 }] });
    const decision = await evaluateSnapshot(definition, input, mockEngine(), { now: NOW });
    expect(decision.assessments).toHaveLength(98);
    expect(decision.assessments.map((row) => row.contentId)).not.toContain('candidate-000');
    expect(decision.assessments.map((row) => row.contentId)).not.toContain('candidate-001');
    expect(validateDecision(decision, definition, input, NOW)).toEqual(decision);
  });
});
