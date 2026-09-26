import { deepFreeze, own } from './definition.js';
import { validateSnapshot } from './snapshot.js';
import { EngineFailure } from './types.js';
import type {
  AbstainReason, CandidateAssessment, Decision, DecisionBase, DecisionEngine,
  Definition, ResolvedEvaluationInput, SignalObservation, Snapshot,
} from './types.js';

export const POLICY_VERSION = 'rules-v1';
export const JEV_POLICY_VERSION = 'jev-rubric-v3';
export const JEV_EVIDENCE_MAX_AGE_MS = 300_000;
export const DECISION_MAX_AGE_MS = 30_000;

function evidence(observation: SignalObservation): number {
  const base = Math.min(1,
    0.2 * Math.min(observation.qualifiedViews, 2) +
    0.3 * Math.min(observation.visibleMs / 30_000, 1) +
    0.6 * Math.min(observation.clicks + observation.actions, 1));
  return base * 2 ** (-observation.lastSeenAgoMs / 300_000);
}

export function createRulesEngine(): DecisionEngine {
  return Object.freeze({
    name: 'rules' as const,
    version: 'rules-v1',
    async evaluate(input: ResolvedEvaluationInput, options: { signal: AbortSignal }) {
      if (options.signal.aborted) throw new Error('Evaluation aborted');
      return {
        assessments: input.candidates.map((candidate): CandidateAssessment => {
          let score = 0;
          for (const observation of input.observations) {
            if (observation.source !== 'direct') continue;
            const signal = observation.definition;
            if (signal.productId && candidate.productId && signal.productId !== candidate.productId) continue;
            const affinity = candidate.relatedSignalIds?.includes(observation.signalId) ? 1 :
              candidate.topicIds?.some((topicId) => signal.topicIds?.includes(topicId)) ? 0.5 : 0;
            score = Math.max(score, evidence(observation) * affinity);
          }
          return { contentId: candidate.contentId, score, scoreKind: 'heuristic' };
        }),
      };
    },
  });
}

type Prepared = { reason: AbstainReason } | { input: ResolvedEvaluationInput };

function prepare(definition: Definition, snapshot: Snapshot, now: number, engineName: 'rules' | 'jev' = 'rules'): Prepared {
  if (snapshot.coverage.truncated) return { reason: 'capacity_limit' };
  const page = own(definition.pages, snapshot.pageId);
  if (!page) return { reason: 'invalid_result' };
  if (snapshot.outcomes.some((outcome) => outcome.kind === 'shown' && outcome.ageMs < 60_000)) return { reason: 'suppressed' };
  const excluded = new Set(snapshot.outcomes.filter((outcome) => outcome.kind === 'dismissed' || outcome.kind === 'completed').map((outcome) => outcome.contentId));
  if (page.contentId) excluded.add(page.contentId);
  for (const observation of snapshot.observations) {
    const signal = own(definition.signals, observation.signalId);
    if (signal?.kind === 'content' && signal.contentId && observation.qualifiedViews > 0) excluded.add(signal.contentId);
  }
  const candidates = Object.entries(definition.contents)
    .filter(([contentId, content]) => content.enabled && !excluded.has(contentId) &&
      (!content.availableFrom || Date.parse(content.availableFrom) <= now) &&
      (!content.availableUntil || now < Date.parse(content.availableUntil)) &&
      !(page.productId && content.productId && page.productId !== content.productId))
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([contentId, content]) => ({ ...content, contentId }));
  if (!candidates.length) return { reason: 'no_eligible_content' };
  if (candidates.length > 8) return { reason: 'capacity_limit' };
  const observations = snapshot.observations.filter((observation) => {
    const signal = own(definition.signals, observation.signalId);
    return observation.source === 'direct' && signal &&
      (engineName !== 'jev' || observation.lastSeenAgoMs <= JEV_EVIDENCE_MAX_AGE_MS) &&
      !(page.productId && signal.productId && page.productId !== signal.productId);
  }).map((observation) => ({ ...observation, definition: definition.signals[observation.signalId]! }));
  const views = observations.reduce((sum, observation) => sum + observation.qualifiedViews, 0);
  const explicit = observations.reduce((sum, observation) => sum + observation.clicks + observation.actions, 0);
  if (views < 2 && explicit < 1) return { reason: 'insufficient_evidence' };
  const directIds = new Set(observations.map((observation) => observation.signalId));
  const input: ResolvedEvaluationInput = {
    topics: Object.fromEntries(Object.entries(definition.topics ?? {}).filter(([id]) =>
      observations.some((item) => item.definition.topicIds?.includes(id)) || candidates.some((item) => item.topicIds?.includes(id)))),
    snapshot: { ...snapshot, observations: snapshot.observations.filter((observation) => observation.source === 'direct' && directIds.has(observation.signalId)), recent: snapshot.recent.filter((event) => event.source === 'direct' && directIds.has(event.signalId) &&
      (engineName !== 'jev' || event.ageMs <= JEV_EVIDENCE_MAX_AGE_MS)) },
    page, observations, candidates,
  };
  return { input: deepFreeze(input) };
}

