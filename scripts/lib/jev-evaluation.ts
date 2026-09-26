import type { Fetch } from '@typesafe-ai/sdk';
import { createHash } from 'node:crypto';
import { createRulesEngine, evaluateSnapshot, validateDefinition } from '@imicue/core';
import { createJevEngine, JEV_MODEL } from '@imicue/server';
import { definition, NOW, scenarios } from '../../packages/core/test/fixtures.js';
import { freshnessScenarios } from './freshness-scenarios.js';
import { evaluationInput, type InputVariant } from './evaluation-input.js';
import { semanticScenarios } from './semantic-scenarios.js';
import type { EvaluationScenario } from './evaluation-scenario.js';

export type EvaluationSuite = 'regression' | 'freshness' | 'semantic';

export interface RequestMetric {
  status: number | null;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}
const tokens = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Retain only allowlisted measurements; never retain headers, bodies or error messages. */
export function measuredTransport(transport: Fetch, limit = 12) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('invalid_request_limit');
  const requests: RequestMetric[] = [];
  const fetch: Fetch = async (url, init) => {
    if (url !== 'https://api.typesafe.ai/v1/systemone' || init?.method !== 'POST') throw new Error('unexpected_endpoint');
    if (requests.length >= limit) throw new Error('evaluation_request_limit');
    const entry: RequestMetric = { status: null, elapsedMs: 0, inputTokens: null, outputTokens: null };
    requests.push(entry);
    const start = performance.now();
    try {
      const response = await transport(url, { ...init, redirect: 'error' });
      entry.status = response.status;
      if (response.ok) {
        try {
          const body = await response.clone().json();
          entry.inputTokens = tokens(body?.usage?.input_tokens);
          entry.outputTokens = tokens(body?.usage?.output_tokens);
        } catch { /* Missing usage is unknown, not zero. The SDK validates the response. */ }
      }
      return response;
    } finally { entry.elapsedMs = Math.round((performance.now() - start) * 100) / 100; }
  };
  return { fetch, requests };
}

export async function compareScenarios(options: { apiKey: string; transport: Fetch; suite?: EvaluationSuite; variant?: InputVariant }) {
  if (options.suite === 'semantic' && options.variant === 'dictionary-en') throw new Error('semantic_english_not_defined');
  const selected: readonly EvaluationScenario[] = options.suite === 'semantic' ? semanticScenarios
    : options.suite === 'freshness' ? freshnessScenarios : scenarios;
  const fixtureHash = createHash('sha256').update(JSON.stringify(selected.map((row) => ({ ...row, source: row.source ?? definition() })))).digest('hex');
  const measured = measuredTransport(options.transport);
  const baseEngine = createJevEngine({ model: JEV_MODEL, apiKey: options.apiKey, fetch: measured.fetch });
  const engine: typeof baseEngine = { ...baseEngine,
    evaluate: (input, context) => baseEngine.evaluate(evaluationInput(input, options.variant ?? 'dictionary-ja'), context),
  };
  const results = [];
  for (const scenario of selected) {
    const source = scenario.source ?? definition();
    const config = validateDefinition('expiresFeature' in scenario ? {
      ...source, contents: { ...source.contents, 'feature-guide': {
        ...source.contents['feature-guide']!, availableUntil: '2026-09-25T23:59:59Z',
      } },
    } : source);
    const fixed = { now: NOW, id: () => `comparison-${scenario.id}` };
    const rules = await evaluateSnapshot(config, scenario.input, createRulesEngine(), fixed);
    const offset = measured.requests.length;
    const start = performance.now();
    const jev = await evaluateSnapshot(config, scenario.input, engine, fixed);
    const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    const actual = jev.type === 'recommend' ? jev.contentId : jev.reason;
    const failed = jev.type === 'abstain' && ['engine_unavailable', 'invalid_result', 'definition_mismatch', 'capacity_limit'].includes(jev.reason);
    const proposedMatch = scenario.review ? !failed && scenario.review.acceptable.includes(jev.type === 'recommend' ? jev.contentId : 'abstain') : null;
    results.push({ id: scenario.id, split: scenario.split, expected: scenario.expected,
      matchesAuthoredExpectation: scenario.review ? null : actual === scenario.expected, actual, rules, jev,
      ...(scenario.review ? { review: scenario.review } : {}), proposedMatch,
      elapsedMs, requests: measured.requests.slice(offset), failed });
    // A failed request is not a semantic disagreement; stop without retrying.
    if (failed) break;
  }
  const inputTokens = measured.requests.every((row) => row.inputTokens !== null)
    ? measured.requests.reduce((sum, row) => sum + row.inputTokens!, 0) : null;
  const outputTokens = measured.requests.every((row) => row.outputTokens !== null)
    ? measured.requests.reduce((sum, row) => sum + row.outputTokens!, 0) : null;
  return {
    schemaVersion: 1, suite: options.suite ?? 'regression', runAt: new Date().toISOString(), fixtureTime: new Date(NOW).toISOString(),
    model: JEV_MODEL, humanReview: 'pending', comparison: 'rules-vs-jev', variant: options.variant ?? 'dictionary-ja',
    fixtureHash,
    holdoutCaveat: options.suite === 'semantic' ? 'authored_for_this_evaluation_not_independent_holdout' : 'already_used_in_regression_tests', requestLimit: 12, retries: 0,
    summary: {
      completed: results.length, planned: selected.length, requests: measured.requests.length,
      gatedWithoutApi: results.filter((row) => row.requests.length === 0).length,
      matchesAuthoredExpectation: results.some((row) => row.review) ? null : results.filter((row) => row.matchesAuthoredExpectation).length,
      matchesProposedOutcomes: results.some((row) => row.proposedMatch !== null) ? results.filter((row) => row.proposedMatch).length : null,
      failures: results.filter((row) => row.failed).length,
      inputTokens, outputTokens,
      estimatedInputCostUsd: inputTokens === null ? null : inputTokens / 1_000_000 * 0.042,
      priceSource: 'https://docs.typesafe.ai/models', priceCheckedOn: '2026-09-26',
      inputUsdPerMillionTokens: 0.042,
    }, results,
  };
}
