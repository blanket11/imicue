import { createHash } from 'node:crypto';
import type { Fetch } from '@typesafe-ai/sdk';
import { evaluateSnapshot, validateDefinition, validateSnapshot, type Definition, type ResolvedEvaluationInput, type Snapshot } from '@imicue/core';
import { buildJevRequests, createJevEngine, createMemoryProviderLimiter, JEV_MODEL } from '@imicue/server';
import { NOW } from '../../packages/core/test/fixtures.js';
import { semanticScenarios } from './semantic-scenarios.js';
import { catalogEvaluationMetadata } from './catalog-evaluation.js';
import { makeCatalogFixture, CATALOG_FIXTURE_TIME } from './catalog-fixtures.js';
import { CatalogBudget, catalogMeasuredTransport, CATALOG_INPUT_USD_PER_MILLION, type CatalogRequestMetric } from './catalog-budget.js';

export type CatalogMeasurementSuite = 'capacity' | 'legacy';
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
interface MeasurementFixture { id: string; definition: Definition; snapshot: Snapshot; now: number; descriptionChars: number | null; acceptable: readonly string[] | null }
function fixtures(suite: CatalogMeasurementSuite): MeasurementFixture[] {
  if (suite === 'legacy') return ['Q01', 'Q02', 'Q12'].map(id => {
    const item = semanticScenarios.find(row => row.id === id)!;
    return { id, definition: item.source!, snapshot: item.input, now: NOW, descriptionChars: null, acceptable: item.review!.acceptable };
  });
  return [200, 1000].map(descriptionChars => {
    const base = makeCatalogFixture({ familyId: 'sharing', situation: 'features', count: 100 });
    const padding = 'この説明は架空の容量評価用データです。閲覧は読了や購入意思の証明ではありません。';
    const definitionVersion = `capacity-${descriptionChars}-v1`;
    const definition: Definition = { ...base.source, definitionVersion, contents: Object.fromEntries(Object.entries(base.source.contents).map(([id, item]) => {
      if (item.description.length > descriptionChars) throw new Error('invalid_catalog_capacity_padding');
      return [id, { ...item, description: (item.description + padding.repeat(descriptionChars)).slice(0, descriptionChars) }];
    })) };
    return { id: `description-${descriptionChars}`, definition, snapshot: { ...base.snapshot, definitionVersion },
      now: CATALOG_FIXTURE_TIME, descriptionChars, acceptable: null };
  });
}
function inputFor(fixture: MeasurementFixture): ResolvedEvaluationInput {
  const definition = validateDefinition(fixture.definition);
  const snapshot = validateSnapshot(fixture.snapshot, definition);
  // These dedicated fixtures have no exclusions, expiry or frequency suppression.
  return { topics: definition.topics ?? {}, snapshot, page: definition.pages[snapshot.pageId]!,
    observations: snapshot.observations.map(row => ({ ...row, definition: definition.signals[row.signalId]! })),
    candidates: Object.entries(definition.contents).map(([contentId, item]) => ({ ...item, contentId })) };
}
export function planCatalogMeasurement(suite: CatalogMeasurementSuite) {
  const selected = fixtures(suite);
  const rows = selected.map(fixture => {
    const input = inputFor(fixture);
    const requests = buildJevRequests(input, JEV_MODEL);
    return { id: fixture.id, descriptionChars: fixture.descriptionChars, candidates: input.candidates.length,
      definitionBytes: bytes(fixture.definition), snapshotBytes: bytes(fixture.snapshot), resolvedInputBytes: bytes(input),
      requests: requests.length, requestBytes: requests.map(bytes) };
  });
  return { schemaVersion: 1, suite, model: JEV_MODEL, sdk: '0.6.0', ...catalogEvaluationMetadata(),
    fixtureHash: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
    scope: suite === 'capacity' ? 'synthetic-resource-measurement-not-semantic-quality' : 'legacy-regression-not-holdout',
    humanReview: suite === 'capacity' ? 'pending_ai_authored' : 'existing_review_proposals',
    retries: 0, maximumRequests: rows.reduce((sum, row) => sum + row.requests, 0), rows };
}
interface MeasurementResult {
  id: string;
  descriptionChars: number | null;
  eligibleCount: number;
  assessedCount: number;
  completedAllCandidates: boolean;
  technicalFailure: string | null;
  proposedMatch: boolean | null;
  actual: string | null;
  elapsedMs: number;
  snapshotBytes: number;
  decisionBodyBytes: number;
  requests: readonly CatalogRequestMetric[];
}
export async function runCatalogMeasurement(options: {
  suite: CatalogMeasurementSuite; apiKey: string; transport: Fetch; budget: CatalogBudget;
  onCheckpoint?: (report: ReturnType<typeof reportFor>) => Promise<void>;
}) {
  const plan = planCatalogMeasurement(options.suite);
  const state = await options.budget.inspect();
  if (plan.maximumRequests > 600 - state.attempts.length) throw new Error('catalog_plan_exceeds_remaining_attempts');
  await options.budget.startRun(options.suite, plan.fixtureHash);
  const providerLimiter = createMemoryProviderLimiter({ perMinute: 600, perDay: 600 });
  const results: MeasurementResult[] = [];
  for (const fixture of fixtures(options.suite)) {
    const measured = catalogMeasuredTransport(options.transport, options.budget, `${options.suite}-${fixture.id.toLowerCase()}`);
    const engine = createJevEngine({ model: JEV_MODEL, apiKey: options.apiKey, fetch: measured.fetch, providerLimiter });
    const started = performance.now();
    const decision = await evaluateSnapshot(validateDefinition(fixture.definition), fixture.snapshot, engine,
      { now: fixture.now, id: () => 'catalog-measurement' });
    const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
    const technicalFailure = decision.type === 'abstain' && ['engine_unavailable', 'invalid_result', 'capacity_limit', 'definition_mismatch'].includes(decision.reason)
      ? decision.reason : null;
    const actual = decision.type === 'recommend' ? decision.contentId : 'abstain';
    const count = Object.keys(fixture.definition.contents).length;
    results.push({ id: fixture.id, descriptionChars: fixture.descriptionChars, eligibleCount: count,
      assessedCount: decision.assessments.length, completedAllCandidates: !technicalFailure && decision.assessments.length === count,
      technicalFailure, actual: fixture.acceptable ? actual : null,
      proposedMatch: fixture.acceptable ? !technicalFailure && fixture.acceptable.includes(actual) : null,
      elapsedMs, snapshotBytes: bytes(fixture.snapshot), decisionBodyBytes: bytes(decision), requests: measured.requests });
    await options.onCheckpoint?.(reportFor(plan, results));
    if (technicalFailure) break;
  }
  return reportFor(plan, results);
}
function reportFor(plan: ReturnType<typeof planCatalogMeasurement>, results: readonly MeasurementResult[]) {
  const requests = results.flatMap(row => row.requests);
  const inputTokens = requests.every(row => row.inputTokens !== null) ? requests.reduce((sum, row) => sum + row.inputTokens!, 0) : null;
  return { ...plan, runAt: new Date().toISOString(), completed: results.length, results,
    summary: { requests: requests.length, inputTokens,
      outputTokens: requests.every(row => row.outputTokens !== null) ? requests.reduce((sum, row) => sum + row.outputTokens!, 0) : null,
      requestBytes: requests.reduce((sum, row) => sum + row.requestBytes, 0),
      responseBytes: requests.every(row => row.responseBytes !== null) ? requests.reduce((sum, row) => sum + row.responseBytes!, 0) : null,
      estimatedInputCostUsd: inputTokens === null ? null : inputTokens / 1_000_000 * CATALOG_INPUT_USD_PER_MILLION,
      failures: results.filter(row => row.technicalFailure || !row.completedAllCandidates).length } };
}
