// This one catalog is imported by the static example and its local server.
const formats = ['読み物', '記事', '確認リスト', 'よくある質問', '入門ガイド', '用語集', '動画'];
const subjects = ['著者を調べる', '図書館の予約', '読書会の案内', '本の装丁', '文学賞の紹介', '書店を探す', '電子書籍の設定', '音声で本を聴く', '翻訳作品の紹介', '出版のしくみ', '古書の探し方', '絵本の選び方', '雑誌の定期購読', '本の保管方法'];
const contents = Object.fromEntries(Array.from({ length: 98 }, (_, index) => {
  const subject = subjects[Math.floor(index / formats.length)];
  const format = formats[index % formats.length];
  const contentId = `catalog-${String(index).padStart(3, '0')}`;
  return [contentId, {
    title: `${subject}：${format}`, description: `${subject}について紹介する${format}です。架空の案内先です。`,
    href: `/catalog/guide.html?content=${contentId}`, enabled: true, productId: 'reading-notes',
  }];
}));
contents['catalog-098'] = {
  title: '読みかけの本を整理する方法',
  description: '読みたい本・読んでいる本・読み終えた本を分け、次に読む本を見つける方法を紹介する架空のガイド。',
  href: '/catalog/guide.html?content=catalog-098', enabled: true, productId: 'reading-notes',
  topicIds: ['cases'], relatedSignalIds: ['catalog-cases-overview', 'catalog-cases-detail'],
};
contents['catalog-099'] = {
  title: '読書メモを検索するガイド',
  description: '本の題名や読書メモに書いた語句で記録を探し、該当するメモを見返す方法を紹介する架空のガイド。',
  href: '/catalog/guide.html?content=catalog-099', enabled: true, productId: 'reading-notes',
  topicIds: ['features'], relatedSignalIds: ['catalog-features-overview', 'catalog-features-detail'],
};
const signals = {
  'catalog-features-overview': { kind: 'content', topicIds: ['features'], description: '本の題名や著者名から、読書ノートに記録した本を探す機能の概要。' },
  'catalog-features-detail': { kind: 'content', topicIds: ['features'], description: '検索結果から本を選び、その本に付けた読書メモを確認する手順。' },
  'catalog-cases-overview': { kind: 'content', topicIds: ['cases'], description: '読みたい本、読んでいる本、読み終えた本を分けて記録する方法。' },
  'catalog-cases-detail': { kind: 'content', topicIds: ['cases'], description: '読書の状態やメモを一覧で見返し、続きを読む本を決める手順。' },
};
for (const [contentId, content] of Object.entries(contents)) {
  signals[`${contentId}-view`] = { kind: 'content', contentId, description: content.description };
}

/** @type {import('@imicue/core').Definition} */
export const catalogDefinition = {
  schemaVersion: '0.1', siteId: 'demo-catalog', definitionVersion: 'catalog-358edb89a934e751',
  topics: {
    features: { description: '本の題名や読書メモを検索する機能' },
    cases: { description: '読書記録を整理して続きを読む本を見つける方法' },
  },
  signals, contents,
  pages: {
    'catalog-features': { productId: 'reading-notes' },
    'catalog-cases': { productId: 'reading-notes' },
    ...Object.fromEntries(Object.keys(contents).map((contentId) => [contentId, { productId: 'reading-notes', contentId }])),
  },
};