function validAssessments(input: ResolvedEvaluationInput, output: unknown, engine: DecisionEngine): output is { assessments: CandidateAssessment[]; model?: string } {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const result = output as Record<string, unknown>;
  if (Object.keys(result).some((key) => !['assessments', 'model'].includes(key))) return false;
  if (result.model !== undefined && (typeof result.model !== 'string' || !result.model || result.model.length > 120)) return false;
  if (!Array.isArray(result.assessments) || result.assessments.length !== input.candidates.length) return false;
  const remaining = new Set(input.candidates.map((candidate) => candidate.contentId));
  for (const value of result.assessments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const assessment = value as Record<string, unknown>;
    if (Object.keys(assessment).some((key) => !['contentId', 'score', 'scoreKind', 'rawScore', 'providerConfidence'].includes(key))) return false;
    if (typeof assessment.contentId !== 'string' || !remaining.delete(assessment.contentId)) return false;
    if (typeof assessment.score !== 'number' || !Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 1) return false;
    if (engine.name === 'rules') {
      if (assessment.scoreKind !== 'heuristic' || assessment.providerConfidence !== undefined || assessment.rawScore !== undefined) return false;
    } else {
      if (assessment.scoreKind !== 'rubric' || typeof assessment.providerConfidence !== 'number' ||
        !Number.isFinite(assessment.providerConfidence) || assessment.providerConfidence < 0 || assessment.providerConfidence > 1) return false;
      const raw = assessment.rawScore as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== 'object' || Object.keys(raw).some((key) => !['value', 'min', 'max'].includes(key)) ||
        raw.min !== 0 || raw.max !== 3 || typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0 || raw.value > 3 ||
        Math.abs(assessment.score - raw.value / 3) > 1e-12) return false;
    }
  }
  return remaining.size === 0;
}

export interface EvaluationOptions { now?: number; signal?: AbortSignal; id?: () => string }

/** Resolve a fixed snapshot, invoke a scoring adapter once, then apply shared policy. */
export async function evaluateSnapshot(definition: Definition, snapshot: Snapshot, engine: DecisionEngine, options: EvaluationOptions = {}): Promise<Decision> {
  let base: DecisionBase = {
    schemaVersion: '0.1', decisionId: options.id?.() ?? globalThis.crypto.randomUUID(),
    snapshotId: snapshot.snapshotId, revision: snapshot.revision, pageViewId: snapshot.pageViewId,
    definitionVersion: definition.definitionVersion, policyVersion: engine.name === 'jev' ? JEV_POLICY_VERSION : POLICY_VERSION,
    engine: { name: engine.name, version: engine.version }, assessments: [], maxAgeMs: DECISION_MAX_AGE_MS,
  };
  const abstain = (reason: AbstainReason): Decision => deepFreeze({ ...base, type: 'abstain', reason });
  if (snapshot.definitionVersion !== definition.definitionVersion || snapshot.siteId !== definition.siteId) return abstain('definition_mismatch');
  let valid: Snapshot;
  try { valid = validateSnapshot(snapshot, definition); } catch { return abstain('invalid_result'); }
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) return abstain('invalid_result');
  const prepared = prepare(definition, valid, now, engine.name);
  if ('reason' in prepared) return abstain(prepared.reason);
  if (engine.name === 'jev' && new TextEncoder().encode(JSON.stringify(prepared.input)).byteLength > 16 * 1_024) return abstain('capacity_limit');
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return abstain('engine_unavailable');
  let result: unknown;
  try { result = await engine.evaluate(prepared.input, { signal }); } catch (error) {
    return abstain(error instanceof EngineFailure ? error.reason : 'engine_unavailable');
  }
  if (signal.aborted) return abstain('engine_unavailable');
  if (!validAssessments(prepared.input, result, engine)) return abstain('invalid_result');
  const assessments = result.assessments.map((assessment) => ({ ...assessment, ...(assessment.rawScore ? { rawScore: { ...assessment.rawScore } } : {}) }))
    .sort((a, b) => b.score - a.score || a.contentId.localeCompare(b.contentId, 'en'));
  base = { ...base, assessments, engine: { ...base.engine, ...(result.model ? { model: result.model } : {}) } };
  const top = assessments[0]!;
  if (top.score < (engine.name === 'rules' ? 0.35 : 0.65) || (engine.name === 'jev' && top.providerConfidence! < 0.6)) return abstain('below_threshold');
  if (assessments[1] && top.score - assessments[1].score < 0.1 - 1e-12) return abstain('ambiguous');
  return deepFreeze({ ...base, type: 'recommend', contentId: top.contentId });
}

