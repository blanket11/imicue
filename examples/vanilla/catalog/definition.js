// This one catalog is imported by the static example and its local server.
const formats = ['解説ページ', '活用資料', '相談窓口', '事例資料', 'セミナー', '設定ガイド', 'チェックリスト'];
const subjects = ['電子署名', '監査ログ', '請求書の発行', '権限の設定', 'データのバックアップ', '契約の承認', '保存期間', '外部連携', '多言語の設定', '支払い方法', '利用者の招待', '通知の設定', '契約書の作成', 'ファイル形式'];
const contents = Object.fromEntries(Array.from({ length: 98 }, (_, index) => {
  const subject = subjects[Math.floor(index / formats.length)];
  const format = formats[index % formats.length];
  const contentId = `catalog-${String(index).padStart(3, '0')}`;
  return [contentId, {
    title: `${subject}の${format}`, description: `${subject}について扱う${format}。契約書の全文検索や、営業部門による更新漏れ対策の事例は扱わない。架空の案内先。`,
    href: `/catalog/guide.html?content=${contentId}`, enabled: true, productId: 'demo-contract',
  }];
}));
contents['catalog-098'] = {
  title: '営業チームの契約更新事例',
  description: '営業チームが担当者と更新予定を確認し、契約の更新漏れを防ぐための運用を紹介する架空の事例ページ。',
  href: '/catalog/guide.html?content=catalog-098', enabled: true, productId: 'demo-contract',
  topicIds: ['cases'], relatedSignalIds: ['catalog-cases-overview', 'catalog-cases-detail'],
};
contents['catalog-099'] = {
  title: '契約書の全文検索ガイド',
  description: '取り込んだ契約書の本文を語句で検索し、一致箇所を一覧で確認する機能を具体的に説明する架空のガイドページ。',
  href: '/catalog/guide.html?content=catalog-099', enabled: true, productId: 'demo-contract',
  topicIds: ['features'], relatedSignalIds: ['catalog-features-overview', 'catalog-features-detail'],
};
const signals = {
  'catalog-features-overview': { kind: 'content', topicIds: ['features'], description: '契約書の本文を語句で検索して必要な条項を探す機能の概要。' },
  'catalog-features-detail': { kind: 'content', topicIds: ['features'], description: '全文検索で一致した語句の前後を一覧に並べ、関連する契約書を確認する手順。' },
  'catalog-cases-overview': { kind: 'content', topicIds: ['cases'], description: '営業チームが契約の更新漏れに困っていたという架空の導入事例。' },
  'catalog-cases-detail': { kind: 'content', topicIds: ['cases'], description: '営業チームが担当者と更新予定を一緒に確認する運用へ変えた架空の事例。' },
};
for (const [contentId, content] of Object.entries(contents)) {
  signals[`${contentId}-view`] = { kind: 'content', contentId, description: content.description };
}

/** @type {import('@imicue/core').Definition} */
export const catalogDefinition = {
  schemaVersion: '0.1', siteId: 'demo-catalog', definitionVersion: 'catalog-17e03b1e14f30442',
  topics: {
    features: { description: '契約書の全文検索機能と一覧表示の使い方' },
    cases: { description: '営業チームで契約の更新漏れを防ぐ運用の事例' },
  },
  signals, contents,
  pages: {
    'catalog-features': { productId: 'demo-contract' },
    'catalog-cases': { productId: 'demo-contract' },
    ...Object.fromEntries(Object.keys(contents).map((contentId) => [contentId, { productId: 'demo-contract', contentId }])),
  },
};
