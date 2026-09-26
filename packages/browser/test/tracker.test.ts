// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRulesEngine, type Decision, type DecisionEngine, type Definition } from '@imicue/core';
import { createTracker, exposureRatio, type Tracker, type TrackerOptions } from '../src/index.js';

const definition: Definition = {
  schemaVersion: '0.1', siteId: 'browser-test', definitionVersion: 'test-1',
  topics: { feature: { description: 'A synthetic feature' } },
  signals: {
    section: { kind: 'content', description: 'Synthetic feature section', topicIds: ['feature'] },
    second: { kind: 'content', description: 'Second synthetic section' },
    action: { kind: 'action', description: 'Synthetic registered operation' },
  },
  contents: { guide: { title: 'Guide', description: 'A synthetic guide', href: '/guide/', enabled: true,
    relatedSignalIds: ['section', 'action'] } },
  pages: { home: {}, other: {}, guide: { contentId: 'guide' } },
};

const bounds = (width: number, height: number): DOMRectReadOnly => ({
  x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}),
});

class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds: number[];
  readonly delay = 0;
  readonly scrollMargin = '0px';
  readonly trackVisibility = false;
  readonly elements = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element): void { this.elements.add(element); }
  unobserve(element: Element): void { this.elements.delete(element); }
  disconnect(): void { this.disconnected = true; this.elements.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  emit(element: Element, height = element.getBoundingClientRect().height): void {
    const target = element.getBoundingClientRect();
    const rect = bounds(target.width, height);
    this.callback([{ target: element, boundingClientRect: target, intersectionRect: rect,
      rootBounds: bounds(1000, 800), intersectionRatio: height / target.height,
      isIntersecting: height > 0, time: performance.now() }], this);
  }
}

class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly elements = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe(element: Element): void { this.elements.add(element); }
  unobserve(element: Element): void { this.elements.delete(element); }
  disconnect(): void { this.elements.clear(); }
  emit(): void { this.callback([], this); }
}

let trackers: Tracker[];
let offset: number;
const epoch = Date.UTC(2026, 8, 26);

function setup(options: Partial<TrackerOptions> = {}): Tracker {
  const tracker = createTracker({ definition, pageId: 'home',
    clock: { now: () => Date.now() - epoch + offset, wallNow: () => Date.now() }, ...options });
  trackers.push(tracker);
  return tracker;
}

function begin(tracker: Tracker): void { tracker.setConsent('granted'); tracker.start(); }
function io(): FakeIntersectionObserver {
  const instance = [...FakeIntersectionObserver.instances].reverse().find((item) => !item.disconnected);
  if (!instance) throw new Error('No observer');
  return instance;
}
function element(id = 'section'): Element { return document.querySelector(`[data-imicue-signal="${id}"]`)!; }
function observed(tracker: Tracker, id = 'section', source = 'direct') {
  return tracker.getSnapshot().observations.find((row) => row.signalId === id && row.source === source);
}
async function advance(ms: number): Promise<void> { await vi.advanceTimersByTimeAsync(ms); }
function visibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  offset = 0;
  trackers = [];
  FakeIntersectionObserver.instances = [];
  FakeResizeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(bounds(1000, 400));
  document.body.innerHTML = '<section data-imicue-signal="section"><button type="button">Action</button></section>';
  sessionStorage.clear();
});

afterEach(() => {
  for (const tracker of trackers) tracker.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('B01/B02 — visible duration and union episodes', () => {
  it.each([1000, 3000, 20_000])('counts %i ms separately from qualified views', async (duration) => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(duration); io().emit(element(), 0);
    expect(observed(tracker)?.visibleMs).toBe(duration);
    expect(observed(tracker)?.qualifiedViews).toBe(duration < 2000 ? 0 : 1);
  });

  it('retains a qualified episode across <1s gaps, then starts another after >=1s', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(3000); io().emit(element(), 0);
    await advance(999); io().emit(element());
    await advance(3000); io().emit(element(), 0);
    expect(observed(tracker)?.qualifiedViews).toBe(1);
    await advance(1000); io().emit(element());
    await advance(2000); io().emit(element(), 0);
    expect(observed(tracker)?.qualifiedViews).toBe(2);
    expect(observed(tracker)?.visibleMs).toBe(8000);
  });

  it('resets the unqualified continuous period even for a short gap', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(1500); io().emit(element(), 0);
    await advance(100); io().emit(element());
    await advance(1500); io().emit(element(), 0);
    expect(observed(tracker)?.qualifiedViews).toBe(0);
    expect(observed(tracker)?.visibleMs).toBe(3000);
  });

  it('snapshot reads are frozen and do not change revision', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(5000);
    const first = tracker.getSnapshot();
    const second = tracker.getSnapshot();
    expect(first.revision).toBe(second.revision);
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(Object.isFrozen(first.observations[0])).toBe(true);
  });

  it('credits a continuous qualified view when stop precedes a slightly delayed timer', () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    offset = 2500;
    tracker.stop();
    expect(observed(tracker)?.qualifiedViews).toBe(1);
    expect(observed(tracker)?.visibleMs).toBe(2500);
  });
});

