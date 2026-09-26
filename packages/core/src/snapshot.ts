import { deepFreeze, own } from './definition.js';
import type { Definition, Snapshot } from './types.js';

export class SnapshotValidationError extends Error {
  readonly code = 'invalid_snapshot';
  constructor() { super('Invalid snapshot'); this.name = 'SnapshotValidationError'; }
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new SnapshotValidationError();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  assert(Object.keys(value).every((key) => keys.includes(key)));
  return value as Record<string, unknown>;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function correlation(value: unknown): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Structural validation also supports future trusted-boundary adapters without accepting metadata. */
export function validateSnapshot(input: unknown, definition: Definition): Snapshot {
  const snapshot = record(input, ['schemaVersion', 'siteId', 'definitionVersion', 'snapshotId', 'revision', 'pageViewId', 'pageId', 'windowMs', 'observations', 'recent', 'outcomes', 'coverage']);
  assert(snapshot.schemaVersion === '0.1' && snapshot.siteId === definition.siteId && snapshot.definitionVersion === definition.definitionVersion);
  assert(typeof snapshot.pageId === 'string' && own(definition.pages, snapshot.pageId));
  assert(correlation(snapshot.snapshotId) && correlation(snapshot.pageViewId) && integer(snapshot.revision));
  assert(integer(snapshot.windowMs, 1_800_000) && snapshot.windowMs > 0);
  const windowMs = snapshot.windowMs;
  assert(Array.isArray(snapshot.observations) && snapshot.observations.length <= 400);
  const seen = new Set<string>();
  for (const item of snapshot.observations) {
    const observation = record(item, ['signalId', 'source', 'qualifiedViews', 'visibleMs', 'clicks', 'actions', 'lastSeenAgoMs']);
    assert(typeof observation.signalId === 'string');
    const signal = own(definition.signals, observation.signalId);
    assert(signal && (observation.source === 'direct' || observation.source === 'recommendation'));
    const key = `${observation.signalId}:${observation.source}`;
    assert(!seen.has(key)); seen.add(key);
    assert(integer(observation.qualifiedViews, 1_000) && integer(observation.clicks, 1_000) && integer(observation.actions, 1_000));
    assert(integer(observation.visibleMs, windowMs) && integer(observation.lastSeenAgoMs, windowMs));
    assert(signal.kind === 'action' ? observation.qualifiedViews === 0 && observation.visibleMs === 0 && observation.clicks === 0 : observation.actions === 0);
  }
  assert(Array.isArray(snapshot.recent) && snapshot.recent.length <= 20);
  let previousAge = -1;
  for (const item of snapshot.recent) {
    const event = record(item, ['signalId', 'source', 'kind', 'ageMs']);
    assert(typeof event.signalId === 'string');
    const signal = own(definition.signals, event.signalId);
    assert(signal && (event.source === 'direct' || event.source === 'recommendation'));
    assert(['qualified-view', 'click', 'action'].includes(event.kind as string));
    assert(signal.kind === 'action' ? event.kind === 'action' : event.kind !== 'action');
    assert(integer(event.ageMs, windowMs) && event.ageMs >= previousAge);
    previousAge = event.ageMs;
  }
  assert(Array.isArray(snapshot.outcomes) && snapshot.outcomes.length <= 100);
  for (const item of snapshot.outcomes) {
    const outcome = record(item, ['contentId', 'kind', 'ageMs']);
    assert(typeof outcome.contentId === 'string' && own(definition.contents, outcome.contentId));
    assert(['shown', 'clicked', 'dismissed', 'completed'].includes(outcome.kind as string));
    assert(integer(outcome.ageMs, windowMs));
  }
  const coverage = record(snapshot.coverage, ['truncated']);
  assert(typeof coverage.truncated === 'boolean');
  return deepFreeze(JSON.parse(JSON.stringify(input)) as Snapshot);
}
