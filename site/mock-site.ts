import type { Scenario } from './scenarios.js';

const pages: Record<Scenario, { label: string; title: string; description: string; items: readonly [string, string][] }> = {
  features: { label: '検索機能', title: '本を探す', description: '題名やメモから、読み返したい記録を探せます。',
    items: [['海辺の灯台', 'メモ：灯台守との会話'], ['森の図書館', 'メモ：忘れられた一冊']] },
  cases: { label: '読書記録', title: '読みかけの本を、ひとまとめに。', description: '本の状態とメモを整理し、読書の続きを見つけられます。',
    items: [['旅の余白', '読みかけ · 84ページまで'], ['森の図書館', '読み終えた · 感想を保存']] },
  both: { label: '2つのページを閲覧した例', title: '本の検索も、読書記録も。', description: '検索機能と記録の使い方を、同じ回数・時間だけ見た場合です。',
    items: [['本を探す', '概要と詳細を各30秒'], ['読書記録', '概要と詳細を各30秒']] },
  empty: { label: '閲覧記録のない例', title: 'まだ、案内を選ぶ前。', description: 'この例には、表示や操作の記録がありません。', items: [] },
};

export function renderMockPage(container: HTMLElement, scenario: Scenario): void {
  const page = pages[scenario];
  const label = document.createElement('p'); label.className = 'mock-kicker'; label.textContent = page.label;
  const title = document.createElement('h3'); title.textContent = page.title;
  const description = document.createElement('p'); description.textContent = page.description;
  const items = document.createElement('div'); items.className = 'sample-books';
  for (const [name, note] of page.items) {
    const item = document.createElement('div'); item.className = 'sample-book'; item.textContent = name;
    const detail = document.createElement('small'); detail.textContent = note; item.append(detail); items.append(item);
  }
  container.replaceChildren(label, title, description, items);
}

export const guideSteps: Record<string, readonly string[]> = {
  'feature-guide': ['本の題名や、メモに残した言葉で検索します。', '検索結果から読み返したい本を選びます。', 'その本に保存したメモを見返します。'],
  'case-guide': ['本を「読みかけ」「読み終えた」に分けます。', '読み進めたページ数や感想を残します。', '読みかけの一覧から、続きを読む本を選びます。'],
};