describe('B03 — actual IO thresholds for long sections', () => {
  it('uses viewport-adjusted thresholds and rebuilds on element/viewport resize', async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(bounds(1000, 3000));
    const tracker = setup(); begin(tracker);
    expect(io().thresholds).toContain(0.5 * 800 / 3000);
    io().emit(element(), 800);
    await advance(3000); io().emit(element(), 0);
    expect(observed(tracker)?.qualifiedViews).toBe(1);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(bounds(1000, 4000));
    FakeResizeObserver.instances[0]!.emit();
    await advance(0);
    expect(io().thresholds).toContain(0.5 * 800 / 4000);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    window.dispatchEvent(new Event('resize'));
    await advance(0);
    expect(io().thresholds).toContain(0.5 * 600 / 4000);
  });

  it('rejects zero/nonfinite geometry and handles short-element exposure', () => {
    expect(exposureRatio(bounds(1000, 3000), bounds(1000, 800), bounds(1000, 800))).toBe(1);
    expect(exposureRatio(bounds(1000, 400), bounds(1000, 199), bounds(1000, 800))).toBeLessThan(0.5);
    expect(exposureRatio(bounds(0, 400), bounds(1000, 300), bounds(1000, 800))).toBe(0);
    expect(exposureRatio(bounds(Infinity, 400), bounds(1000, 300), bounds(1000, 800))).toBe(0);
  });
});

describe('B04 — visibility, idle and suspended clocks', () => {
  it('excludes hidden time and resumes only the eligible interval', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(3000); visibility('hidden');
    await advance(10_000); visibility('visible');
    await advance(3000); tracker.stop();
    expect(observed(tracker)?.visibleMs).toBe(6000);
    expect(observed(tracker)?.qualifiedViews).toBe(2);
  });

  it('stops at 60 seconds of inactivity and resumes after an operation', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(90_000);
    expect(observed(tracker)?.visibleMs).toBe(60_000);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'private input must not be retained' }));
    await advance(3000); tracker.stop();
    expect(observed(tracker)?.visibleMs).toBe(63_000);
    expect(JSON.stringify(tracker.getSnapshot())).not.toContain('private input');
  });

  it('never accounts a delayed callback as device-sleep viewing time', async () => {
    const tracker = setup(); const diagnostics: string[] = [];
    tracker.onDiagnostic((event) => diagnostics.push(event.code));
    begin(tracker); io().emit(element());
    await advance(2000);
    offset = 120_000;
    await advance(3000);
    expect(observed(tracker)?.visibleMs).toBe(2000);
    expect(diagnostics).toContain('clock_gap');
    await advance(30_000);
    expect(observed(tracker)?.visibleMs).toBe(2000);
  });

  it('closes intervals on pagehide and resumes a BFCache pageshow without counting hidden time', async () => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(3000); window.dispatchEvent(new Event('pagehide'));
    await advance(10_000); window.dispatchEvent(new Event('pageshow'));
    await advance(3000); tracker.stop();
    expect(observed(tracker)?.visibleMs).toBe(6000);
  });

  it.each(['interaction', 'intersection'])('clips the idle cutoff when %s precedes the delayed idle timer', async (trigger) => {
    const tracker = setup(); begin(tracker); io().emit(element());
    await advance(55_000);
    offset = 5500;
    if (trigger === 'interaction') document.dispatchEvent(new Event('pointerdown'));
    else io().emit(element(), 0);
    expect(observed(tracker)?.visibleMs).toBe(60_000);
    tracker.stop();
    expect(observed(tracker)?.visibleMs).toBe(60_000);
  });
});

