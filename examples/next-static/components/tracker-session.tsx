'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { flushSync } from 'react-dom';
import { createTracker, createRemoteEngine, type Tracker, type TrackerState } from '@imicue/browser';
import { createRulesEngine, type Decision, type Snapshot } from '@imicue/core';
import { productDefinition as definition } from '../../product/definition';

const Actions = createContext<{ complete: () => void } | null>(null);
export function useImicueActions() {
  const actions = useContext(Actions);
  if (!actions) throw new Error('TrackerSession is required');
  return actions;
}
type Mode = 'rules' | 'remote';
type Recommendation = Extract<Decision, { type: 'recommend' }>;
type Offer = { decision: Recommendation; receivedAt: number; pageId: string };
const initialState: TrackerState = { consent: 'unknown', collectionMode: 'auto', consentRequired: false, started: false, destroyed: false, observedElements: 0, revision: 0 };

function obstructed() {
  if (document.visibilityState !== 'visible' || document.querySelector('dialog[open], [aria-modal="true"]')) return true;
  if (document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  // Reserve the card's footprint. Primary page actions and demo forms always take priority.
  const narrow = window.innerWidth <= 680;
  const left = narrow ? 16 : window.innerWidth - 388;
  const top = window.innerHeight - (narrow ? 260 : 220);
  return [...document.querySelectorAll('[data-imicue-protect] .button, .form-panel, .debug-panel:not([hidden])')].some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth - 16 && rect.right > left && rect.top < window.innerHeight && rect.bottom > top;
  });
}

function RecommendationCard({ offer, tracker, onHide }: { offer: Offer; tracker: Tracker; onHide: () => void }) {
  const recorded = useRef(false);
  const node = useRef<HTMLElement>(null);
  const content = definition.contents[offer.decision.contentId]!;
  useLayoutEffect(() => {
    // Validate again immediately before paint. Recording shown changes revision, so it must happen only once.
    if (recorded.current) return;
    if (obstructed() || !tracker.canDisplay(offer.decision)) { onHide(); return; }
    recorded.current = true;
    tracker.recordOutcome(offer.decision.contentId, 'shown');
  }, [offer, tracker, onHide]);
  const dismiss = () => {
    tracker.recordOutcome(offer.decision.contentId, 'dismissed');
    if (node.current?.contains(document.activeElement)) document.getElementById('main')?.focus({ preventScroll: true });
    onHide();
  };
  return <aside className="recommendation" ref={node} aria-label="Imicueによるご案内" data-imicue-ignore data-imicue-source="recommendation" data-content-id={offer.decision.contentId} onKeyDown={(event) => { if (event.key === 'Escape') dismiss(); }}>
    <div className="recommendation-heading"><span>Imicueによるご案内</span><button aria-label="案内を閉じる" onClick={dismiss}>×</button></div>
    <p className="sr-only" role="status">関連する案内があります：{content.title}</p>
    <Link href={`${content.href}#imicue-recommendation`} onClick={() => { tracker.recordOutcome(offer.decision.contentId, 'clicked'); onHide(); }}><strong>{content.title}<span aria-hidden> →</span></strong><span>{content.description}</span></Link>
  </aside>;
}

