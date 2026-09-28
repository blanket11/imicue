import { createTracker, createRemoteEngine } from '@imicue/browser';
import { definition } from '../definition.js';

const element = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mode = ['auto', 'manual', 'disabled'].includes(params.get('mode')) ? params.get('mode') : 'auto';
const session = params.get('storage') === 'session';
const remote = params.get('engine') === 'remote';
const pageId = params.get('page') === 'features-guide' ? 'features-guide' : 'home';
const labels = { auto: '自動開始', manual: '手動開始', disabled: '計測しない' };
function href(changes) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.href;
}
for (const value of Object.keys(labels)) {
  element(`mode-${value}`).href = href({ mode: value });
  if (value === mode) element(`mode-${value}`).setAttribute('aria-current', 'page');
}
element('page-link').href = href({ page: pageId === 'home' ? 'features-guide' : null });
element('page-link').textContent = pageId === 'home' ? '検索ガイドへ' : 'トップへ戻る';
if (pageId === 'features-guide') {
  element('page-title').textContent = '読書メモの検索ガイド';
  element('sample').dataset.imicueSignal = 'demo-features-guide-view';
}
element('storage-link').href = href({ storage: session ? null : 'session' });
element('storage-link').textContent = session ? 'メモリ保存に切り替える' : 'ページ移動後も記録を使う';
element('mode-help').textContent = `${labels[mode]}：` + ({ auto: '初期化時に計測を開始します。停止後は「計測を開始」で再開できます。', manual: '「計測を開始」を押すまで記録しません。', disabled: '開始操作をしても計測しません。リセットで以前保存した記録を削除できます。' })[mode];
element('storage-help').textContent = session ? '同じタブの記録を30分保持し、計測開始時に復元します。停止では保持し、リセットで削除します。' : '記録はこのページのメモリ内に保持し、ページ移動で消えます。';
element('engine-help').textContent = remote ? '集計値をローカル判定サーバーへ送る接続デモです。通常のサーバー起動ではモックが応答します。' : 'Rulesをブラウザ内で実行します。判定データは送信しません。';
const tracker = createTracker({ definition, pageId, collection: { mode }, storage: session ? 'session' : 'memory',
  ...(remote ? { engine: createRemoteEngine({ endpoint: 'http://127.0.0.1:5193/v1/decide', allowedOrigins: ['http://127.0.0.1:5193'] }) } : {}),
});
function clearDecision() {
  element('decision').textContent = '判定前';
  element('decision-status').textContent = '判定前';
  element('recommendation-slot').replaceChildren();
}
function sync() {
  const state = tracker.getState();
  element('status').textContent = state.destroyed ? '破棄済み' : state.started ? `${labels[mode]}・計測中` : `${labels[mode]}・計測停止中`;
  element('state').textContent = JSON.stringify(state, null, 2);
  element('snapshot').textContent = JSON.stringify(tracker.getSnapshot(), null, 2);
  element('start').disabled = state.destroyed || state.started || mode === 'disabled';
  element('stop').disabled = !state.started;
  for (const id of ['reset', 'clear-stop', 'destroy']) element(id).disabled = state.destroyed;
}
tracker.onSnapshot(sync);
tracker.onDiagnostic(({ code }) => { element('diagnostics').textContent = code; });
tracker.onDecision((decision) => {
  element('decision').textContent = JSON.stringify(decision, null, 2);
  element('recommendation-slot').replaceChildren();
  element('decision-status').textContent = decision.type === 'recommend' ? `案内候補：${definition.contents[decision.contentId].title}` : '今回は案内を見送ります。';
  if (decision.type !== 'recommend' || !tracker.canDisplay(decision)) return;
  const link = document.createElement('a');
  const content = definition.contents[decision.contentId];
  link.textContent = content.title;
  // The sample keeps the collection mode when navigating to its guide.
  link.href = content.href === '/guides/features/' ? href({ page: 'features-guide' }) : content.href;
  element('recommendation-slot').append(link);
});
element('start').addEventListener('click', () => { tracker.start(); sync(); });
element('stop').addEventListener('click', () => { tracker.stop(); clearDecision(); sync(); });
element('reset').addEventListener('click', () => { tracker.reset(); clearDecision(); sync(); });
element('clear-stop').addEventListener('click', () => { tracker.stop(); tracker.reset(); clearDecision(); sync(); });
element('destroy').addEventListener('click', () => { tracker.destroy(); clearDecision(); sync(); });
element('feature-action').addEventListener('click', () => {
  element('feature-result').textContent = '検索例：「海辺の灯台」・「森の図書館」';
  tracker.track('demo-feature-used');
  sync();
});
window.addEventListener('pagehide', () => { tracker.destroy(); clearDecision(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
sync();
