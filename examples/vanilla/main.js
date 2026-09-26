import { createTracker, createRemoteEngine } from '@imicue/browser';
import { createRulesEngine, isAllowedHref } from '@imicue/core';
import { definition } from './definition.js';

const element = (id) => document.getElementById(id);
const pageId = document.body.dataset.pageId;
const remoteMode = new URLSearchParams(location.search).get('engine') === 'remote';
const diagnostics = [];
function recordDiagnostic(diagnostic) {
  diagnostics.push(diagnostic);
  if (diagnostics.length > 20) diagnostics.shift();
  element('diagnostics').textContent = JSON.stringify(diagnostics, null, 2);
}
const engine = remoteMode ? createRemoteEngine({
  endpoint: 'http://127.0.0.1:5193/v1/decide', allowedOrigins: ['http://127.0.0.1:5193'],
  onDiagnostic: recordDiagnostic,
}) : createRulesEngine();
const tracker = createTracker({ definition, pageId, engine, storage: 'memory' });
if (remoteMode) {
  element('mode-description').textContent = '判定サーバーへの接続を試すモードです。通常の起動コマンドではモックが応答します。法的な同意要件に対応した完成済みのバナーではありません。';
  element('storage-description').textContent = '計測を開始すると、登録済みIDと集計値をローカルの判定サーバーへ送信します。ブラウザの保存先はメモリで、再読み込みやページ移動で記録と許可はリセットされます。';
  document.querySelector('footer').textContent = 'Imicue M3 / 判定サーバー接続デモ。判定できない場合も、ナビゲーションと各ガイドは利用できます。';
  for (const link of document.querySelectorAll('a[href]')) {
    const url = new URL(link.href);
    if (url.origin === location.origin && url.pathname !== location.pathname) {
      url.searchParams.set('engine', 'remote');
      link.href = url.href;
    }
  }
}
// The example explicitly carries its own fixed source marker. The SDK never reads a URL.
if (location.hash === '#imicue-recommendation') {
  tracker.setPage(pageId, { source: 'recommendation' });
}
const reasonLabels = {
  insufficient_evidence: '観測が少ないため、案内を見送っています。',
  no_eligible_content: '現在案内できる候補がありません。',
  below_threshold: '候補との関連性が基準に届いていません。',
  ambiguous: '候補のスコアが近いため、案内を見送っています。',
  suppressed: '直近に案内を表示したため、次の案内を控えています。',
  capacity_limit: '記録または候補の上限に達したため、案内を見送っています。',
  definition_mismatch: '辞書のバージョンが一致しません。',
  engine_unavailable: '判定を実行できませんでした。通常のガイドは利用できます。',
  invalid_result: '判定結果を確認できなかったため、案内を見送っています。',
};
let pendingDecision;
let visibleContentId;
let consent = false;
let started = false;

function updateState() {
  element('status').textContent = consent ? (started ? '許可済み・計測中' : '許可済み・計測停止中') : '未許可・計測停止中';
  element('start').disabled = !consent || started;
  element('stop').disabled = !started;
  element('evaluate').disabled = !started;
}
function clearCard() {
  pendingDecision = undefined;
  visibleContentId = undefined;
  element('recommendation-slot').replaceChildren();
}
function clearDecision() {
  clearCard();
  element('scores').replaceChildren();
  element('decision').textContent = '判定前';
  element('decision-status').textContent = '計測を開始すると判定を確認できます。';
}
function tryDisplay() {
  const decision = pendingDecision;
  if (!decision || visibleContentId || !consent || !started || !tracker.canDisplay(decision)) return;
  const active = document.activeElement;
  if (active?.matches('input, textarea, select') || active?.isContentEditable || document.querySelector('dialog[open], [aria-modal="true"]')) return;
  const slot = element('recommendation-slot');
  const bounds = slot.getBoundingClientRect();
  // An inline card must be on screen before it counts as shown; it never covers a CTA.
  if (bounds.top < 0 || bounds.top > window.innerHeight - 200) return;
  const content = definition.contents[decision.contentId];
  if (!content || !isAllowedHref(content.href)) return;
  const card = document.createElement('section');
  card.className = 'recommendation';
  card.setAttribute('aria-labelledby', 'recommendation-title');
  const title = document.createElement('h3');
  title.id = 'recommendation-title';
  title.textContent = '関連するガイド';
  const description = document.createElement('p');
  description.textContent = content.description;
  const actions = document.createElement('div');
  actions.className = 'controls';
  const link = document.createElement('a');
  link.className = 'button-link';
  link.href = `${content.href}${remoteMode ? '?engine=remote' : ''}#imicue-recommendation`;
  link.textContent = content.title;
  link.addEventListener('click', () => tracker.recordOutcome(decision.contentId, 'clicked'));
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '案内を閉じる';
  dismiss.addEventListener('click', () => {
    tracker.recordOutcome(decision.contentId, 'dismissed');
    clearCard();
  });
  actions.append(link, dismiss);
  card.append(title, description, actions);
  slot.append(card);
  visibleContentId = decision.contentId;
  pendingDecision = undefined;
  tracker.recordOutcome(decision.contentId, 'shown');
}

