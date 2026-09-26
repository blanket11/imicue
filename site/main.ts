import { createRulesEngine, evaluateSnapshot, type Decision } from '@imicue/core';
import { definition, makeSnapshot, type Scenario } from './scenarios.js';

const options = document.querySelector<HTMLFieldSetElement>('#scenario-options')!;
const result = document.querySelector<HTMLElement>('#result')!;
const reset = document.querySelector<HTMLButtonElement>('#reset-demo')!;
const reason = document.querySelector<HTMLDetailsElement>('#reason')!;
const reasonContent = document.querySelector<HTMLElement>('#reason-content')!;
const engine = createRulesEngine();
let revision = 0;

function showResult(label: string, title: string, description: string) {
  const eyebrow = document.createElement('p');
  eyebrow.className = 'result-label';
  eyebrow.textContent = label;
  const heading = document.createElement('h4');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = description;
  result.replaceChildren(eyebrow, heading, text);
}

function showReason(decision: Decision, scenario: Scenario) {
  const explanation = document.createElement('p');
  explanation.textContent = scenario === 'empty' ? '合成の行動記録が空のため、採点を始めずに見送ります。'
    : scenario === 'both' ? '機能と料金を各2回表示した合成記録です。両方の候補が同点になり、見送ります。'
      : `${scenario === 'features' ? '機能を使う' : '料金を調べる'}操作を1回行った合成記録です。辞書でその操作に関連付けた候補を評価します。`;
  reasonContent.replaceChildren(explanation);
  if (decision.assessments.length) {
    const list = document.createElement('ul');
    for (const assessment of decision.assessments) {
      const item = document.createElement('li');
      item.textContent = `${definition.contents[assessment.contentId]!.title}：${assessment.score.toFixed(2)}`;
      list.append(item);
    }
    const note = document.createElement('p');
    note.textContent = '数値はRulesの比較値です。関心や購入の確率ではありません。';
    reasonContent.append(list, note);
  }
  reason.hidden = false;
}

options.addEventListener('change', async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !['features', 'pricing', 'both', 'empty'].includes(input.value)) return;
  const scenario = input.value as Scenario;
  const current = ++revision;
  reason.hidden = true;
  reason.open = false;
  try {
    const decision = await evaluateSnapshot(definition, makeSnapshot(scenario), engine);
    if (current !== revision) return;
    if (decision.type === 'recommend') {
      const candidate = definition.contents[decision.contentId]!;
      showResult('案内候補', candidate.title, candidate.description);
    } else if (decision.reason === 'ambiguous') {
      showResult('今回は見送り', '案内を見送ります', '機能と料金のどちらを案内するか、根拠だけでは絞れません。');
    } else if (decision.reason === 'insufficient_evidence') {
      showResult('今回は見送り', '案内を見送ります', '行動の根拠がまだないため、ガイドを選びません。');
    } else {
      throw new Error('unexpected_playground_result');
    }
    showReason(decision, scenario);
  } catch {
    if (current !== revision) return;
    showResult('デモを実行できませんでした', 'もう一度お試しください', '「最初の状態に戻す」を押してから、操作を選び直してください。');
  }
});

reset.addEventListener('click', () => {
  revision++;
  for (const input of options.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
  reason.hidden = true;
  reason.open = false;
  reasonContent.replaceChildren();
  showResult('操作を待っています', 'まずは操作を選ぶ', '操作を選ぶと、ここに結果を表示します。');
});
options.disabled = false;
reset.disabled = false;

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