/** The site owns presentation, form outcomes and React lifecycle. No React UI lives in the SDK. */
export function TrackerSession({ pageId, children }: { pageId: string; children: ReactNode }) {
  const trackerRef = useRef<Tracker | null>(null);
  const pageRef = useRef(pageId); pageRef.current = pageId;
  const pending = useRef<Offer | null>(null);
  const visible = useRef<Offer | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>('rules');
  const [state, setState] = useState(initialState);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [decision, setDecision] = useState<Decision>();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [card, setCard] = useState<Offer | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const hide = () => { pending.current = null; visible.current = null; setCard(null); };
  const sync = () => { const tracker = trackerRef.current; if (tracker) { setState(tracker.getState()); setSnapshot(tracker.getSnapshot()); } };
  const clearDecision = () => { hide(); setDecision(undefined); };
  const closeDebug = () => { setDebugOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    const diagnostic = (value: { code: string }) => setDiagnostics((previous) => [...previous.slice(-19), value.code]);
    const engine = mode === 'rules' ? createRulesEngine() : createRemoteEngine({
      endpoint: 'http://127.0.0.1:5193/v1/decide', allowedOrigins: ['http://127.0.0.1:5193'], onDiagnostic: diagnostic,
    });
    const tracker = createTracker({ definition, pageId: pageRef.current, engine, storage: 'session', collection: { mode: 'auto' } });
    trackerRef.current = tracker;
    setState(tracker.getState()); setSnapshot(tracker.getSnapshot());
    setDecision(undefined); setCard(null); pending.current = null; visible.current = null; setDiagnostics([]); setReady(true);
    const unsubscribeSnapshot = tracker.onSnapshot((value) => { setSnapshot(value); setState(tracker.getState()); });
    const removeCard = () => { pending.current = null; visible.current = null; setCard(null); };
    const updateDisplay = () => {
      const current = tracker.getSnapshot();
      const offer = visible.current;
      if (offer) {
        const id = offer.decision.contentId;
        const excluded = definition.pages[current.pageId]?.contentId === id
          || current.outcomes.some((row) => row.contentId === id && (row.kind === 'dismissed' || row.kind === 'completed'))
          || current.observations.some((row) => definition.signals[row.signalId]?.contentId === id && row.qualifiedViews > 0);
        // A shown outcome suppresses future recommendations; it does not invalidate its own visible card.
        if (!tracker.getState().started || current.pageViewId !== offer.decision.pageViewId || excluded
          || performance.now() - offer.receivedAt >= offer.decision.maxAgeMs || obstructed()) removeCard();
        return;
      }
      const candidate = pending.current;
      if (!candidate || obstructed()) return;
      if (!tracker.canDisplay(candidate.decision)) { pending.current = null; return; }
      pending.current = null; visible.current = candidate;
      // Commit within the external SDK callback, before a later observation can advance revision.
      // The layout effect still rechecks canDisplay immediately before recording shown.
      flushSync(() => setCard(candidate));
    };
    const unsubscribeDecision = tracker.onDecision((value) => {
      setDecision(value);
      pending.current = value.type === 'recommend' ? { decision: value, receivedAt: performance.now(), pageId: pageRef.current } : null;
      updateDisplay();
    });
    const unsubscribeDiagnostic = tracker.onDiagnostic(diagnostic);
    let resumeAfterPagehide = false;
    const pagehide = () => { resumeAfterPagehide = tracker.getState().started; tracker.stop(); setState(tracker.getState()); removeCard(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted && resumeAfterPagehide) { tracker.start(); setState(tracker.getState()); } };
    const guard = () => { if (obstructed()) removeCard(); };
    const timer = window.setInterval(updateDisplay, 500);
    window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow);
    document.addEventListener('visibilitychange', guard); document.addEventListener('focusin', guard);
    window.addEventListener('scroll', guard, { passive: true }); window.addEventListener('resize', guard);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow);
      document.removeEventListener('visibilitychange', guard); document.removeEventListener('focusin', guard);
      window.removeEventListener('scroll', guard); window.removeEventListener('resize', guard);
      unsubscribeSnapshot(); unsubscribeDecision(); unsubscribeDiagnostic(); tracker.destroy();
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker?.setPage(pageId, { source: location.hash === '#imicue-recommendation' ? 'recommendation' : 'direct' });
    pending.current = null; visible.current = null; setDecision(undefined); setCard(null);
    if (tracker) { setSnapshot(tracker.getSnapshot()); setState(tracker.getState()); }
  }, [pageId, mode]);

  return <Actions.Provider value={{ complete: () => {
    const id = definition.pages[pageId]?.contentId;
    if (id) trackerRef.current?.recordOutcome(id, 'completed');
    clearDecision(); sync();
  } }}>
    <main id="main" tabIndex={-1}>{children}</main>
    <div id="recommendation-slot">{card && card.pageId === pageId && trackerRef.current && <RecommendationCard key={card.decision.decisionId} offer={card} tracker={trackerRef.current} onHide={hide} />}</div>
    <div className="debug-root" data-imicue-ignore>
      <button className="debug-trigger" ref={trigger} id="debug-toggle" aria-expanded={debugOpen} aria-controls="debug-panel" onClick={() => setDebugOpen(!debugOpen)}>Imicue Debug <span aria-hidden>{debugOpen ? '−' : '+'}</span></button>
      <section className="debug-panel" id="debug-panel" hidden={!debugOpen} aria-labelledby="debug-title" onKeyDown={(event) => { if (event.key === 'Escape') closeDebug(); }}>
        <div className="debug-heading"><h2 id="debug-title">Imicue Debug</h2><button aria-label="Debugを閉じる" onClick={closeDebug}>×</button></div>
        <div className="debug-body"><p id="status" role="status"><span className={state.started ? 'status-dot active' : 'status-dot'} />{state.started ? '計測中' : '計測停止中'}</p>
          <p id="page-id">Page: {pageId}</p><p>Revision: <span id="revision">{state.revision}</span> / Collection: auto</p>
          <label htmlFor="engine-mode">Engine</label><select id="engine-mode" value={mode} disabled={!ready} onChange={(event) => { trackerRef.current?.stop(); trackerRef.current?.reset(); clearDecision(); setMode(event.target.value as Mode); }}><option value="rules">Rules（ローカル）</option><option value="remote">Remote（ローカルサーバー）</option></select>
          <p className="debug-note">{mode === 'rules' ? '外部送信なし。登録したIDと数値をこのタブに30分保持します。' : 'IDと集計値を127.0.0.1:5193へ送信します。通常のサーバー起動はモックです。'}</p>
          <p id="decision-status">{!decision ? '判定前' : decision.type === 'recommend' ? `案内候補：${definition.contents[decision.contentId]?.title}` : `見送り：${decision.reason}`}</p>
          <details><summary>現在の集計</summary><pre id="snapshot">{JSON.stringify(snapshot, null, 2)}</pre></details>
          <details><summary>現在の判定</summary><pre id="decision">{decision ? JSON.stringify(decision, null, 2) : '判定前'}</pre></details>
          <details><summary>候補スコア</summary><div id="scores">{decision?.assessments.map((entry) => <p key={entry.contentId}>{definition.contents[entry.contentId]?.title}<br /><strong>{entry.score.toFixed(3)} / {entry.scoreKind}</strong></p>)}</div></details>
          <details><summary>診断</summary><pre id="diagnostics">{JSON.stringify(diagnostics, null, 2)}</pre></details>
          <div className="debug-controls"><button id="reset" disabled={!ready} onClick={() => { trackerRef.current?.reset(); clearDecision(); sync(); }}>記録をリセット</button><button id="stop" disabled={!state.started} onClick={() => { trackerRef.current?.stop(); clearDecision(); sync(); }}>計測を停止</button><button id="start" disabled={!ready || state.started} onClick={() => { trackerRef.current?.start(); sync(); }}>計測を開始</button><button id="clear-stop" disabled={!ready} onClick={() => { trackerRef.current?.stop(); trackerRef.current?.reset(); clearDecision(); sync(); }}>停止して記録を削除</button></div>
          <p className="debug-note">停止はこのページを再読み込みするまで維持します。モードを変えると記録を削除して自動開始します。</p>
        </div>
      </section>
    </div>
  </Actions.Provider>;
}
