'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createTracker, createRemoteEngine, type Tracker, type TrackerState } from '@imicue/browser';
import { createRulesEngine, type Decision, type Snapshot } from '@imicue/core';
import { definition } from '../../vanilla/definition.js';

const Actions = createContext<{ track: (id: string) => void; complete: () => void } | null>(null);
export function useImicueActions() {
  const actions = useContext(Actions);
  if (!actions) throw new Error('TrackerSession is required');
  return actions;
}
type Mode = 'rules' | 'remote';
const initialState: TrackerState = { consent: 'unknown', started: false, destroyed: false, observedElements: 0, revision: 0 };

/** A site-owned lifecycle example; this is not a React SDK. */
export function TrackerSession({ pageId, children }: { pageId: string; children: ReactNode }) {
  const trackerRef = useRef<Tracker | null>(null);
  const [mode, setMode] = useState<Mode>('rules');
  const [state, setState] = useState(initialState);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [decision, setDecision] = useState<Decision>();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [card, setCard] = useState<string>();
  const [ready, setReady] = useState(false);
  const sync = () => { if (trackerRef.current) setState(trackerRef.current.getState()); };
  const clearDecision = () => { setDecision(undefined); setCard(undefined); };

  useEffect(() => {
    const diagnostic = (value: { code: string }) => setDiagnostics((previous) => [...previous.slice(-19), value.code]);
    const engine = mode === 'rules' ? createRulesEngine() : createRemoteEngine({
      endpoint: 'http://127.0.0.1:5193/v1/decide', allowedOrigins: ['http://127.0.0.1:5193'], onDiagnostic: diagnostic,
    });
    // All DOM work starts in effects. The next effect sets the registered page ID.
    const tracker = createTracker({ definition, pageId: 'home', engine, storage: 'memory' });
    trackerRef.current = tracker;
    setState(tracker.getState()); setSnapshot(tracker.getSnapshot());
    setDecision(undefined); setCard(undefined); setDiagnostics([]); setReady(true);
    const unsubscribeSnapshot = tracker.onSnapshot((value) => { setSnapshot(value); setState(tracker.getState()); });
    const unsubscribeDecision = tracker.onDecision(setDecision);
    const unsubscribeDiagnostic = tracker.onDiagnostic(diagnostic);
    const pagehide = () => { tracker.stop(); setState(tracker.getState()); setCard(undefined); };
    window.addEventListener('pagehide', pagehide);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      unsubscribeSnapshot(); unsubscribeDecision(); unsubscribeDiagnostic();
      tracker.destroy();
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker?.setPage(pageId, { source: location.hash === '#imicue-recommendation' ? 'recommendation' : 'direct' });
    setDecision(undefined); setCard(undefined);
    if (tracker) { setSnapshot(tracker.getSnapshot()); setState(tracker.getState()); }
  }, [pageId, mode]);

  const content = card ? definition.contents[card] : undefined;
  return <Actions.Provider value={{
    track: (id) => trackerRef.current?.track(id),
    complete: () => { const id = definition.pages[pageId]?.contentId; if (id) trackerRef.current?.recordOutcome(id, 'completed'); },
  }}>
    <div className="layout"><main>{children}</main><aside className="debug-panel panel" data-imicue-ignore aria-labelledby="debug-title">
      <h2 id="debug-title">Imicue 確認パネル</h2>
      <p className="muted">Next.jsの静的出力から、計測と判定を試す操作例です。モードを変えると許可と記録はリセットされます。</p>
      <label htmlFor="engine-mode">判定モード</label>{' '}
      <select id="engine-mode" value={mode} disabled={!ready} onChange={(event) => setMode(event.target.value as Mode)}>
        <option value="rules">Rules（ローカル）</option><option value="remote">判定サーバー接続</option>
      </select>
      <p id="mode-description" className="muted">{mode === 'rules' ? '判定データは外部へ送信しません。APIキーも不要です。' : '登録済みIDと集計値をローカルの判定サーバーへ送信します。通常のサーバー起動コマンドはモックを使います。'}</p>
      <label className="consent"><input id="consent" type="checkbox" disabled={!ready} checked={state.consent === 'granted'} onChange={(event) => {
        trackerRef.current?.setConsent(event.target.checked ? 'granted' : 'denied'); clearDecision(); sync();
      }} />このサイトの表示・操作の計測を許可する</label>
      <div className="controls">
        <button id="start" disabled={state.consent !== 'granted' || state.started} onClick={() => { trackerRef.current?.start(); sync(); }}>計測を開始</button>
        <button id="stop" disabled={!state.started} onClick={() => { trackerRef.current?.stop(); clearDecision(); sync(); }}>計測を停止</button>
        <button id="revoke" onClick={() => { trackerRef.current?.setConsent('denied'); clearDecision(); sync(); }}>同意を撤回</button>
        <button id="reset" onClick={() => { trackerRef.current?.reset(); clearDecision(); sync(); }}>記録をリセット</button>
      </div>
      <p id="status" className="status" role="status">{state.started ? '許可済み・計測中' : state.consent === 'granted' ? '許可済み・計測停止中' : '未許可・計測停止中'}</p>
      <p className="muted">保存はメモリのみです。サイト内のページ移動では記録と許可を維持し、再読み込みや同意撤回で消去します。</p>
      <p id="page-id">現在のページ：{pageId}</p>
      <h3>現在の判定</h3>
      <p id="decision-status">{!decision ? (state.started ? '判定結果はまだありません。' : '計測を開始すると判定を確認できます。') : decision.type === 'recommend' ? `案内候補：${definition.contents[decision.contentId]?.title}` : `今回は案内を見送ります（${decision.reason}）。通常のガイドは利用できます。`}</p>
      <div id="scores">{decision?.assessments.map((entry) => <div className="score-row" key={entry.contentId}><span>{definition.contents[entry.contentId]?.title}</span><strong>{entry.score.toFixed(3)} / {entry.scoreKind}{decision.engine.model === 'mock-local-v1' ? '（モック）' : ''}</strong></div>)}</div>
      <div className="controls">
        <button id="evaluate" disabled={!state.started} onClick={() => { void trackerRef.current?.evaluate(); }}>今の記録で判定</button>
        <button id="show-guide" disabled={decision?.type !== 'recommend' || !state.started || !!card} onClick={() => {
          if (decision?.type !== 'recommend' || !trackerRef.current?.canDisplay(decision)) return;
          if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
          setCard(decision.contentId); trackerRef.current.recordOutcome(decision.contentId, 'shown');
        }}>候補のガイドを表示</button>
      </div>
      <div id="recommendation-slot" data-imicue-source="recommendation">{card && content && <section className="recommendation">
        <h3>関連するガイド</h3><p>{content.description}</p>
        <Link href={`${content.href}#imicue-recommendation`} onClick={() => trackerRef.current?.recordOutcome(card, 'clicked')}>{content.title}</Link>{' '}
        <button onClick={() => { trackerRef.current?.recordOutcome(card, 'dismissed'); setCard(undefined); }}>案内を閉じる</button>
      </section>}</div>
      <details><summary>現在の集計</summary><pre id="snapshot">{JSON.stringify(snapshot, null, 2)}</pre></details>
      <details><summary>判定の詳細</summary><pre id="decision">{decision ? JSON.stringify(decision, null, 2) : '判定前'}</pre></details>
      <details><summary>診断</summary><pre id="diagnostics">{JSON.stringify(diagnostics)}</pre></details>
    </aside></div>
  </Actions.Provider>;
}

export function SearchExample() {
  const actions = useImicueActions();
  const [opened, setOpened] = useState(false);
  return <><button id="feature-action" onClick={() => { setOpened(true); actions.track('demo-feature-used'); }}>検索例を開く</button>
    <p id="feature-result" role="status">{opened ? '検索例：サンプル契約書 A・サンプル契約書 B' : ''}</p></>;
}

export function CompleteGuide() {
  const actions = useImicueActions();
  const [completed, setCompleted] = useState(false);
  return <><button id="complete-guide" onClick={() => { actions.complete(); setCompleted(true); }}>このガイドの確認を完了</button>
    <p role="status">{completed ? '確認が完了しました。計測中の場合のみ完了を記録します。' : ''}</p></>;
}
