import type { Definition, Snapshot, Source, RecentEvent, ContentOutcome, SignalObservation } from './types';

type EventKind = RecentEvent['kind'];
type OutcomeKind = ContentOutcome['kind'];
type MutableObservation = { -readonly [K in keyof SignalObservation]: SignalObservation[K] };
type RecordEntry =
  | { type: 'interval'; signalId: string; source: Source; start: number; end: number }
  | { type: 'event'; signalId: string; source: Source; kind: EventKind; at: number }
  | { type: 'outcome'; contentId: string; kind: OutcomeKind; at: number };
export type StoreRecord =
  | { type: 'interval'; signalId: string; source: Source; startAgeMs: number; endAgeMs: number }
  | { type: 'event'; signalId: string; source: Source; kind: EventKind; ageMs: number }
  | { type: 'outcome'; contentId: string; kind: OutcomeKind; ageMs: number };
export interface StoreArchive { version: 1; records: StoreRecord[]; truncatedAgeMs: number | null }
export interface StoreOptions { now?: () => number; id?: () => string; windowMs?: number; capacity?: number }

const WINDOW_MS = 1_800_000;
const eventKinds = ['qualified-view', 'click', 'action'];
const outcomeKinds = ['shown', 'clicked', 'dismissed', 'completed'];
const time = (entry: RecordEntry) => entry.type === 'interval' ? entry.end : entry.at;
const sourceValid = (value: unknown): value is Source => value === 'direct' || value === 'recommendation';
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value: Record<string, unknown>, names: string[]) {
  return Object.keys(value).length === names.length && Object.keys(value).every((key) => names.includes(key));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Bounded, monotonic-time ledger. No DOM, persistence, network, or user identity. */
export class ObservationStore {
  private records: RecordEntry[] = [];
  private truncatedAt: number | null = null;
  private readonly now: () => number;
  private readonly id: () => string;
  readonly windowMs: number;
  readonly capacity: number;

  constructor(private readonly definition: Definition, options: StoreOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.id = options.id ?? (() => globalThis.crypto.randomUUID());
    this.windowMs = options.windowMs ?? WINDOW_MS;
    this.capacity = options.capacity ?? 1_000;
    if (!Number.isInteger(this.windowMs) || this.windowMs <= 0 || this.windowMs > WINDOW_MS
      || !Number.isInteger(this.capacity) || this.capacity <= 0 || this.capacity > 1_000) {
      throw new Error('invalid_store_options');
    }
  }

  private knownSignal(id: unknown): id is string {
    return typeof id === 'string' && Object.hasOwn(this.definition.signals, id);
  }
  private knownContent(id: unknown): id is string {
    return typeof id === 'string' && Object.hasOwn(this.definition.contents, id);
  }
  private validEvent(id: string, kind: unknown): kind is EventKind {
    const definition = this.definition.signals[id];
    return typeof kind === 'string' && eventKinds.includes(kind) && !!definition
      && (kind === 'action' ? definition.kind === 'action' : definition.kind === 'content');
  }
  private prune(now: number) {
    this.records = this.records.filter((entry) => entry.type === 'interval'
      ? entry.end > now - this.windowMs : entry.at >= now - this.windowMs);
    if (this.truncatedAt !== null && this.truncatedAt < now - this.windowMs) this.truncatedAt = null;
  }
  markTruncated(at = this.now()): void {
    if (!Number.isFinite(at) || at > this.now()) return;
    this.truncatedAt = Math.max(this.truncatedAt ?? -Infinity, at);
  }
  private append(entry: RecordEntry) {
    const now = this.now();
    this.prune(now);
    if (time(entry) < now - this.windowMs) return;
    this.records.push(entry);
    this.records.sort((a, b) => time(a) - time(b));
    while (this.records.length > this.capacity) {
      const dropped = this.records.shift();
      if (dropped) this.markTruncated(time(dropped));
    }
    const outcomes = this.records.filter((record) => record.type === 'outcome');
    for (const dropped of outcomes.slice(0, Math.max(0, outcomes.length - 100))) {
      this.markTruncated(time(dropped));
      this.records.splice(this.records.indexOf(dropped), 1);
    }
  }
  recordEvent(signalId: string, source: Source, kind: EventKind, at = this.now()): boolean {
    if (!this.knownSignal(signalId) || !sourceValid(source) || !this.validEvent(signalId, kind)
      || !Number.isFinite(at) || at > this.now()) return false;
    this.append({ type: 'event', signalId, source, kind, at });
    return true;
  }
  recordInterval(signalId: string, source: Source, start: number, end: number): boolean {
    if (!this.knownSignal(signalId) || this.definition.signals[signalId]?.kind !== 'content'
      || !sourceValid(source) || !Number.isFinite(start) || !Number.isFinite(end)
      || end <= start || end > this.now()) return false;
    // Split long input and retain only the overlap; a suspended timer cannot create unbounded work.
    for (let cursor = Math.max(start, this.now() - this.windowMs); cursor < end; cursor += 5_000) {
      this.append({ type: 'interval', signalId, source, start: cursor, end: Math.min(cursor + 5_000, end) });
    }
    return true;
  }
  recordOutcome(contentId: string, kind: OutcomeKind, at = this.now()): boolean {
    if (!this.knownContent(contentId) || !outcomeKinds.includes(kind) || !Number.isFinite(at) || at > this.now()) return false;
    this.append({ type: 'outcome', contentId, kind, at });
    return true;
  }
  clear(): void { this.records = []; this.truncatedAt = null; }

  snapshot(context: { pageId: string; pageViewId: string; revision: number }): Snapshot {
    const now = this.now();
    this.prune(now);
    const rows = new Map<string, MutableObservation>();
    const spans = new Map<string, Array<[number, number]>>();
    const recent: RecentEvent[] = [];
    const outcomes: ContentOutcome[] = [];
    const age = (at: number) => Math.min(this.windowMs, Math.max(0, Math.floor(now - at)));
    for (const entry of [...this.records].reverse()) {
      if (entry.type === 'outcome') {
        outcomes.push({ contentId: entry.contentId, kind: entry.kind, ageMs: age(entry.at) });
        continue;
      }
      const key = `${entry.signalId}:${entry.source}`;
      const row = rows.get(key) ?? {
        signalId: entry.signalId, source: entry.source, qualifiedViews: 0, visibleMs: 0,
        clicks: 0, actions: 0, lastSeenAgoMs: this.windowMs,
      };
      row.lastSeenAgoMs = Math.min(row.lastSeenAgoMs, age(time(entry)));
      rows.set(key, row);
      if (entry.type === 'interval') {
        const intervals = spans.get(key) ?? [];
        intervals.push([Math.max(now - this.windowMs, entry.start), Math.min(now, entry.end)]);
        spans.set(key, intervals);
      } else {
        if (entry.kind === 'qualified-view') row.qualifiedViews++;
        else if (entry.kind === 'click') row.clicks++;
        else row.actions++;
        if (recent.length < 20) recent.push({ signalId: entry.signalId, source: entry.source, kind: entry.kind, ageMs: age(entry.at) });
      }
    }
    for (const [key, intervals] of spans) {
      intervals.sort((a, b) => a[0] - b[0]);
      let total = 0;
      let previousEnd = -Infinity;
      for (const [start, end] of intervals) {
        total += Math.max(0, end - Math.max(start, previousEnd));
        previousEnd = Math.max(previousEnd, end);
      }
      const row = rows.get(key);
      if (row) row.visibleMs = Math.min(this.windowMs, Math.floor(total));
    }
    return freeze({
      schemaVersion: '0.1', siteId: this.definition.siteId, definitionVersion: this.definition.definitionVersion,
      snapshotId: this.id(), pageId: context.pageId, pageViewId: context.pageViewId,
      revision: context.revision, windowMs: this.windowMs,
      observations: [...rows.values()].filter((row) => row.visibleMs + row.qualifiedViews + row.clicks + row.actions > 0)
        .sort((a, b) => a.signalId.localeCompare(b.signalId) || a.source.localeCompare(b.source)),
      recent, outcomes, coverage: { truncated: this.truncatedAt !== null },
    });
  }

  export(): StoreArchive {
    const now = this.now();
    this.prune(now);
    return {
      version: 1,
      records: this.records.map((entry): StoreRecord => {
        if (entry.type === 'interval') return { type: 'interval', signalId: entry.signalId, source: entry.source,
          startAgeMs: Math.min(this.windowMs, now - entry.start), endAgeMs: now - entry.end };
        if (entry.type === 'event') return { type: 'event', signalId: entry.signalId, source: entry.source, kind: entry.kind, ageMs: now - entry.at };
        return { type: 'outcome', contentId: entry.contentId, kind: entry.kind, ageMs: now - entry.at };
      }),
      truncatedAgeMs: this.truncatedAt === null ? null : now - this.truncatedAt,
    };
  }
  exportData(): StoreArchive { return this.export(); }

  /** Validate before applying an archive; wall-clock expiry is owned by the browser envelope. */
  restore(value: unknown, elapsedMs = 0): boolean {
    const validAge = (age: unknown): age is number => typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= this.windowMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !object(value)
      || !keys(value, ['version', 'records', 'truncatedAgeMs']) || value.version !== 1
      || !Array.isArray(value.records) || value.records.length > this.capacity
      || (value.truncatedAgeMs !== null && !validAge(value.truncatedAgeMs))) return false;
    const now = this.now();
    const restored: RecordEntry[] = [];
    let outcomeCount = 0;
    for (const entry of value.records) {
      if (!object(entry)) return false;
      if (entry.type === 'interval') {
        if (!keys(entry, ['type', 'signalId', 'source', 'startAgeMs', 'endAgeMs'])
          || !this.knownSignal(entry.signalId) || this.definition.signals[entry.signalId]?.kind !== 'content'
          || !sourceValid(entry.source) || !validAge(entry.startAgeMs) || !validAge(entry.endAgeMs)
          || entry.startAgeMs <= entry.endAgeMs || entry.startAgeMs - entry.endAgeMs > 5_000) return false;
        restored.push({ type: 'interval', signalId: entry.signalId, source: entry.source,
          start: now - elapsedMs - entry.startAgeMs, end: now - elapsedMs - entry.endAgeMs });
      } else if (entry.type === 'event') {
        if (!keys(entry, ['type', 'signalId', 'source', 'kind', 'ageMs']) || !this.knownSignal(entry.signalId)
          || !sourceValid(entry.source) || !this.validEvent(entry.signalId, entry.kind) || !validAge(entry.ageMs)) return false;
        restored.push({ type: 'event', signalId: entry.signalId, source: entry.source, kind: entry.kind, at: now - elapsedMs - entry.ageMs });
      } else if (entry.type === 'outcome') {
        if (!keys(entry, ['type', 'contentId', 'kind', 'ageMs']) || !this.knownContent(entry.contentId)
          || typeof entry.kind !== 'string' || !outcomeKinds.includes(entry.kind) || !validAge(entry.ageMs) || ++outcomeCount > 100) return false;
        restored.push({ type: 'outcome', contentId: entry.contentId, kind: entry.kind as OutcomeKind, at: now - elapsedMs - entry.ageMs });
      } else return false;
    }
    this.records = restored.sort((a, b) => time(a) - time(b));
    this.truncatedAt = value.truncatedAgeMs === null ? null : now - elapsedMs - value.truncatedAgeMs;
    this.prune(now);
    return true;
  }
}
