import {
  ObservationStore,
  canRecommend,
  createRulesEngine,
  evaluateSnapshot,
  isAllowedHref,
  validateDefinition,
  type ContentOutcome,
  type Decision,
  type DecisionEngine,
  type Snapshot,
  type Source,
} from '@imicue/core';
import type { RemoteEngine } from './remote.js';
export { createRemoteEngine } from './remote.js';
export type { RemoteEngine, RemoteOptions, RemoteDiagnostic } from './remote.js';

export type Consent = 'unknown' | 'granted' | 'denied';
export type DiagnosticCode =
  | 'consent_required' | 'destroyed' | 'not_started' | 'invalid_signal'
  | 'invalid_content' | 'invalid_page' | 'invalid_source' | 'nested_signal'
  | 'element_capacity' | 'record_capacity' | 'storage_unavailable'
  | 'storage_invalid' | 'storage_capacity' | 'callback_error'
  | 'observer_unavailable' | 'duplicate_tracker' | 'stale_decision'
  | 'clock_gap' | 'candidate_capacity' | 'engine_error';

export interface Diagnostic { readonly code: DiagnosticCode }

export interface TrackerOptions {
  readonly definition: unknown;
  readonly pageId: string;
  readonly engine?: DecisionEngine | RemoteEngine;
  readonly storage?: 'memory' | 'session';
  readonly root?: Document | Element;
  readonly allowedOrigins?: readonly string[];
  /** Monotonic observation clock and epoch clock for storage/availability only. */
  readonly clock?: { readonly now: () => number; readonly wallNow: () => number };
}

export interface TrackerState {
  readonly consent: Consent;
  readonly started: boolean;
  readonly destroyed: boolean;
  readonly observedElements: number;
  readonly revision: number;
}

export interface Tracker {
  setConsent(consent: 'granted' | 'denied'): void;
  start(): void;
  stop(): void;
  reset(): void;
  destroy(): void;
  refresh(): void;
  setPage(pageId: string, options?: { source?: Source }): void;
  track(signalId: string, options?: { source?: Source }): void;
  recordOutcome(contentId: string, kind: ContentOutcome['kind']): void;
  getSnapshot(): Snapshot;
  getState(): TrackerState;
  /** Rate-limited calls queue one latest evaluation and can return undefined. */
  evaluate(): Promise<Decision | undefined>;
  canDisplay(decision: Decision): boolean;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  onDecision(callback: (decision: Decision) => void): () => void;
  onDiagnostic(callback: (diagnostic: Diagnostic) => void): () => void;
}

interface Target { signalId: string; source: Source; exposed: boolean }
interface Episode {
  signalId: string;
  source: Source;
  active: boolean;
  since: number;
  committed: number;
  hiddenSince: number;
  qualified: boolean;
}

const WINDOW_MS = 30 * 60_000;
const STORAGE_BYTES = 128 * 1024;
const owners = new WeakMap<object, Map<string, Tracker>>();
const own = (object: object, key: string): boolean => Object.hasOwn(object, key);
const randomId = (): string => globalThis.crypto.randomUUID();
const validSource = (source: unknown): source is Source => source === 'direct' || source === 'recommendation';

/** Geometric exposure relative to the area that can fit in the viewport. */
export function exposureRatio(
  target: { width: number; height: number },
  intersection: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  const values = [target.width, target.height, intersection.width, intersection.height, viewport.width, viewport.height];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return 0;
  const potential = Math.min(target.width, viewport.width) * Math.min(target.height, viewport.height);
  return potential > 0 ? Math.max(0, Math.min(1, intersection.width * intersection.height / potential)) : 0;
}

