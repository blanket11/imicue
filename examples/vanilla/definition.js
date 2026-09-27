/** @type {import('@imicue/core').Definition} */
export const definition = {
  schemaVersion: '0.1',
  siteId: 'reading-notes',
  definitionVersion: 'demo-1',
  topics: {
    features: { description: '読書ノートアプリで本やメモを検索する機能' },
    pricing: { description: '読書記録を保存する架空の利用プラン' },
    cases: { description: '読みかけの本と読書記録を整理する方法' },
  },
  signals: {
    'demo-features': {
      kind: 'content', label: '機能の紹介', productId: 'reading-notes', topicIds: ['features'],
      description: '読書ノートアプリで本の題名や読書メモを探す架空の機能紹介',
    },
    'demo-pricing': {
      kind: 'content', label: '利用プランの案内', productId: 'reading-notes', topicIds: ['pricing'],
      description: '読書記録の保存数や端末間同期を比べる架空の利用プラン案内',
    },
    'demo-cases': {
      kind: 'content', label: '利用場面', productId: 'reading-notes', topicIds: ['cases'],
      description: '読みかけの本を分けて、次に読む本を見つける架空の使い方',
    },
    'demo-feature-used': {
      kind: 'action', label: '検索例の操作', productId: 'reading-notes', topicIds: ['features'],
      description: '固定の読書メモ検索例を開く操作。入力や検索語は記録しない',
    },
    'demo-features-guide-view': {
      kind: 'content', label: '機能ガイドの表示', productId: 'reading-notes', topicIds: ['features'],
      contentId: 'demo-features-guide', description: '読書メモの検索ガイド本文の表示',
    },
    'demo-pricing-guide-view': {
      kind: 'content', label: '利用プランガイドの表示', productId: 'reading-notes', topicIds: ['pricing'],
      contentId: 'demo-pricing-guide', description: '読書ノートの利用プランガイド本文の表示',
    },
    'demo-cases-guide-view': {
      kind: 'content', label: '事例ガイドの表示', productId: 'reading-notes', topicIds: ['cases'],
      contentId: 'demo-cases-guide', description: '読書記録の整理ガイド本文の表示',
    },
  },
  contents: {
    'demo-features-guide': {
      title: '検索ガイドを見る', href: '/guides/features/', enabled: true,
      productId: 'reading-notes', topicIds: ['features'], relatedSignalIds: ['demo-features', 'demo-feature-used'],
      description: '本の題名や読書メモから記録を探す方法を説明する架空のガイド',
    },
    'demo-pricing-guide': {
      title: '利用プランガイドを見る', href: '/guides/pricing/', enabled: true,
      productId: 'reading-notes', topicIds: ['pricing'], relatedSignalIds: ['demo-pricing'],
      description: '費用を考える際の項目について説明する架空のガイド',
    },
    'demo-cases-guide': {
      title: '記録の整理ガイドを見る', href: '/guides/cases/', enabled: true,
      productId: 'reading-notes', topicIds: ['cases'], relatedSignalIds: ['demo-cases'],
      description: '読みかけと読み終えた本を整理する方法を説明する架空のガイド',
    },
  },
  pages: {
    home: { productId: 'reading-notes' },
    'features-guide': { productId: 'reading-notes', contentId: 'demo-features-guide' },
    'pricing-guide': { productId: 'reading-notes', contentId: 'demo-pricing-guide' },
    'cases-guide': { productId: 'reading-notes', contentId: 'demo-cases-guide' },
  },
};