describe('B05 — duplicate targets and delegated input', () => {
  it('uses the union of same-ID elements and assigns one closest leaf click', async () => {
    document.body.innerHTML = '<section data-imicue-signal="second"><div data-imicue-signal="section"><button>Click</button></div></section><div data-imicue-signal="section">Duplicate</div>';
    const tracker = setup(); const diagnostics: string[] = [];
    tracker.onDiagnostic((event) => diagnostics.push(event.code));
    begin(tracker);
    const leaves = [...document.querySelectorAll('[data-imicue-signal="section"]')];
    expect(io().elements.has(element('second'))).toBe(false);
    expect(diagnostics).toContain('nested_signal');
    io().emit(leaves[0]!); io().emit(leaves[1]!);
    await advance(3000); io().emit(leaves[0]!, 0);
    await advance(2000); io().emit(leaves[1]!, 0);
    expect(observed(tracker)?.visibleMs).toBe(5000);
    expect(observed(tracker)?.qualifiedViews).toBe(1);
    const button = document.querySelector('button')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(click); button.click();
    await advance(499); button.click();
    expect(observed(tracker)?.clicks).toBe(1);
    await advance(1); button.click();
    expect(observed(tracker)?.clicks).toBe(2);
    expect(observed(tracker, 'second')).toBeUndefined();
    expect(click.defaultPrevented).toBe(false);
  });

  it('honors ignores and the closest explicit source without collecting input or DOM text', async () => {
    document.body.innerHTML = '<div data-imicue-source="recommendation"><section data-imicue-signal="section"><b>secret DOM text</b></section><div data-imicue-source="direct"><section data-imicue-signal="second"></section></div></div><form data-imicue-ignore><div data-imicue-signal="section"><input value="secret input"></div></form>';
    const tracker = setup(); begin(tracker);
    expect(tracker.getState().observedElements).toBe(2);
    io().emit(element()); io().emit(element('second'));
    await advance(3000); tracker.stop();
    expect(observed(tracker, 'section', 'recommendation')?.qualifiedViews).toBe(1);
    expect(observed(tracker, 'second', 'direct')?.qualifiedViews).toBe(1);
    expect(JSON.stringify(tracker.getSnapshot())).not.toMatch(/secret|value|textContent/);
  });
});

