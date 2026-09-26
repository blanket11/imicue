// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createTracker } from '@imicue/browser';
import { definition } from '../../examples/vanilla/definition.js';
import { TrackerSession, SearchExample } from '../../examples/next-static/components/tracker-session.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('P01: actual StrictMode effects clean up trackers and preserve one listener after remount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const activeObservers = new Set<object>();
  class Observer {
    constructor() { activeObservers.add(this); }
    observe() {} unobserve() {} takeRecords() { return []; }
    disconnect() { activeObservers.delete(this); }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const capture = vi.spyOn(window, 'addEventListener');
  const releases = vi.spyOn(window, 'removeEventListener');
  const render = (pageId: string) => <StrictMode><TrackerSession pageId={pageId}><section data-imicue-signal="demo-features"><SearchExample /></section></TrackerSession></StrictMode>;
  const click = async (id: string) => { await act(async () => { document.getElementById(id)!.click(); }); };
  try {
    await act(async () => { root.render(render('home')); });
    // StrictMode must actually replay effects in this runtime, not merely be configured.
    const pagehideAdds = capture.mock.calls.filter(([name]) => name === 'pagehide').length;
    expect(pagehideAdds).toBe(2);
    expect(releases.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1);
    expect(activeObservers.size).toBe(0);
    await click('consent'); await click('start'); await click('feature-action');
    let snap = JSON.parse(document.getElementById('snapshot')!.textContent!);
    expect(snap.observations.find((row: { signalId: string }) => row.signalId === 'demo-feature-used').actions).toBe(1);
    expect(document.getElementById('diagnostics')!.textContent).not.toContain('duplicate_tracker');
    const beforePage = snap.pageViewId;
    await act(async () => { root.render(render('features-guide')); });
    snap = JSON.parse(document.getElementById('snapshot')!.textContent!);
    expect(snap.pageId).toBe('features-guide'); expect(snap.pageViewId).not.toBe(beforePage);
    await click('revoke');
    expect(activeObservers.size).toBe(0);
    expect(JSON.parse(document.getElementById('snapshot')!.textContent!).observations).toEqual([]);
    await click('consent'); await click('start');
    await act(async () => { root.unmount(); });
    expect(activeObservers.size).toBe(0);
    // A fresh owner can claim the same document/site after React cleanup.
    const replacement = createTracker({ definition, pageId: 'home' });
    replacement.setConsent('granted'); replacement.start();
    expect(replacement.getState().started).toBe(true);
    replacement.destroy();
  } finally { if (host.firstChild) await act(async () => root.unmount()); }
});