tracker.onSnapshot((snapshot) => { element('snapshot').textContent = JSON.stringify(snapshot, null, 2); });
tracker.onDiagnostic(recordDiagnostic);
tracker.onDecision((decision) => {
  element('decision').textContent = JSON.stringify(decision, null, 2);
  element('scores').replaceChildren();
  for (const assessment of decision.assessments) {
    const row = document.createElement('div');
    row.className = 'score-row';
    const name = document.createElement('span');
    name.textContent = definition.contents[assessment.contentId]?.title ?? assessment.contentId;
    const score = document.createElement('strong');
    score.textContent = `${assessment.score.toFixed(3)} / ${assessment.scoreKind}${decision.engine.model === 'mock-local-v1' ? '（モック）' : ''}`;
    row.append(name, score);
    element('scores').append(row);
  }
  if (decision.type === 'abstain') {
    pendingDecision = undefined;
    element('decision-status').textContent = reasonLabels[decision.reason];
  } else {
    element('decision-status').textContent = `案内候補：${definition.contents[decision.contentId].title}`;
    pendingDecision = decision;
    tryDisplay();
  }
});

for (const [id, signal] of Object.entries(definition.signals)) {
  const name = document.createElement('dt');
  name.textContent = `${signal.label} (${id})`;
  const meaning = document.createElement('dd');
  meaning.textContent = signal.description;
  element('dictionary').append(name, meaning);
}
element('snapshot').textContent = JSON.stringify(tracker.getSnapshot(), null, 2);
element('consent').addEventListener('change', (event) => {
  consent = event.target.checked;
  tracker.setConsent(consent ? 'granted' : 'denied');
  if (!consent) { started = false; clearDecision(); }
  updateState();
});
element('start').addEventListener('click', () => { tracker.start(); started = true; updateState(); });
element('stop').addEventListener('click', () => { tracker.stop(); started = false; clearCard(); updateState(); });
element('revoke').addEventListener('click', () => {
  tracker.setConsent('denied');
  consent = false;
  started = false;
  element('consent').checked = false;
  clearDecision();
  updateState();
});
element('reset').addEventListener('click', () => { tracker.reset(); clearDecision(); });
element('evaluate').addEventListener('click', () => { void tracker.evaluate(); });
element('feature-action')?.addEventListener('click', () => {
  element('feature-result').textContent = '検索例：サンプル契約書 A・サンプル契約書 B';
  tracker.track('demo-feature-used', { source: 'direct' });
});
element('pricing-action')?.addEventListener('click', () => {
  element('pricing-result').textContent = '確認項目：利用人数・契約書の数・必要な機能';
});
element('cases-action')?.addEventListener('click', () => {
  element('cases-result').textContent = '利用例：更新予定の確認・チームへの書類共有';
});
element('example-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  element('form-result').textContent = '入力操作が完了しました。入力内容は送信・保存していません。';
});
element('complete-guide')?.addEventListener('click', () => {
  const contentId = definition.pages[pageId].contentId;
  tracker.recordOutcome(contentId, 'completed');
  element('guide-result').textContent = started ? 'このガイドの確認完了を記録しました。' : '確認が完了しました。計測停止中のため記録はしていません。';
});
let displayFrame;
function scheduleDisplay() {
  if (displayFrame) return;
  displayFrame = requestAnimationFrame(() => { displayFrame = undefined; tryDisplay(); });
}
document.addEventListener('focusout', scheduleDisplay);
window.addEventListener('scroll', scheduleDisplay, { passive: true });
window.addEventListener('resize', scheduleDisplay);
window.addEventListener('pagehide', () => tracker.stop());
// Local development harness for reproducible browser tests; omitted from production builds.
if (import.meta.env.DEV) window.__imicueDemo = { tracker, definition };