describe('B06 — mutation and cleanup', () => {
  it('batches mutation registration, removal, source changes and ignores', async () => {
    const tracker = setup(); begin(tracker);
    const extra = document.createElement('section'); extra.dataset.imicueSignal = 'second';
    document.body.append(extra);
    await advance(1);
    expect(tracker.getState().observedElements).toBe(2);
    io().emit(extra);
    await advance(1000); extra.remove();
    await advance(1);
    expect(tracker.getState().observedElements).toBe(1);
    expect(observed(tracker, 'second')?.visibleMs).toBeGreaterThanOrEqual(1000);
    element().setAttribute('data-imicue-source', 'recommendation');
    await advance(1); io().emit(element());
    await advance(2000); element().setAttribute('data-imicue-ignore', '');
    await advance(1);
    expect(tracker.getState().observedElements).toBe(0);
    expect(observed(tracker, 'section', 'recommendation')?.qualifiedViews).toBe(1);
  });

  it('is idempotent, guards duplicate instances, and leaves no active observers or timers', async () => {
    const tracker = setup(); begin(tracker); tracker.start();
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const duplicate = setup(); const diagnostics: string[] = [];
    duplicate.onDiagnostic((event) => diagnostics.push(event.code)); begin(duplicate);
    expect(duplicate.getState().started).toBe(false);
    expect(diagnostics).toContain('duplicate_tracker');
    tracker.stop(); tracker.start();
    document.querySelector('button')!.click();
    expect(observed(tracker)?.clicks).toBe(1);
    await advance(1);
    tracker.destroy();
    expect(FakeIntersectionObserver.instances.every((item) => item.disconnected)).toBe(true);
    expect(FakeResizeObserver.instances.every((item) => item.elements.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => { tracker.start(); tracker.track('action'); tracker.reset(); }).not.toThrow();
    begin(duplicate);
    expect(duplicate.getState().started).toBe(true);
  });

  it('isolates throwing callbacks and supports subscription removal', async () => {
    const tracker = setup(); const codes: string[] = []; const callback = vi.fn();
    tracker.onDiagnostic((event) => codes.push(event.code));
    tracker.onDiagnostic(() => { throw new Error('private text'); });
    tracker.onSnapshot(() => { throw new Error('private text'); });
    const unsubscribe = tracker.onSnapshot(callback);
    begin(tracker); unsubscribe(); const calls = callback.mock.calls.length;
    tracker.track('action'); await tracker.evaluate();
    expect(callback).toHaveBeenCalledTimes(calls);
    expect(codes).toContain('callback_error');
    expect(codes.join()).not.toContain('private text');
  });

  it('does not rescan for unrelated debug text changes or enter a >200 capacity feedback loop', async () => {
    document.body.innerHTML = '<div data-imicue-signal="section"></div>'.repeat(201) + '<pre id="debug" data-imicue-ignore></pre>';
    const tracker = setup();
    tracker.onSnapshot((snapshot) => { document.getElementById('debug')!.textContent = JSON.stringify(snapshot); });
    tracker.onDiagnostic((event) => { document.getElementById('debug')!.textContent = event.code; });
    begin(tracker);
    const scan = vi.spyOn(document, 'querySelectorAll');
    for (let index = 0; index < 20; index++) {
      document.getElementById('debug')!.textContent = `debug update ${index}`;
      document.dispatchEvent(new Event('scroll'));
      await advance(10);
    }
    expect(scan).not.toHaveBeenCalled();
    expect(tracker.getState().observedElements).toBe(200);
  });

  it('updates inherited ignore/source for bounded roots and reconnects after root moves', async () => {
    document.body.innerHTML = '<div id="outer"><main id="root"><section data-imicue-signal="section"></section></main></div><aside id="next" data-imicue-source="recommendation"></aside>';
    const root = document.getElementById('root')!;
    const outer = document.getElementById('outer')!;
    const next = document.getElementById('next')!;
    const tracker = setup({ root }); begin(tracker); io().emit(element());
    await advance(1000); outer.setAttribute('data-imicue-ignore', '');
    await advance(1);
    expect(tracker.getState().observedElements).toBe(0);
    expect(observed(tracker)?.visibleMs).toBeGreaterThanOrEqual(1000);
    next.append(root);
    await advance(1);
    expect(tracker.getState().observedElements).toBe(1);
    io().emit(element());
    await advance(3000); next.setAttribute('data-imicue-ignore', '');
    await advance(1);
    expect(tracker.getState().observedElements).toBe(0);
    expect(observed(tracker, 'section', 'recommendation')?.qualifiedViews).toBe(1);
    next.removeAttribute('data-imicue-ignore'); next.setAttribute('data-imicue-source', 'direct');
    await advance(1); io().emit(element());
    await advance(3000); tracker.stop();
    expect(observed(tracker)?.qualifiedViews).toBe(1);
  });
});

describe('B07/B09 — consent and opt-in storage', () => {
  const key = 'imicue:browser-test:test-1';

  it('does not read/write storage, observe, or evaluate before consent plus start', async () => {
    sessionStorage.setItem(key, 'broken but not read');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const rules = createRulesEngine(); const evaluate = vi.fn(rules.evaluate);
    const engine: DecisionEngine = { ...rules, evaluate };
    const tracker = setup({ storage: 'session', engine });
    tracker.start(); tracker.track('action'); await tracker.evaluate();
    tracker.setConsent('granted');
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(0); expect(evaluate).not.toHaveBeenCalled();
    tracker.start(); expect(read).toHaveBeenCalledTimes(1);
  });

  it('restores only after start, keeps session storage on destroy, and removes only its own data on withdrawal', () => {
    const first = setup({ storage: 'session' }); begin(first); first.track('action');
    first.destroy();
    const second = setup({ storage: 'session' });
    expect(second.getSnapshot().observations).toHaveLength(0);
    begin(second); expect(observed(second, 'action')?.actions).toBe(1);
    sessionStorage.setItem('other-app', 'untouched');
    second.setConsent('denied');
    expect(second.getSnapshot().observations).toHaveLength(0);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem('other-app')).toBe('untouched');
    second.setConsent('granted'); second.track('action');
    expect(second.getSnapshot().observations).toHaveLength(0);
    second.start(); second.track('action');
    expect(observed(second, 'action')?.actions).toBe(1);
  });

  it.each(['broken', 'future', 'old', 'expired', 'oversize', 'fields'])('discards %s storage safely', (variant) => {
    const first = setup({ storage: 'session' }); begin(first); first.track('action'); first.destroy();
    const valid = JSON.parse(sessionStorage.getItem(key)!) as Record<string, unknown>;
    if (variant === 'future') valid.savedAt = epoch + 1;
    if (variant === 'old') valid.version = 0;
    if (variant === 'expired') { valid.savedAt = epoch - 1_800_001; valid.activityAt = epoch - 1_800_001; }
    if (variant === 'fields') valid.metadata = 'must reject';
    sessionStorage.setItem(key, variant === 'broken' ? '{' : variant === 'oversize' ? ' '.repeat(128 * 1024 + 1) : JSON.stringify(valid));
    sessionStorage.setItem('other-app', 'untouched');
    const next = setup({ storage: 'session' }); const codes: string[] = [];
    next.onDiagnostic((event) => codes.push(event.code)); begin(next);
    expect(next.getSnapshot().observations).toHaveLength(0);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(codes).toContain('storage_invalid');
    expect(sessionStorage.getItem('other-app')).toBe('untouched');
  });

  it('falls back to memory on denied storage and discards persisted data after wall-clock rollback', () => {
    const tracker = setup({ storage: 'session' }); const codes: string[] = [];
    tracker.onDiagnostic((event) => codes.push(event.code));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota'); });
    begin(tracker); tracker.track('action');
    expect(observed(tracker, 'action')?.actions).toBe(1);
    expect(codes).toContain('storage_unavailable');
    write.mockRestore(); tracker.destroy();
    let wall = epoch;
    const next = setup({ storage: 'session', clock: { now: () => 0, wallNow: () => wall } });
    begin(next); next.track('action'); expect(sessionStorage.getItem(key)).not.toBeNull();
    wall -= 1; next.track('action');
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(observed(next, 'action')?.actions).toBe(2);
  });

  it('reset retains start/consent, clears suppression, and starts fresh observation episodes', async () => {
    const tracker = setup({ storage: 'session' }); begin(tracker); io().emit(element());
    await advance(3000); tracker.recordOutcome('guide', 'dismissed'); tracker.reset();
    expect(tracker.getState()).toMatchObject({ consent: 'granted', started: true });
    expect(tracker.getSnapshot().outcomes).toHaveLength(0);
    expect(tracker.getSnapshot().observations).toHaveLength(0);
    await advance(3000); tracker.stop();
    expect(observed(tracker)?.qualifiedViews).toBe(1);
    expect(observed(tracker)?.visibleMs).toBe(3000);
  });
});

