import { createTracker, createRemoteEngine } from '@imicue/browser';
import { createRulesEngine, isAllowedHref } from '@imicue/core';
import { catalogDefinition as definition } from './definition.js';

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const topic = params.get('topic') === 'cases' ? 'cases' : 'features';
const remote = params.get('engine') === 'remote';
const copy = topic === 'features' ? [
  ['契約書の本文から探す', 'ファイル名を覚えていなくても、契約書の本文に含まれる語句から必要な条項を探す機能の紹介です。契約日や会社名だけでなく、文中の条件も検索対象にする架空の機能です。'],
  ['一致した箇所を一覧で確かめる', '全文検索の結果を一覧に並べ、一致した語句の前後を確認する手順です。目的の契約書を開く前に、探していた条項が含まれるかを確かめます。'],
] : [
  ['営業チームの更新漏れを減らす運用', '担当者ごとに管理していた契約の更新予定が共有されず、引き継ぎで確認が遅れることがあった、という架空の事例です。'],
  ['担当者と更新予定を一緒に確認する', '営業チームが週ごとに担当者と更新予定を確認する運用を紹介します。架空の利用場面であり、実在する企業の成果や改善率を示すものではありません。'],
];
for (const [index, part] of ['overview', 'detail'].entries()) {
  const section = byId(`catalog-${part}`);
  section.dataset.imicueSignal = `catalog-${topic}-${part}`;
  section.querySelector('h2').textContent = copy[index][0];
  section.querySelector('p:last-child').textContent = copy[index][1];
}
const engine = remote ? createRemoteEngine({ endpoint: 'http://127.0.0.1:5193/v1/decide', allowedOrigins: ['http://127.0.0.1:5193'] }) : createRulesEngine();
const tracker = createTracker({ definition, pageId: `catalog-${topic}`, engine });
let granted = false;
let running = false;
let pending;
let shown = false;
const diagnostics = [];
const reasons = {
  insufficient_evidence: '2回以上の有効な閲覧を待っています。',
  below_threshold: '関連性が基準に届いていません。説明をしばらく表示してみてください。',
  ambiguous: '同程度の候補があるため、案内を見送っています。',
  suppressed: '直近に案内を表示したため、次の案内を控えています。',
  no_eligible_content: '現在案内できる候補がありません。',
  capacity_limit: '処理できる容量を超えたため、案内を見送っています。',
  engine_unavailable: '判定できませんでした。通常の案内先リンクは利用できます。',
  invalid_result: '判定結果を検証できないため、案内を見送っています。',
  definition_mismatch: '辞書の版が一致しないため、案内を見送っています。',
};
function updateState() {
  byId('catalog-start').disabled = !granted || running;
  byId('catalog-status').textContent = running ? '計測中' : granted ? '許可済み・計測停止中' : '未許可・計測停止中';
}
function clearRecommendation() {
  pending = undefined;
  shown = false;
  byId('catalog-recommendation').replaceChildren();
}
function display() {
  if (!pending || shown || !running || !tracker.canDisplay(pending)) return;
  if (document.activeElement?.matches('input,textarea,select') || document.activeElement?.isContentEditable
    || document.querySelector('dialog[open], [aria-modal="true"]')) return;
  const slot = byId('catalog-recommendation');
  const rect = slot.getBoundingClientRect();
  if (rect.top < 0 || rect.top > innerHeight - 170) return;
  const decision = pending;
  const content = definition.contents[decision.contentId];
  if (!content || !isAllowedHref(content.href)) return;
  const card = document.createElement('section');
  card.className = 'recommendation';
  const heading = document.createElement('h3');
  heading.textContent = '関連する追加情報';
  const link = document.createElement('a');
  link.href = content.href;
  link.textContent = content.title;
  link.addEventListener('click', () => tracker.recordOutcome(decision.contentId, 'clicked'));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '案内を閉じる';
  close.addEventListener('click', () => { tracker.recordOutcome(decision.contentId, 'dismissed'); clearRecommendation(); });
  const actions = document.createElement('div');
  actions.className = 'controls';
  actions.append(link, close);
  card.append(heading, actions);
  slot.append(card);
  pending = undefined;
  shown = true;
  tracker.recordOutcome(decision.contentId, 'shown');
}
tracker.onSnapshot((snapshot) => {
  byId('catalog-snapshot').textContent = JSON.stringify(snapshot, null, 2);
  const total = snapshot.observations.reduce((sum, item) => ({ views: sum.views + item.qualifiedViews, clicks: sum.clicks + item.clicks, actions: sum.actions + item.actions }), { views: 0, clicks: 0, actions: 0 });
  byId('catalog-observation-count').textContent = `有効な閲覧 ${total.views}回・クリック ${total.clicks}回・操作 ${total.actions}回`;
});
tracker.onDecision((decision) => {
  byId('catalog-decision').textContent = JSON.stringify(decision, null, 2);
  byId('catalog-decision-status').textContent = decision.type === 'recommend'
    ? `${decision.assessments.length}件を評価した案内候補：${definition.contents[decision.contentId].title}` : reasons[decision.reason];
  pending = decision.type === 'recommend' ? decision : undefined;
  display();
});
tracker.onDiagnostic((diagnostic) => {
  diagnostics.push(diagnostic.code);
  if (diagnostics.length > 10) diagnostics.shift();
  byId('catalog-diagnostics').textContent = diagnostics.join('\n');
});
function revoke() {
  tracker.setConsent('denied');
  granted = running = false;
  byId('catalog-consent').checked = false;
  clearRecommendation();
  byId('catalog-decision').textContent = '判定前';
  byId('catalog-decision-status').textContent = '2回以上の有効な閲覧を待っています。';
  updateState();
}
byId('catalog-consent').addEventListener('change', (event) => {
  if (!event.target.checked) { revoke(); return; }
  tracker.setConsent('granted');
  granted = true;
  updateState();
});
byId('catalog-start').addEventListener('click', () => { tracker.start(); running = true; updateState(); });
byId('catalog-revoke').addEventListener('click', revoke);
for (const content of Object.values(definition.contents)) {
  const row = document.createElement('li');
  const link = document.createElement('a');
  link.href = content.href;
  link.textContent = content.title;
  row.append(link);
  byId('catalog-list').append(row);
}
if (remote) {
  byId('catalog-mode').textContent = '開始後は登録済みIDと集計値をローカルサーバーへ送信します。標準のサーバーはモックです。実Jevは明示的に起動した場合だけ使います。';
  for (const link of document.querySelectorAll('nav a')) {
    const url = new URL(link.href);
    url.searchParams.set('engine', 'remote');
    link.href = url.href;
  }
}
byId('catalog-snapshot').textContent = JSON.stringify(tracker.getSnapshot(), null, 2);
window.addEventListener('scroll', display, { passive: true });
document.addEventListener('focusout', () => requestAnimationFrame(display));
window.addEventListener('pagehide', () => { tracker.stop(); running = false; clearRecommendation(); updateState(); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) revoke();
  byId('catalog-consent').checked = granted;
  updateState();
});
