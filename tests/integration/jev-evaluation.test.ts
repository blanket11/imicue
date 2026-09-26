import { describe, it, expect, vi } from 'vitest';
import { compareScenarios, measuredTransport } from '../../scripts/lib/jev-evaluation.js';
import { JEV_MODEL } from '@imicue/server';
import { evaluationInput } from '../../scripts/lib/evaluation-input.js';
import { definition, observation, snapshot } from '../../packages/core/test/fixtures.js';
import { semanticScenarios } from '../../scripts/lib/semantic-scenarios.js';
import { validateDefinition, validateSnapshot } from '@imicue/core';

describe('bounded live-evaluation harness (mock transport only)', () => {
  it('validates all semantic fixtures and their proposed candidate IDs before live inference', () => {
    expect(semanticScenarios).toHaveLength(12);
    for (const scenario of semanticScenarios) {
      const source = validateDefinition(scenario.source!);
      expect(() => validateSnapshot(scenario.input, source)).not.toThrow();
      expect(scenario.review!.acceptable.every((id) => id === 'abstain' || Object.hasOwn(source.contents, id))).toBe(true);
      expect(Object.keys(source.contents).length).toBeLessThanOrEqual(8);
    }
  });

  it('applies exclusions with custom dictionaries, records proposed outcome sets, and does not call them human labels', async () => {
    const sent: { questions: Record<string, unknown> }[] = [];
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)); sent.push(request);
      return Response.json({ model: JEV_MODEL, usage: { input_tokens: 100, output_tokens: 0 },
        answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, {
          type: 'score', score: 0, confidence: 0.9, legend: {}, probabilities: {},
        }])),
      });
    });
    const report = await compareScenarios({ apiKey: 'synthetic-key', transport, suite: 'semantic' });
    expect(report.summary).toMatchObject({ completed: 12, failures: 0, requests: 12,
      matchesAuthoredExpectation: null, matchesProposedOutcomes: 8 });
    expect(sent[7]!.questions).not.toHaveProperty('c1'); // Completed.
    expect(sent[8]!.questions).not.toHaveProperty('c2'); // Foreign product.
    expect(report.humanReview).toBe('pending');
    expect(report.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.results.find((row) => row.id === 'Q07')!.proposedMatch).toBe(true);
    expect(report.results.every((row) => row.matchesAuthoredExpectation === null)).toBe(true);
  });

  it('does not count a technical abstention as an acceptable semantic result', async () => {
    let calls = 0;
    const report = await compareScenarios({ apiKey: 'synthetic-key', suite: 'semantic',
      transport: async (_url, init) => {
        if (++calls === 3) return new Response('', { status: 503 });
        const request = JSON.parse(String(init?.body));
        return Response.json({ model: JEV_MODEL, usage: { input_tokens: 1, output_tokens: 0 },
          answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, {
            type: 'score', score: 0, confidence: 0.9, legend: {}, probabilities: {},
          }])),
        });
      } });
    expect(report.summary).toMatchObject({ completed: 3, failures: 1, matchesProposedOutcomes: 0 });
    expect(report.results[2]!.review!.acceptable).toContain('abstain');
    expect(report.results[2]!.proposedMatch).toBe(false);
  });

  it.each(['labels', 'dictionary-en'] as const)('changes only presentation of meaning for %s, preserving evidence and candidate scope', (variant) => {
    const def = definition();
    const input = { snapshot: snapshot(), page: def.pages.home!, topics: def.topics,
      observations: [{ ...observation(), definition: def.signals.features! }],
      candidates: [{ ...def.contents['feature-guide']!, contentId: 'feature-guide' }],
    };
    const modified = evaluationInput(input, variant);
    expect(modified.snapshot).toBe(input.snapshot);
    expect(modified.page).toBe(input.page);
    expect(modified.observations[0]).toMatchObject({ signalId: 'features', qualifiedViews: 2, visibleMs: 30_000, lastSeenAgoMs: 0 });
    expect(modified.candidates).toHaveLength(1);
    expect(modified.candidates[0]).toMatchObject({ contentId: 'feature-guide', productId: 'demo-contract', topicIds: ['features'] });
    expect(modified.observations[0]!.definition.modelDescription).toBe(variant === 'labels' ? 'features' : 'An introduction to the features of the fictional product DemoContract.');
    expect(input.observations[0]!.definition.modelDescription).toBeUndefined();
  });

  it('uses the common gates, exclusions, numeric usage and records disagreements without inventing human labels', async () => {
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.state.observations.some((row: { signalId: string }) => row.signalId === 'feature-guide')) {
        expect(request.questions).not.toHaveProperty('feature-guide');
      }
      return Response.json({ model: JEV_MODEL, usage: { input_tokens: 100, output_tokens: 0 },
        answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, {
          type: 'score', score: id === 'feature-guide' ? 3 : 0, confidence: 0.9,
          legend: {}, probabilities: {},
        }])), account: 'synthetic-private-value' });
    });
    const report = await compareScenarios({ apiKey: 'synthetic-key', transport });
    expect(report.summary).toMatchObject({ completed: 12, planned: 12, requests: 8, gatedWithoutApi: 4,
      failures: 0, inputTokens: 800, outputTokens: 0 });
    expect(report.summary.matchesAuthoredExpectation).toBeLessThan(12);
    expect(report.humanReview).toBe('pending');
    expect(report.results.find((row) => row.id === 'expired-candidate')!.jev.assessments.map((row) => row.contentId)).not.toContain('feature-guide');
    expect(JSON.stringify(report)).not.toMatch(/synthetic-private-value|synthetic-key|Authorization/);
  });

  it('stops on HTTP errors, preserves unknown usage, and never retries or reports response bodies', async () => {
    const transport = vi.fn(async () => new Response('synthetic-secret-error', { status: 429 }));
    const report = await compareScenarios({ apiKey: 'synthetic-key', transport });
    expect(transport).toHaveBeenCalledOnce();
    expect(report.summary).toMatchObject({ completed: 2, failures: 1, requests: 1,
      inputTokens: null, outputTokens: null, estimatedInputCostUsd: null });
    expect(JSON.stringify(report)).not.toContain('synthetic-secret-error');
  });

  it('bounds actual outbound attempts and refuses alternate endpoints before sending', async () => {
    const transport = vi.fn(async () => Response.json({ usage: { input_tokens: 2.5, output_tokens: -1 } }));
    const measured = measuredTransport(transport, 1);
    await expect(measured.fetch('https://other.example/v1/systemone', { method: 'POST' })).rejects.toThrow('unexpected_endpoint');
    await measured.fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST' });
    await expect(measured.fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST' })).rejects.toThrow('evaluation_request_limit');
    expect(transport).toHaveBeenCalledOnce();
    expect(measured.requests[0]).toMatchObject({ inputTokens: null, outputTokens: null });
  });
});