/** Importing this module does not access window, document, or storage. */
export function createTracker(options: TrackerOptions): Tracker {
  const initialDiagnostics: DiagnosticCode[] = [];
  const definition = validateDefinition(options.definition, {
    allowedOrigins: options.allowedOrigins,
    onWarning: (code) => initialDiagnostics.push(code),
  });
  if (!own(definition.pages, options.pageId)) throw new Error('invalid_page');
  const now = options.clock?.now ?? (() => performance.now());
  const wallNow = options.clock?.wallNow ?? (() => Date.now());
  const engine = options.engine ?? createRulesEngine();
  const store = new ObservationStore(definition, { now });
  const storageKey = `imicue:${definition.siteId}:${definition.definitionVersion}`;
  const snapshots = new Set<(snapshot: Snapshot) => void>();
  const decisions = new Set<(decision: Decision) => void>();
  const diagnostics = new Set<(diagnostic: Diagnostic) => void>();
  const accepted = new WeakMap<Decision, { generation: number; at: number }>();
  const targets = new Map<Element, Target>();
  const episodes = new Map<string, Episode>();
  const clickTimes = new Map<string, number>();
  let consent: Consent = 'unknown';
  let started = false;
  let destroyed = false;
  let pageId = options.pageId;
  let pageViewId = randomId();
  let pageSource: Source = 'direct';
  let revision = 0;
  let generation = 0;
  let root: Document | Element | undefined = options.root;
  let doc: Document | undefined;
  let view: Window | undefined;
  let observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let evaluationTimer: ReturnType<typeof setTimeout> | undefined;
  let pulseDue = 0;
  let lastPulse = now();
  let lastInteraction = lastPulse;
  let idleUntil = lastPulse;
  let pageHidden = false;
  let lastScroll = -Infinity;
  let lastEvaluation = -Infinity;
  let pending = false;
  let inFlight: Promise<Decision | undefined> | undefined;
  let aborter: AbortController | undefined;
  let storageDisabled = options.storage !== 'session';
  let storageLoaded = false;
  let lastWall = wallNow();
  let activityWall = lastWall;
  let diagnosing = false;
  let recordTruncated = false;
  let elementCapacityExceeded = false;

  function diagnostic(code: DiagnosticCode): void {
    if (diagnosing) return;
    diagnosing = true;
    for (const callback of diagnostics) {
      try { callback(Object.freeze({ code })); } catch { /* Diagnostics never escape into site handlers. */ }
    }
    diagnosing = false;
  }

  function available(): boolean {
    if (destroyed) { diagnostic('destroyed'); return false; }
    return true;
  }

  function collecting(): boolean {
    if (!available()) return false;
    if (consent !== 'granted') { diagnostic('consent_required'); return false; }
    if (!started) { diagnostic('not_started'); return false; }
    return true;
  }

  function getSnapshot(): Snapshot {
    available();
    if (elementCapacityExceeded && started) store.markTruncated(now());
    return store.snapshot({ pageId, pageViewId, revision });
  }

  function emitSnapshot(): void {
    const snapshot = getSnapshot();
    if (snapshot.coverage.truncated && !recordTruncated) diagnostic('record_capacity');
    recordTruncated = snapshot.coverage.truncated;
    for (const callback of snapshots) {
      try { callback(snapshot); } catch { diagnostic('callback_error'); }
    }
  }

  function session(): Storage | undefined {
    try { return doc?.defaultView?.sessionStorage; } catch {
      storageDisabled = true;
      diagnostic('storage_unavailable');
      return undefined;
    }
  }

  function removeStored(): void {
    if (options.storage !== 'session') return;
    // Removal is explicitly authorized by reset/withdrawal, even before start.
    try {
      const documentForRemoval = doc ?? root?.ownerDocument ?? (root?.nodeType === 9 ? root as Document : undefined)
        ?? (typeof document === 'undefined' ? undefined : document);
      documentForRemoval?.defaultView?.sessionStorage.removeItem(storageKey);
    } catch { diagnostic('storage_unavailable'); }
  }

  function restore(): void {
    if (storageDisabled || storageLoaded) return;
    storageLoaded = true;
    const storage = session();
    if (!storage) return;
    try {
      const value = storage.getItem(storageKey);
      if (value === null) return;
      if (new TextEncoder().encode(value).byteLength > STORAGE_BYTES) throw new Error('size');
      const envelope: unknown = JSON.parse(value);
      const wall = wallNow();
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('format');
      const data = envelope as Record<string, unknown>;
      if (Object.keys(data).sort().join(',') !== 'activityAt,archive,definitionVersion,savedAt,siteId,version'
        || data.version !== 1 || data.siteId !== definition.siteId || data.definitionVersion !== definition.definitionVersion
        || typeof data.savedAt !== 'number' || typeof data.activityAt !== 'number'
        || !Number.isFinite(wall) || !Number.isFinite(data.savedAt) || !Number.isFinite(data.activityAt)
        || data.activityAt < 0 || data.savedAt < data.activityAt || data.savedAt > wall
        || wall < lastWall || wall - data.activityAt > WINDOW_MS
        || !store.restore(data.archive, wall - data.savedAt)) throw new Error('format');
      lastWall = wall;
    } catch {
      diagnostic('storage_invalid');
      try { storage.removeItem(storageKey); } catch { storageDisabled = true; diagnostic('storage_unavailable'); }
    }
  }

  function persist(): void {
    if (storageDisabled || consent !== 'granted' || !started) return;
    const storage = session();
    if (!storage) return;
    const wall = wallNow();
    if (!Number.isFinite(wall) || wall < lastWall) {
      removeStored();
      storageDisabled = true;
      diagnostic('storage_invalid');
      return;
    }
    lastWall = wall;
    const value = JSON.stringify({ version: 1, siteId: definition.siteId, definitionVersion: definition.definitionVersion,
      savedAt: wall, activityAt: activityWall, archive: store.export() });
    if (new TextEncoder().encode(value).byteLength > STORAGE_BYTES) {
      removeStored();
      storageDisabled = true;
      diagnostic('storage_capacity');
      return;
    }
    try { storage.setItem(storageKey, value); } catch {
      storageDisabled = true;
      diagnostic('storage_unavailable');
    }
  }

  function changed(): void {
    revision++;
    pending = true;
    if (elementCapacityExceeded && started) store.markTruncated(now());
    persist();
    emitSnapshot();
    scheduleEvaluation();
  }

  function isVisible(): boolean { return doc?.visibilityState === 'visible' && !pageHidden; }

  function invalidate(): void {
    generation++;
    aborter?.abort();
    pending = false;
    if (evaluationTimer !== undefined) clearTimeout(evaluationTimer);
    evaluationTimer = undefined;
  }

  function scheduleEvaluation(): void {
    if (!pending || !started || consent !== 'granted' || !isVisible() || inFlight || evaluationTimer !== undefined) return;
    const delay = Math.max(0, lastEvaluation + 15_000 - now());
    evaluationTimer = setTimeout(() => {
      evaluationTimer = undefined;
      void runEvaluation();
    }, delay);
  }

  function runEvaluation(): Promise<Decision | undefined> {
    if (!started || consent !== 'granted' || destroyed || !isVisible()) return Promise.resolve(undefined);
    pending = true;
    if (inFlight || now() < lastEvaluation + 15_000) {
      scheduleEvaluation();
      return Promise.resolve(undefined);
    }
    if (evaluationTimer !== undefined) clearTimeout(evaluationTimer);
    evaluationTimer = undefined;
    pending = false;
    const snapshot = getSnapshot();
    const currentGeneration = generation;
    const requestedAt = now();
    lastEvaluation = requestedAt;
    aborter = new AbortController();
    const controller = aborter;
    const evaluation = 'kind' in engine && engine.kind === 'remote'
      ? engine.evaluate(snapshot, { definition, now: wallNow(), signal: controller.signal })
      : evaluateSnapshot(definition, snapshot, engine as DecisionEngine, { now: wallNow(), signal: controller.signal });
    const work = evaluation
      .then((decision): Decision | undefined => {
        if (destroyed || !started || consent !== 'granted' || controller.signal.aborted
          || generation !== currentGeneration || revision !== snapshot.revision
          || pageViewId !== snapshot.pageViewId || now() - requestedAt > decision.maxAgeMs) {
          diagnostic('stale_decision');
          return undefined;
        }
        accepted.set(decision, { generation: currentGeneration, at: requestedAt });
        for (const callback of decisions) {
          // A previous callback can withdraw consent or change the page.
          if (generation !== currentGeneration || revision !== snapshot.revision || !started || consent !== 'granted') break;
          try { callback(decision); } catch { diagnostic('callback_error'); }
        }
        return decision;
      }).catch(() => { diagnostic('engine_error'); return undefined; })
      .finally(() => {
        if (inFlight === work) inFlight = undefined;
        if (aborter === controller) aborter = undefined;
        scheduleEvaluation();
      });
    inFlight = work;
    return work;
  }

  function commit(episode: Episode, at: number): boolean {
    if (!episode.active) return false;
    let dirty = false;
    if (!episode.qualified && at - episode.since >= 2_000) {
      dirty = store.recordEvent(episode.signalId, episode.source, 'qualified-view', episode.since + 2_000);
      episode.qualified = true;
    }
    if (at > episode.committed) {
      dirty = store.recordInterval(episode.signalId, episode.source, episode.committed, at) || dirty;
      episode.committed = at;
    }
    return dirty;
  }

  function closeAll(at: number): boolean {
    let dirty = false;
    for (const episode of episodes.values()) {
      dirty = commit(episode, at) || dirty;
      if (episode.active) { episode.active = false; episode.hiddenSince = at; }
    }
    return dirty;
  }

  function reconcile(at: number): boolean {
    const active = new Map<string, Target>();
    if (started && consent === 'granted' && isVisible() && at < idleUntil) {
      for (const target of targets.values()) if (target.exposed) active.set(`${target.signalId}:${target.source}`, target);
    }
    let dirty = false;
    for (const [key, episode] of episodes) {
      if (episode.active && !active.has(key)) {
        const end = Math.min(at, idleUntil);
        dirty = commit(episode, end) || dirty;
        episode.active = false;
        episode.hiddenSince = end;
      }
    }
    for (const [key, target] of active) {
      let episode = episodes.get(key);
      if (!episode) {
        episode = { ...target, active: false, since: at, committed: at, hiddenSince: -Infinity, qualified: false };
        episodes.set(key, episode);
      }
      if (!episode.active) {
        if (at - episode.hiddenSince >= 1_000) episode.qualified = false;
        episode.active = true;
        episode.since = at;
        episode.committed = at;
      }
    }
    return dirty;
  }

  function clearPulse(): void {
    if (pulseTimer !== undefined) clearTimeout(pulseTimer);
    pulseTimer = undefined;
  }

  function schedulePulse(): void {
    clearPulse();
    if (!started || !isVisible() || now() >= idleUntil) return;
    const at = now();
    let due = idleUntil;
    for (const episode of episodes.values()) if (episode.active) {
      due = Math.min(due, episode.committed + 5_000);
      if (!episode.qualified) due = Math.min(due, episode.since + 2_000);
    }
    pulseDue = due;
    pulseTimer = setTimeout(pulse, Math.max(0, due - at));
  }

  function clockCheck(at: number): boolean {
    // A delayed foreground callback must not turn a suspended device into viewing time.
    if (at < lastPulse || (pulseTimer !== undefined && at > pulseDue + 1_000)) {
      const dirty = closeAll(Math.max(0, lastPulse));
      idleUntil = at;
      clearPulse();
      diagnostic('clock_gap');
      if (dirty) changed();
      lastPulse = at;
      return false;
    }
    lastPulse = at;
    return true;
  }

  function pulse(): void {
    if (!started) return;
    const at = now();
    if (!clockCheck(at)) return;
    pulseTimer = undefined;
    let dirty = false;
    const end = Math.min(at, idleUntil);
    for (const episode of episodes.values()) if (episode.active) {
      if (!episode.qualified && end - episode.since >= 2_000) {
        dirty = store.recordEvent(episode.signalId, episode.source, 'qualified-view', episode.since + 2_000) || dirty;
        episode.qualified = true;
      }
      if (end - episode.committed >= 5_000 || at >= idleUntil) dirty = commit(episode, end) || dirty;
    }
    dirty = reconcile(at) || dirty;
    if (dirty) changed();
    schedulePulse();
  }

  function sourceFor(element: Element): Source {
    const explicit = element.closest('[data-imicue-source]')?.getAttribute('data-imicue-source');
    return validSource(explicit) ? explicit : pageSource;
  }

  function dimensions(): { width: number; height: number } {
    return { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 };
  }

  function rebuildObserver(): void {
    observer?.disconnect();
    observer = undefined;
    if (!view || !doc) return;
    const Observer = doc.defaultView?.IntersectionObserver;
    if (!Observer) { diagnostic('observer_unavailable'); return; }
    const viewport = dimensions();
    const thresholds = new Set<number>([0]);
    for (const element of targets.keys()) {
      const bounds = element.getBoundingClientRect();
      const targetArea = bounds.width * bounds.height;
      const potential = Math.min(bounds.width, viewport.width) * Math.min(bounds.height, viewport.height);
      if (Number.isFinite(targetArea) && targetArea > 0 && Number.isFinite(potential) && potential > 0) {
        thresholds.add(Math.min(1, 0.5 * potential / targetArea));
      }
    }
    const currentGeneration = generation;
    const next = new Observer((entries) => {
      if (!started || observer !== next || generation !== currentGeneration) return;
      const at = now();
      clockCheck(at);
      for (const entry of entries) {
        const target = targets.get(entry.target);
        if (target) target.exposed = entry.isIntersecting && exposureRatio(entry.boundingClientRect, entry.intersectionRect, dimensions()) >= 0.5;
      }
      if (reconcile(at)) changed();
      schedulePulse();
    }, { root: null, rootMargin: '0px', threshold: [...thresholds].sort((a, b) => a - b) });
    observer = next;
    for (const element of targets.keys()) observer.observe(element);
  }

  function refresh(): void {
    if (!collecting() || !root || !doc) return;
    observeMutations();
    const at = now();
    clockCheck(at);
    const elements = [...root.querySelectorAll('[data-imicue-signal]')];
    if (root.nodeType === 1 && (root as Element).matches('[data-imicue-signal]')) elements.unshift(root as Element);
    const valid = elements.filter((element) => {
      if (element.closest('[data-imicue-ignore]')) return false;
      const id = element.getAttribute('data-imicue-signal') ?? '';
      if (!own(definition.signals, id) || definition.signals[id]?.kind !== 'content') {
        diagnostic('invalid_signal');
        return false;
      }
      return true;
    });
    const parents = new Set<Element>();
    const validSet = new Set(valid);
    for (const element of valid) {
      let parent = element.parentElement;
      while (parent && (parent === root || root.contains(parent))) {
        if (validSet.has(parent)) parents.add(parent);
        if (parent === root) break;
        parent = parent.parentElement;
      }
    }
    if (parents.size) diagnostic('nested_signal');
    const leaves = valid.filter((element) => !parents.has(element));
    let dirty = false;
    const wasOverCapacity = elementCapacityExceeded;
    elementCapacityExceeded = leaves.length > 200;
    if (wasOverCapacity) store.markTruncated(at);
    if (elementCapacityExceeded) {
      store.markTruncated(at);
      if (!wasOverCapacity) diagnostic('element_capacity');
      dirty = !wasOverCapacity;
    }
    const oldElements = new Set(targets.keys());
    const nextTargets = new Map<Element, Target>();
    for (const element of leaves.slice(0, 200)) {
      const signalId = element.getAttribute('data-imicue-signal')!;
      const source = sourceFor(element);
      const previous = targets.get(element);
      nextTargets.set(element, previous?.signalId === signalId && previous.source === source
        ? previous : { signalId, source, exposed: false });
    }
    targets.clear();
    for (const [element, target] of nextTargets) targets.set(element, target);
    dirty = reconcile(at) || dirty;
    for (const element of oldElements) if (!targets.has(element)) resizeObserver?.unobserve(element);
    for (const element of targets.keys()) if (!oldElements.has(element)) resizeObserver?.observe(element);
    rebuildObserver();
    if (dirty) changed();
    schedulePulse();
  }

  function scheduleRefresh(): void {
    if (!started || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 0);
  }

  function mutations(records: MutationRecord[]): void {
    const relevant = records.some((record) => {
      if (record.type === 'attributes') return true;
      const nodes = [...record.addedNodes, ...record.removedNodes];
      // A bounded root can move without a mutation inside its own subtree.
      if (root?.nodeType === 1 && nodes.some((node) => node === root || node.contains(root!))) return true;
      if (root?.nodeType === 1 && record.target !== root && !root.contains(record.target)) return false;
      const target = record.target as Element;
      if (target.nodeType === 1 && target.closest('[data-imicue-ignore]')) return false;
      return nodes.some((node) => {
        if (node.nodeType !== 1) return false;
        const element = node as Element;
        return element.matches('[data-imicue-signal], [data-imicue-source], [data-imicue-ignore]')
          || element.querySelector('[data-imicue-signal]') !== null;
      });
    });
    if (relevant) scheduleRefresh();
  }

  function observeMutations(): void {
    if (!root || !mutationObserver) return;
    mutationObserver.disconnect();
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-imicue-signal', 'data-imicue-source', 'data-imicue-ignore'] });
    // Source/ignore applies to ancestors even when the measuring root is a small container.
    // Watch only each ancestor itself, never the rest of those ancestor subtrees.
    let ancestor = root.parentNode;
    while (ancestor) {
      mutationObserver.observe(ancestor, { childList: true, attributes: true,
        attributeFilter: ['data-imicue-source', 'data-imicue-ignore'] });
      ancestor = ancestor.parentNode;
    }
  }

  function interaction(event: Event): void {
    if (!started || !isVisible()) return;
    const at = now();
    if (event.type === 'scroll' && at - lastScroll < 250) return;
    if (event.type === 'scroll') lastScroll = at;
    clockCheck(at);
    const closed = at >= idleUntil && closeAll(idleUntil);
    lastInteraction = at;
    idleUntil = lastInteraction + 60_000;
    activityWall = wallNow();
    if (reconcile(at) || closed) changed();
    schedulePulse();
  }

  function click(event: Event): void {
    if (!started || consent !== 'granted') return;
    let element = event.target as Element | null;
    if (!element || element.nodeType !== 1 || element.closest('[data-imicue-ignore]')) return;
    while (element && (element === root || root?.contains(element))) {
      const target = targets.get(element);
      if (target) {
        const at = now();
        const previous = clickTimes.get(target.signalId) ?? -Infinity;
        if (at - previous < 500) return;
        clickTimes.set(target.signalId, at);
        if (store.recordEvent(target.signalId, target.source, 'click', at)) changed();
        return;
      }
      if (element === root) break;
      element = element.parentElement;
    }
  }

  function visibility(): void {
    if (!started) return;
    const at = now();
    clockCheck(at);
    if (!isVisible()) {
      const dirty = closeAll(Math.min(at, idleUntil));
      clearPulse();
      if (evaluationTimer !== undefined) clearTimeout(evaluationTimer);
      evaluationTimer = undefined;
      if (dirty) changed();
    } else {
      if (reconcile(at)) changed();
      schedulePulse();
      scheduleEvaluation();
    }
  }

  function pagehide(): void { pageHidden = true; visibility(); }
  function pageshow(): void { pageHidden = false; visibility(); }

  function stop(): void {
    if (!available() || !started) return;
    const at = now();
    clockCheck(at);
    if (elementCapacityExceeded) store.markTruncated(at);
    if (closeAll(Math.min(at, idleUntil))) { revision++; persist(); emitSnapshot(); }
    started = false;
    invalidate();
    clearPulse();
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    observer?.disconnect();
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    observer = undefined;
    resizeObserver = undefined;
    mutationObserver = undefined;
    root?.removeEventListener('click', click);
    doc?.removeEventListener('visibilitychange', visibility);
    doc?.removeEventListener('pointerdown', interaction);
    doc?.removeEventListener('keydown', interaction);
    doc?.removeEventListener('scroll', interaction, true);
    view?.removeEventListener('resize', scheduleRefresh);
    view?.removeEventListener('pagehide', pagehide);
    view?.removeEventListener('pageshow', pageshow);
    targets.clear();
    elementCapacityExceeded = false;
    if (root && owners.get(root)?.get(definition.siteId) === tracker) owners.get(root)?.delete(definition.siteId);
  }

  function start(): void {
    if (!available() || started) return;
    if (consent !== 'granted') { diagnostic('consent_required'); return; }
    root ??= typeof document === 'undefined' ? undefined : document;
    if (!root) { diagnostic('observer_unavailable'); return; }
    doc = root.nodeType === 9 ? root as Document : root.ownerDocument ?? undefined;
    view = doc?.defaultView ?? undefined;
    if (!doc || !view) { diagnostic('observer_unavailable'); return; }
    let registry = owners.get(root);
    if (!registry) { registry = new Map(); owners.set(root, registry); }
    if (registry.has(definition.siteId)) { diagnostic('duplicate_tracker'); return; }
    registry.set(definition.siteId, tracker);
    restore();
    started = true;
    pageHidden = false;
    lastPulse = now();
    lastInteraction = lastPulse;
    idleUntil = lastPulse + 60_000;
    activityWall = wallNow();
    const Mutation = doc.defaultView?.MutationObserver;
    const Resize = doc.defaultView?.ResizeObserver;
    if (Mutation) {
      mutationObserver = new Mutation(mutations);
    }
    if (Resize) resizeObserver = new Resize(scheduleRefresh);
    root.addEventListener('click', click);
    doc.addEventListener('visibilitychange', visibility);
    doc.addEventListener('pointerdown', interaction, { passive: true });
    doc.addEventListener('keydown', interaction);
    doc.addEventListener('scroll', interaction, { passive: true, capture: true });
    view.addEventListener('resize', scheduleRefresh);
    view.addEventListener('pagehide', pagehide);
    view.addEventListener('pageshow', pageshow);
    refresh();
    emitSnapshot();
  }

  function clearData(): void {
    invalidate();
    store.clear();
    episodes.clear();
    clickTimes.clear();
    removeStored();
    revision++;
    recordTruncated = false;
    pageViewId = randomId();
    emitSnapshot();
  }

  const tracker: Tracker = {
    setConsent(value) {
      if (!available()) return;
      if (value !== 'granted' && value !== 'denied') { diagnostic('consent_required'); return; }
      if (value === consent) return;
      if (value === 'denied') {
        stop();
        consent = 'denied';
        clearData();
      } else {
        consent = 'granted';
        invalidate();
        revision++;
      }
    },
    start,
    stop,
    reset() {
      if (!available()) return;
      clearData();
      if (started) {
        lastPulse = now();
        lastInteraction = lastPulse;
        idleUntil = lastPulse + 60_000;
        activityWall = wallNow();
        // Rebuild the generation-bound observer; retained geometry starts a new episode.
        reconcile(lastPulse);
        rebuildObserver();
        schedulePulse();
      }
    },
    destroy() {
      if (!available()) return;
      stop();
      destroyed = true;
      store.clear();
      episodes.clear();
      clickTimes.clear();
      snapshots.clear();
      decisions.clear();
      diagnostics.clear();
    },
    refresh,
    setPage(nextPageId, config) {
      if (!available()) return;
      if (!own(definition.pages, nextPageId)) { diagnostic('invalid_page'); return; }
      if (config?.source !== undefined && !validSource(config.source)) { diagnostic('invalid_source'); return; }
      const at = now();
      if (started) { clockCheck(at); closeAll(Math.min(at, idleUntil)); }
      invalidate();
      pageId = nextPageId;
      pageSource = config?.source ?? 'direct';
      pageViewId = randomId();
      episodes.clear();
      resizeObserver?.disconnect();
      targets.clear();
      changed();
      if (started) refresh();
    },
    track(signalId, config) {
      if (!collecting()) return;
      if (!own(definition.signals, signalId) || definition.signals[signalId]?.kind !== 'action') { diagnostic('invalid_signal'); return; }
      if (config?.source !== undefined && !validSource(config.source)) { diagnostic('invalid_source'); return; }
      if (config && Object.keys(config).some((key) => key !== 'source')) { diagnostic('invalid_signal'); return; }
      if (store.recordEvent(signalId, config?.source ?? pageSource, 'action', now())) changed();
    },
    recordOutcome(contentId, kind) {
      if (!collecting()) return;
      if (!own(definition.contents, contentId) || !['shown', 'clicked', 'dismissed', 'completed'].includes(kind)) {
        diagnostic('invalid_content'); return;
      }
      if (store.recordOutcome(contentId, kind, now())) changed();
    },
    getSnapshot,
    getState: () => {
      available();
      return Object.freeze({ consent, started, destroyed, observedElements: targets.size, revision });
    },
    evaluate() {
      if (!collecting()) return Promise.resolve(undefined);
      return runEvaluation();
    },
    canDisplay(decision) {
      if (destroyed || !started || consent !== 'granted' || !isVisible()) return false;
      const receipt = accepted.get(decision);
      if (!receipt || receipt.generation !== generation || decision.type !== 'recommend') return false;
      const content = definition.contents[decision.contentId];
      return !!content && isAllowedHref(content.href, options.allowedOrigins)
        && canRecommend(definition, getSnapshot(), decision, { now: wallNow(), ageMs: now() - receipt.at });
    },
    onSnapshot(callback) {
      if (!available()) return () => undefined;
      snapshots.add(callback);
      return () => { snapshots.delete(callback); };
    },
    onDecision(callback) {
      if (!available()) return () => undefined;
      decisions.add(callback);
      return () => { decisions.delete(callback); };
    },
    onDiagnostic(callback) {
      if (!available()) return () => undefined;
      diagnostics.add(callback);
      for (const code of initialDiagnostics) diagnostic(code);
      initialDiagnostics.length = 0;
      return () => { diagnostics.delete(callback); };
    },
  };
  return tracker;
}
