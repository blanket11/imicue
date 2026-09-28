import { createRulesEngine, evaluateSnapshot, type Decision, type Snapshot } from '@imicue/core';
import { definition, makeSnapshot, observationLabels, type Scenario } from './scenarios.js';
import { renderMockPage, guideSteps } from './mock-site.js';

const options = document.querySelector<HTMLFieldSetElement>('#scenario-options')!;
const result = document.querySelector<HTMLElement>('#result')!;
const reset = document.querySelector<HTMLButtonElement>('#reset-demo')!;
const reason = document.querySelector<HTMLDetailsElement>('#reason')!;
const reasonContent = document.querySelector<HTMLElement>('#reason-content')!;
const observations = document.querySelector<HTMLElement>('#observations')!;
const mapping = document.querySelector<HTMLElement>('#mapping')!;
const engine = createRulesEngine();
let revision = 0;
let guideTrigger: HTMLButtonElement | undefined;

function paragraph(text: string, className?: string) {
  const node = document.createElement('p');
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showResult(label: string, title: string, description: string, state = 'pending') {
  result.dataset.state = state;
  const heading = document.createElement('h4');
  heading.textContent = title;
  result.replaceChildren(paragraph(label, 'result-label'), heading, paragraph(description));
}

function showEvidence(snapshot: Snapshot) {
  if (!snapshot.observations.length) {
    observations.replaceChildren(paragraph('表示や操作の記録がありません。'));
    mapping.replaceChildren(paragraph('辞書には候補が登録されていますが、結び付ける閲覧記録がありません。'));
    return;
  }
  const list = document.createElement('ul');
  for (const observation of snapshot.observations) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = observationLabels[observation.signalId]!;
    item.append(name, paragraph(`${observation.qualifiedViews}回表示・${observation.visibleMs / 1_000}秒`));
    list.append(item);
  }
  observations.replaceChildren(list);
  const relations = document.createElement('ul');
  const ids = new Set(snapshot.observations.map((observation) => observation.signalId));
  for (const candidate of Object.values(definition.contents)) {
    const related = candidate.relatedSignalIds?.filter((id) => ids.has(id)) ?? [];
    if (!related.length) continue;
    const item = document.createElement('li');
    for (const id of related) item.append(paragraph(definition.signals[id]!.description));
    const link = document.createElement('strong');
    link.textContent = `関連する案内：${candidate.title}`;
    item.append(link);
    relations.append(item);
  }
  mapping.replaceChildren(relations);
}

function showReason(decision: Decision) {
  reasonContent.replaceChildren();
  if (decision.assessments.length) {
    const list = document.createElement('ul');
    for (const assessment of decision.assessments) {
      const item = document.createElement('li');
      item.textContent = `${definition.contents[assessment.contentId]!.title}：${assessment.score.toFixed(2)}`;
      list.append(item);
    }
    reasonContent.append(list, paragraph('数値は登録した関連と回数・時間を使ったRulesの比較値です。関心や購入の確率ではありません。'));
  } else {
    reasonContent.append(paragraph('記録がないため、候補の採点を始めずに見送ります。'));
  }
  reason.hidden = false;
}

async function selectScenario(scenario: Scenario) {
  const current = ++revision;
  for (const button of options.querySelectorAll<HTMLButtonElement>('button[data-scenario]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario));
  }
  renderMockPage(document.querySelector<HTMLElement>('#mock-page')!, scenario);
  reason.hidden = true;
  reason.open = false;
  const snapshot = makeSnapshot(scenario);
  showEvidence(snapshot);
  showResult('判定中', '案内を比較しています', '選んだ閲覧記録を使って判定しています。');
  try {
    const decision = await evaluateSnapshot(definition, snapshot, engine);
    if (current !== revision) return;
    if (decision.type === 'recommend') {
      const candidate = definition.contents[decision.contentId]!;
      showResult('このページを見た方におすすめ', candidate.title, candidate.description, 'recommend');
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'guide-button'; open.textContent = 'ガイドの表示例を見る →';
      open.addEventListener('click', () => {
        guideTrigger = open;
        showGuide(decision.contentId);
      });
      result.append(open);
    } else if (decision.reason === 'ambiguous') {
      showResult('今回は見送り', '案内を見送ります', '検索と読書記録の候補が同点です。どちらかに絞る根拠が足りないため、案内を表示しません。', 'abstain');
    } else if (decision.reason === 'insufficient_evidence') {
      showResult('今回は見送り', '案内を見送ります', '閲覧記録がないため、案内を選びません。', 'abstain');
    } else {
      throw new Error('unexpected_playground_result');
    }
    showReason(decision);
  } catch {
    if (current !== revision) return;
    showResult('デモを実行できませんでした', 'もう一度お試しください', '「最初の閲覧例に戻す」を押してから、閲覧例を選び直してください。');
  }
}

const guide = document.querySelector<HTMLDialogElement>('#guide-dialog')!;
function showGuide(contentId: string): void {
  const candidate = definition.contents[contentId]!;
  document.querySelector('#guide-title')!.textContent = candidate.title;
  document.querySelector('#guide-description')!.textContent = candidate.description;
  const steps = document.querySelector('#guide-steps')!;
  steps.replaceChildren(...guideSteps[contentId]!.map((text) => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  guide.showModal();
}
document.querySelector('#close-guide')!.addEventListener('click', () => guide.close());
guide.addEventListener('close', () => {
  // Safari does not focus buttons on pointer activation, so restore the trigger explicitly.
  if (guideTrigger?.isConnected) guideTrigger.focus({ preventScroll: true });
});
options.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('button[data-scenario]');
  const scenario = button?.dataset.scenario;
  if (!scenario || !['features', 'cases', 'both', 'empty'].includes(scenario)) return;
  void selectScenario(scenario as Scenario);
});
reset.addEventListener('click', () => { void selectScenario('features'); });
options.disabled = false;
reset.disabled = false;
void selectScenario('features');

const copy = document.querySelector<HTMLButtonElement>('#copy-command')!;
const copyStatus = document.querySelector<HTMLElement>('#copy-status')!;
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector('#install-command')!.textContent!);
    copyStatus.textContent = 'コマンドをコピーしました。';
  } catch {
    copyStatus.textContent = 'コピーできませんでした。コマンドを選択してコピーしてください。';
  }
});
copy.disabled = false;