export function preflightReason(definition: Definition, snapshot: Snapshot, now = Date.now()): AbstainReason | undefined {
  if (!Number.isFinite(now)) return 'invalid_result';
  if (snapshot.definitionVersion !== definition.definitionVersion || snapshot.siteId !== definition.siteId) return 'definition_mismatch';
  try {
    const result = prepare(definition, validateSnapshot(snapshot, definition), now);
    return 'reason' in result ? result.reason : undefined;
  } catch { return 'invalid_result'; }
}

export function technicalDecision(snapshot: Snapshot, reason: AbstainReason): Decision {
  return deepFreeze({ schemaVersion: '0.1', decisionId: globalThis.crypto.randomUUID(),
    snapshotId: snapshot.snapshotId, revision: snapshot.revision, pageViewId: snapshot.pageViewId,
    definitionVersion: snapshot.definitionVersion, policyVersion: JEV_POLICY_VERSION,
    engine: { name: 'jev', version: 'remote-v1' }, assessments: [], maxAgeMs: DECISION_MAX_AGE_MS,
    type: 'abstain', reason });
}

/** Treat HTTP results as untrusted data, including correlation and recommendation policy. */
export function validateDecision(value: unknown, definition: Definition, snapshot: Snapshot, now = Date.now()): Decision {
  const invalid = () => { throw new EngineFailure('invalid_result'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Decision;
  const keys = ['schemaVersion', 'decisionId', 'snapshotId', 'revision', 'pageViewId', 'definitionVersion', 'policyVersion', 'engine', 'assessments', 'maxAgeMs', 'type', result.type === 'recommend' ? 'contentId' : 'reason'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))
    || result.schemaVersion !== '0.1' || typeof result.decisionId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.decisionId) || result.snapshotId !== snapshot.snapshotId
    || result.revision !== snapshot.revision || result.pageViewId !== snapshot.pageViewId
    || result.definitionVersion !== definition.definitionVersion || !Number.isInteger(result.maxAgeMs)
    || result.maxAgeMs <= 0 || result.maxAgeMs > DECISION_MAX_AGE_MS) return invalid();
  const engine = result.engine;
  if (!engine || !['rules', 'jev'].includes(engine.name) || typeof engine.version !== 'string'
    || engine.version.length < 1 || engine.version.length > 120
    || Object.keys(engine).some((key) => !['name', 'version', 'model'].includes(key))
    || (engine.model !== undefined && (typeof engine.model !== 'string' || !engine.model || engine.model.length > 120))
    || result.policyVersion !== (engine.name === 'jev' ? JEV_POLICY_VERSION : POLICY_VERSION)) return invalid();
  if (!Array.isArray(result.assessments)) return invalid();
  const prepared = prepare(definition, validateSnapshot(snapshot, definition), now, engine.name);
  if (result.assessments.length) {
    if (!('input' in prepared) || !validAssessments(prepared.input, { assessments: result.assessments }, engine as DecisionEngine)) return invalid();
  }
  if (result.type === 'recommend') {
    if (!('input' in prepared) || !result.assessments.length) return invalid();
    const ranked = [...result.assessments].sort((a, b) => b.score - a.score);
    const top = ranked[0]!;
    if (top.contentId !== result.contentId || top.score < (engine.name === 'rules' ? 0.35 : 0.65)
      || (engine.name === 'jev' && (top.providerConfidence ?? 0) < 0.6)
      || (ranked[1] && top.score - ranked[1].score < 0.1 - 1e-12)) return invalid();
  } else if (result.type !== 'abstain' || !['insufficient_evidence', 'no_eligible_content', 'below_threshold', 'ambiguous', 'suppressed', 'capacity_limit', 'definition_mismatch', 'engine_unavailable', 'invalid_result'].includes(result.reason)) return invalid();
  return deepFreeze(JSON.parse(JSON.stringify(value)) as Decision);
}

/** The browser additionally owns consent, generation, receipt time, and URL validation. */
export function canRecommend(definition: Definition, snapshot: Snapshot, decision: Decision, options: { now?: number; ageMs?: number } = {}): boolean {
  const ageMs = options.ageMs ?? 0;
  if (decision.type !== 'recommend' || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= decision.maxAgeMs ||
    decision.revision !== snapshot.revision || decision.pageViewId !== snapshot.pageViewId ||
    decision.definitionVersion !== definition.definitionVersion || snapshot.definitionVersion !== definition.definitionVersion ||
    snapshot.siteId !== definition.siteId) return false;
  try {
    const now = options.now ?? Date.now();
    if (!Number.isFinite(now)) return false;
    const prepared = prepare(definition, validateSnapshot(snapshot, definition), now, decision.engine.name);
    return 'input' in prepared && prepared.input.candidates.some((candidate) => candidate.contentId === decision.contentId);
  } catch { return false; }
}
