import { describe, it, expect, vi } from 'vitest';
import { compareScenarios, measuredTransport } from '../../scripts/lib/jev-evaluation.js';
import { JEV_MODEL } from '@imicue/server';

describe('bounded live-evaluation harness (mock transport only)', () => {
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
    expect(report.summary).toMatchObject({ completed: 12, planned: 12, requests: 9, gatedWithoutApi: 3,
      failures: 0, inputTokens: 900, outputTokens: 0 });
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
