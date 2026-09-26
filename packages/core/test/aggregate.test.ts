import { describe, expect, it } from 'vitest';
import { ObservationStore } from '../src/aggregate';
import type { Definition } from '../src/types';

const definition: Definition = {
  schemaVersion: '0.1', siteId: 'test', definitionVersion: '1',
  signals: { section: { kind: 'content', description: 'Section' }, action: { kind: 'action', description: 'Action' } },
  contents: { guide: { title: 'Guide', description: 'Guide', href: '/guide/', enabled: true } },
  pages: { home: {} },
};
const context = { pageId: 'home', pageViewId: 'page-1', revision: 3 };
function setup(options: { capacity?: number } = {}) {
  let now = 0;
  const store = new ObservationStore(definition, { now: () => now, id: () => 'snapshot-1', ...options });
  return { store, advance: (value: number) => { now = value; }, snapshot: () => store.snapshot(context) };
}

describe('C03 bounded interval aggregation', () => {
  it('clips an interval crossing the 30 minute boundary and expires events without truncation', () => {
    const { store, advance, snapshot } = setup();
    store.recordEvent('section', 'direct', 'click');
    advance(4_000);
    store.recordInterval('section', 'direct', 0, 4_000);
    advance(1_802_000);
    expect(snapshot().observations).toEqual([{ signalId: 'section', source: 'direct', qualifiedViews: 0,
      visibleMs: 2_000, clicks: 0, actions: 0, lastSeenAgoMs: 1_798_000 }]);
    expect(snapshot().recent).toEqual([]);
    expect(snapshot().coverage.truncated).toBe(false);
    advance(1_804_001);
    expect(snapshot().observations).toEqual([]);
  });

  it('unions intervals for the same source and keeps recommendation separate', () => {
    const { store, advance, snapshot } = setup();
    advance(5_000);
    store.recordInterval('section', 'direct', 0, 4_000);
    store.recordInterval('section', 'direct', 2_000, 5_000);
    store.recordInterval('section', 'recommendation', 0, 3_000);
    expect(snapshot().observations.map((row) => [row.source, row.visibleMs])).toEqual([
      ['direct', 5_000], ['recommendation', 3_000],
    ]);
  });

  it('records short views without qualifying, and returns immutable, independent snapshots', () => {
    const { store, advance, snapshot } = setup();
    advance(1_000);
    store.recordInterval('section', 'direct', 0, 1_000);
    const first = snapshot();
    expect(first.observations[0]?.qualifiedViews).toBe(0);
    expect(Object.isFrozen(first.observations[0])).toBe(true);
    expect(() => Object.assign(first.observations[0]!, { visibleMs: 99_000 })).toThrow();
    store.recordEvent('section', 'direct', 'qualified-view');
    expect(first.observations[0]?.qualifiedViews).toBe(0);
    expect(snapshot().observations[0]?.qualifiedViews).toBe(1);
    expect(snapshot().revision).toBe(3);
  });

  it('B10 caps at 1000 and keeps truncation until discarded evidence expires', () => {
    const { store, advance, snapshot } = setup();
    for (let i = 0; i < 1_001; i++) {
      advance(i);
      store.recordEvent('action', 'direct', 'action');
    }
    expect(store.export().records).toHaveLength(1_000);
    expect(snapshot().observations[0]?.actions).toBe(1_000);
    expect(snapshot().recent).toHaveLength(20);
    expect(snapshot().coverage.truncated).toBe(true);
    advance(1_800_001);
    expect(snapshot().coverage.truncated).toBe(false);
  });

  it('bounds outcome history and reports discarded suppression history', () => {
    const { store, advance, snapshot } = setup();
    for (let i = 0; i < 101; i++) {
      advance(i);
      store.recordOutcome('guide', 'shown');
    }
    expect(snapshot().outcomes).toHaveLength(100);
    expect(snapshot().coverage.truncated).toBe(true);
    expect(snapshot().outcomes[0]?.ageMs).toBe(0);
  });

  it('does not accept unknown IDs, kind mismatches, future times, or non-finite spans', () => {
    const { store, snapshot } = setup();
    expect(store.recordEvent('constructor', 'direct', 'action')).toBe(false);
    expect(store.recordEvent('section', 'direct', 'action')).toBe(false);
    expect(store.recordEvent('action', 'direct', 'click')).toBe(false);
    expect(store.recordEvent('action', 'direct', 'action', 1)).toBe(false);
    expect(store.recordInterval('section', 'direct', NaN, 0)).toBe(false);
    expect(store.recordOutcome('missing', 'shown')).toBe(false);
    expect(snapshot().observations).toEqual([]);
  });
});

describe('relative-time archive validation', () => {
  it('restores across clock origins, ages records by elapsed time and removes expired records', () => {
    const source = setup();
    source.advance(3_000);
    source.store.recordEvent('action', 'direct', 'action');
    source.store.recordInterval('section', 'direct', 0, 3_000);
    const archive = source.store.export();
    const target = setup();
    expect(target.store.restore(archive, 1_000)).toBe(true);
    expect(target.snapshot().observations[0]?.lastSeenAgoMs).toBe(1_000);
    expect(target.snapshot().observations[1]?.visibleMs).toBe(3_000);
    expect(target.store.restore(archive, 1_800_001)).toBe(true);
    expect(target.snapshot().observations).toEqual([]);
  });

  it.each([
    { version: 2, records: [], truncatedAgeMs: null },
    { version: 1, records: [], truncatedAgeMs: -1 },
    { version: 1, records: [], truncatedAgeMs: null, prompt: 'no' },
    { version: 1, records: [{ type: 'event', signalId: 'constructor', source: 'direct', kind: 'action', ageMs: 0 }], truncatedAgeMs: null },
    { version: 1, records: [{ type: 'event', signalId: 'action', source: 'direct', kind: 'action', ageMs: -1 }], truncatedAgeMs: null },
    { version: 1, records: [{ type: 'interval', signalId: 'section', source: 'direct', startAgeMs: 9_000, endAgeMs: 0 }], truncatedAgeMs: null },
  ])('rejects malformed data atomically', (archive) => {
    const { store, snapshot } = setup();
    store.recordEvent('action', 'direct', 'action');
    expect(store.restore(archive)).toBe(false);
    expect(snapshot().observations[0]?.actions).toBe(1);
  });

  it('clear removes observations, outcomes and truncation', () => {
    const { store, snapshot } = setup();
    store.recordEvent('action', 'direct', 'action');
    store.recordOutcome('guide', 'dismissed');
    store.markTruncated();
    store.clear();
    expect(snapshot()).toMatchObject({ observations: [], outcomes: [], recent: [], coverage: { truncated: false } });
  });

  it('exports only fixed context fields, never arbitrary metadata from a JavaScript caller', () => {
    const { store } = setup();
    const supplied = { ...context, metadata: 'private input', schemaVersion: 'wrong' };
    const snapshot = store.snapshot(supplied);
    expect(snapshot.schemaVersion).toBe('0.1');
    expect(snapshot).not.toHaveProperty('metadata');
  });

  it('does not export an empty interval at the exact expiry boundary', () => {
    const { store, advance } = setup();
    advance(1_000);
    store.recordInterval('section', 'direct', 0, 1_000);
    advance(1_801_000);
    expect(store.export().records).toEqual([]);
    expect(store.restore(store.export())).toBe(true);
  });
});
