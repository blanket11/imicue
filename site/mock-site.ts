import type { Scenario } from './scenarios.js';

const pages: Record<Scenario, { label: string; title: string; description: string; items: readonly [string, string][] }> = {
  features: { label: '機能の閲覧例', title: '担当と予定を、ひとつの場所で。', description: 'ボード機能と予定表の説明を見た場合です。',
    items: [['ボード', '担当と進捗を一覧で共有'], ['予定表', '作業の重なりと締め切りを確認']] },
  cases: { label: '事例の閲覧例', title: 'チームに合う進め方を見つける。', description: '制作チームと複数拠点での活用事例を見た場合です。',
    items: [['制作チーム', '担当と確認待ちを共有'], ['複数拠点', '作業の引き継ぎを整理']] },
  documents: { label: '料金・共有設定の閲覧例', title: 'プランと共有範囲を確認する。', description: '料金表とプロジェクトの共有範囲の説明を見た場合です。',
    items: [['料金表', 'チームに合うプランを比較'], ['共有設定', 'プロジェクトごとに役割を設定']] },
  contact: { label: '導入手順の閲覧例', title: '今の仕事を、どう移していくか。', description: 'データ移行のFAQと導入までの流れを見た場合です。',
    items: [['データ移行', '既存のタスクを移す順序'], ['導入の流れ', 'チームごとに運用を整理']] },
  both: { label: '機能と事例を同じだけ見た例', title: '機能も、活用事例も。', description: '機能と事例の説明を、同じ回数・時間だけ見た場合です。',
    items: [['機能', 'ボードと予定表を各30秒'], ['事例', '制作チームと複数拠点を各30秒']] },
  empty: { label: '閲覧記録のない例', title: 'まだ、案内を選ぶ前。', description: 'この例には、表示や操作の記録がありません。', items: [] },
};

export function renderMockPage(container: HTMLElement, scenario: Scenario): void {
  const page = pages[scenario];
  const label = document.createElement('p'); label.className = 'mock-kicker'; label.textContent = page.label;
  const title = document.createElement('h3'); title.textContent = page.title;
  const description = document.createElement('p'); description.textContent = page.description;
  const items = document.createElement('div'); items.className = 'product-topics';
  for (const [name, note] of page.items) {
    const item = document.createElement('div'); item.className = 'product-topic'; item.textContent = name;
    const detail = document.createElement('small'); detail.textContent = note; item.append(detail); items.append(item);
  }
  container.replaceChildren(label, title, description, items);
}

export const guideSteps: Record<string, readonly string[]> = {
  'product-features': ['ボードで担当と進捗を一覧にします。', '予定表で締め切りと作業の重なりを確認します。', '担当者と次の作業をチームで共有します。'],
  'product-cases': ['制作チームで担当と確認待ちを共有する例を紹介します。', '複数拠点で作業を引き継ぐ例を紹介します。', 'チームの役割に合わせた進め方を確認できます。'],
  'product-documents': ['製品資料でボードと予定表の機能を確認します。', 'プランごとの違いと共有範囲を比較します。', 'ローカルデモでは、資料請求の完了表示を試せます。'],
  'product-contact': ['データ移行やチームの運用について相談するページです。', '移行の進め方や確認したい内容をフォームに入力します。', 'ローカルデモでは、外部に送信せず完了表示を試せます。'],
};
