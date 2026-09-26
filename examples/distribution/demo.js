import { definition } from './definition.js';

export function mount(api) {
  const element = (id) => document.getElementById(id);
  if (!api?.createTracker || !api.createRulesEngine) {
    element('status').textContent = 'Imicueを読み込めませんでした。グローバル名の競合やscriptの取得を確認してください。';
    return;
  }
  const tracker = api.createTracker({ definition, pageId: 'home', engine: api.createRulesEngine() });
  const refresh = () => {
    const state = tracker.getState();
    element('status').textContent = state.started ? '計測中' : '計測停止中';
    element('start').disabled = state.consent !== 'granted' || state.started;
    element('snapshot').textContent = JSON.stringify(tracker.getSnapshot(), null, 2);
  };
  tracker.onSnapshot(refresh);
  tracker.onDecision((decision) => { element('decision').textContent = JSON.stringify(decision, null, 2); });
  element('consent').addEventListener('change', (event) => {
    tracker.setConsent(event.target.checked ? 'granted' : 'denied');
    if (!event.target.checked) element('decision').textContent = '判定前';
    refresh();
  });
  element('start').addEventListener('click', () => { tracker.start(); refresh(); });
  element('stop').addEventListener('click', () => { tracker.stop(); refresh(); });
  element('revoke').addEventListener('click', () => {
    tracker.setConsent('denied'); element('consent').checked = false;
    element('decision').textContent = '判定前'; refresh();
  });
  element('action').addEventListener('click', () => {
    element('result').textContent = '検索例：サンプル契約書 A・サンプル契約書 B';
    tracker.track('demo-feature-used');
  });
  window.addEventListener('pagehide', () => tracker.destroy(), { once: true });
  refresh();
}