describe('B08 — scheduler, stale asynchronous results and render guards', () => {
  function delayed() {
    const resolvers: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const evaluate = vi.fn<DecisionEngine['evaluate']>((input, options) => {
      signals.push(options.signal);
      return new Promise((resolve) => resolvers.push(() => resolve({ assessments: input.candidates.map((candidate) => ({
        contentId: candidate.contentId, score: 0.8, scoreKind: 'heuristic' as const,
      })) })));
    });
    const engine: DecisionEngine = { name: 'rules', version: 'test-delayed', evaluate };
    return { engine, evaluate, signals, resolve: () => resolvers.shift()?.() };
  }

  it.each(['withdraw', 'page', 'reset', 'stop', 'revision'])('discards a delayed result after %s', async (action) => {
    const delay = delayed(); const tracker = setup({ engine: delay.engine }); const outputs: Decision[] = [];
    tracker.onDecision((decision) => outputs.push(decision)); begin(tracker); tracker.track('action');
    const result = tracker.evaluate();
    if (action === 'withdraw') tracker.setConsent('denied');
    if (action === 'page') tracker.setPage('other');
    if (action === 'reset') tracker.reset();
    if (action === 'stop') tracker.stop();
    if (action === 'revision') tracker.track('action');
    delay.resolve(); expect(await result).toBeUndefined();
    expect(outputs).toHaveLength(0);
    if (action !== 'revision') expect(delay.signals[0]?.aborted).toBe(true);
  });

  it('coalesces changes and manual calls into one latest snapshot per >=15s with concurrency one', async () => {
    const delay = delayed(); const tracker = setup({ engine: delay.engine }); begin(tracker);
    tracker.track('action'); const first = tracker.evaluate();
    for (let count = 0; count < 30; count++) { tracker.track('action'); await tracker.evaluate(); }
    expect(delay.evaluate).toHaveBeenCalledTimes(1);
    await advance(20_000); expect(delay.evaluate).toHaveBeenCalledTimes(1);
    delay.resolve(); await first; await advance(0);
    expect(delay.evaluate).toHaveBeenCalledTimes(2);
    expect(delay.evaluate.mock.calls[1]?.[0].snapshot.observations[0]?.actions).toBe(31);
    delay.resolve(); await advance(0);
    await advance(30_000);
    expect(delay.evaluate).toHaveBeenCalledTimes(2);
  });

  it('does not automatically evaluate hidden or unchanged state', async () => {
    const rules = createRulesEngine(); const evaluate = vi.fn(rules.evaluate);
    const engine: DecisionEngine = { ...rules, evaluate };
    const tracker = setup({ engine }); begin(tracker); visibility('hidden');
    tracker.track('action'); await advance(20_000); expect(evaluate).not.toHaveBeenCalled();
    visibility('visible'); await advance(0); expect(evaluate).toHaveBeenCalledTimes(1);
    await advance(30_000); expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('rechecks provenance, age, revision, candidate exclusion and consent at display time', async () => {
    const tracker = setup(); begin(tracker); tracker.track('action');
    const decision = await tracker.evaluate(); expect(decision?.type).toBe('recommend');
    expect(tracker.canDisplay(decision!)).toBe(true);
    expect(tracker.canDisplay({ ...decision! })).toBe(false);
    tracker.recordOutcome('guide', 'shown'); expect(tracker.canDisplay(decision!)).toBe(false);
    tracker.setConsent('denied'); expect(tracker.canDisplay(decision!)).toBe(false);
  });

  it('expires an accepted decision after 30 seconds even without new observations', async () => {
    document.body.innerHTML = '';
    const tracker = setup(); begin(tracker); tracker.track('action');
    const decision = await tracker.evaluate();
    await advance(30_001);
    expect(tracker.canDisplay(decision!)).toBe(false);
  });

  it('stops delivery when an earlier decision subscriber changes revision', async () => {
    const tracker = setup(); const stale = vi.fn();
    tracker.onDecision(() => tracker.recordOutcome('guide', 'shown'));
    tracker.onDecision(stale);
    begin(tracker); tracker.track('action'); await tracker.evaluate();
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('B10 — bounded capacity and safe manual APIs', () => {
  it('caps DOM observation at 200 and abstains when coverage is missing', async () => {
    document.body.innerHTML = '<div data-imicue-signal="section"></div>'.repeat(201);
    const tracker = setup(); const codes: string[] = []; tracker.onDiagnostic((event) => codes.push(event.code));
    begin(tracker); tracker.track('action');
    expect(tracker.getState().observedElements).toBe(200);
    expect(io().elements.size).toBe(200);
    expect(tracker.getSnapshot().coverage.truncated).toBe(true);
    expect((await tracker.evaluate())).toMatchObject({ type: 'abstain', reason: 'capacity_limit' });
    expect(codes).toContain('element_capacity');
  });

  it('bounds records and never recommends from truncated observations', async () => {
    const tracker = setup(); const codes: string[] = []; tracker.onDiagnostic((event) => codes.push(event.code));
    begin(tracker);
    for (let index = 0; index < 1001; index++) tracker.track('action');
    expect(observed(tracker, 'action')?.actions).toBe(1000);
    expect(tracker.getSnapshot().coverage.truncated).toBe(true);
    expect(codes).toContain('record_capacity');
    expect(await tracker.evaluate()).toMatchObject({ type: 'abstain', reason: 'capacity_limit' });
  });

  it('keeps missing DOM coverage truncated past 30 minutes and retains the loss window after removal', async () => {
    document.body.innerHTML = '<div data-imicue-signal="section"></div>'.repeat(201);
    const tracker = setup(); begin(tracker);
    await advance(1_800_001);
    tracker.track('action');
    expect(tracker.getSnapshot().coverage.truncated).toBe(true);
    expect(await tracker.evaluate()).toMatchObject({ type: 'abstain', reason: 'capacity_limit' });
    document.body.lastElementChild!.remove();
    await advance(1);
    await advance(1_799_999);
    expect(tracker.getSnapshot().coverage.truncated).toBe(true);
    await advance(2);
    expect(tracker.getSnapshot().coverage.truncated).toBe(false);
  });

  it('accepts registered actions only and separates recommendation-source actions', async () => {
    const tracker = setup(); begin(tracker);
    tracker.track('section'); tracker.track('not-registered');
    tracker.track('action', { source: 'recommendation' });
    expect(tracker.getSnapshot().observations).toHaveLength(1);
    expect(await tracker.evaluate()).toMatchObject({ type: 'abstain', reason: 'insufficient_evidence' });
    tracker.setPage('other', { source: 'recommendation' }); tracker.track('action');
    expect(observed(tracker, 'action', 'recommendation')?.actions).toBe(2);
  });
});
