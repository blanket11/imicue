/** @type {import('@imicue/core').Definition} */
export const definition = {
  schemaVersion: '0.1',
  siteId: 'demo-contract',
  definitionVersion: 'demo-1',
  topics: {
    features: { description: '架空製品DemoContractの機能と操作に関する情報' },
    pricing: { description: '架空製品DemoContractの費用構成に関する情報' },
    cases: { description: '架空製品DemoContractの利用場面に関する情報' },
  },
  signals: {
    'demo-features': {
      kind: 'content', label: '機能の紹介', productId: 'demo-contract', topicIds: ['features'],
      description: 'DemoContractで契約書を検索し、一覧で確認する架空の機能紹介',
    },
    'demo-pricing': {
      kind: 'content', label: '料金の考え方', productId: 'demo-contract', topicIds: ['pricing'],
      description: 'DemoContractの費用構成と見積もりの考え方を説明する架空のセクション',
    },
    'demo-cases': {
      kind: 'content', label: '利用場面', productId: 'demo-contract', topicIds: ['cases'],
      description: 'DemoContractで契約書を探す場面やチームで確認する場面を説明する架空の事例',
    },
    'demo-feature-used': {
      kind: 'action', label: '検索例の操作', productId: 'demo-contract', topicIds: ['features'],
      description: 'DemoContractの固定された検索例を開く操作。入力テキストは記録しない',
    },
    'demo-features-guide-view': {
      kind: 'content', label: '機能ガイドの表示', productId: 'demo-contract', topicIds: ['features'],
      contentId: 'demo-features-guide', description: 'DemoContractの機能ガイド本文の表示',
    },
    'demo-pricing-guide-view': {
      kind: 'content', label: '料金ガイドの表示', productId: 'demo-contract', topicIds: ['pricing'],
      contentId: 'demo-pricing-guide', description: 'DemoContractの料金ガイド本文の表示',
    },
    'demo-cases-guide-view': {
      kind: 'content', label: '事例ガイドの表示', productId: 'demo-contract', topicIds: ['cases'],
      contentId: 'demo-cases-guide', description: 'DemoContractの事例ガイド本文の表示',
    },
  },
  contents: {
    'demo-features-guide': {
      title: '機能ガイドを見る', href: '/guides/features/', enabled: true,
      productId: 'demo-contract', topicIds: ['features'], relatedSignalIds: ['demo-features', 'demo-feature-used'],
      description: '契約書の検索と一覧表示について説明する架空のガイド',
    },
    'demo-pricing-guide': {
      title: '料金ガイドを見る', href: '/guides/pricing/', enabled: true,
      productId: 'demo-contract', topicIds: ['pricing'], relatedSignalIds: ['demo-pricing'],
      description: '費用を考える際の項目について説明する架空のガイド',
    },
    'demo-cases-guide': {
      title: '事例ガイドを見る', href: '/guides/cases/', enabled: true,
      productId: 'demo-contract', topicIds: ['cases'], relatedSignalIds: ['demo-cases'],
      description: '契約書を探す場面と共有する場面を説明する架空のガイド',
    },
  },
  pages: {
    home: { productId: 'demo-contract' },
    'features-guide': { productId: 'demo-contract', contentId: 'demo-features-guide' },
    'pricing-guide': { productId: 'demo-contract', contentId: 'demo-pricing-guide' },
    'cases-guide': { productId: 'demo-contract', contentId: 'demo-cases-guide' },
  },
};
