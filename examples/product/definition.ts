import type { Definition } from '@imicue/core';

/** Fictional product content, shared by the static site and its optional local server. */
export const productDefinition: Definition = {
  schemaVersion: '0.1', siteId: 'pacelet-demo', definitionVersion: 'product-1',
  topics: {
    features: { description: 'タスクと予定を整理する機能' },
    cases: { description: 'チームの規模や役割に合わせた活用例' },
    documents: { description: 'プランと共有範囲を比較するための製品情報' },
    consultation: { description: '移行手順やチームの運用についての個別相談' },
  },
  signals: {
    overview: { kind: 'content', productId: 'pacelet', description: 'PACELETの製品概要' },
    problems: { kind: 'content', productId: 'pacelet', description: '担当・予定・進捗の共有に関する課題' },
    'feature-board': { kind: 'content', productId: 'pacelet', topicIds: ['features'], description: '担当と状態を一覧するボード機能の紹介' },
    'feature-timeline': { kind: 'content', productId: 'pacelet', topicIds: ['features'], description: '作業の重なりと締め切りを確認する予定表の紹介' },
    'case-creative': { kind: 'content', productId: 'pacelet', topicIds: ['cases'], description: '制作チームで担当と確認待ちを共有する架空の事例' },
    'case-operations': { kind: 'content', productId: 'pacelet', topicIds: ['cases'], description: '複数拠点で作業の引き継ぎを行う架空の事例' },
    security: { kind: 'content', productId: 'pacelet', topicIds: ['documents'], description: 'プロジェクトごとの共有範囲と役割の説明' },
    pricing: { kind: 'content', productId: 'pacelet', topicIds: ['documents'], description: '架空のプランを比較する料金表。購入意思を示すものではない' },
    'faq-migration': { kind: 'content', productId: 'pacelet', topicIds: ['consultation'], description: '既存のタスクを移す順序についてのFAQ' },
    rollout: { kind: 'content', productId: 'pacelet', topicIds: ['consultation'], description: 'チームごとに運用を整理して導入する手順' },
    'features-detail': { kind: 'content', productId: 'pacelet', contentId: 'product-features', topicIds: ['features'], description: '機能ページ本文の表示。読了の断定ではない' },
    'cases-detail': { kind: 'content', productId: 'pacelet', contentId: 'product-cases', topicIds: ['cases'], description: '事例ページ本文の表示。好意の断定ではない' },
    'resources-detail': { kind: 'content', productId: 'pacelet', contentId: 'product-documents', topicIds: ['documents'], description: '製品資料の内容と請求フォームの説明' },
    'contact-detail': { kind: 'content', productId: 'pacelet', contentId: 'product-contact', topicIds: ['consultation'], description: '個別相談の内容と問い合わせフォームの説明' },
  },
  contents: {
    'product-features': { title: '機能について詳しく見る', description: 'ボードと予定表の使い方を紹介します。', href: '/features/', enabled: true, productId: 'pacelet', topicIds: ['features'], relatedSignalIds: ['feature-board', 'feature-timeline'] },
    'product-cases': { title: 'チームの活用事例を見る', description: '制作チームと複数拠点での進め方を紹介します。', href: '/cases/', enabled: true, productId: 'pacelet', topicIds: ['cases'], relatedSignalIds: ['case-creative', 'case-operations'] },
    'product-documents': { title: '詳しい製品資料を見る', description: '機能・プラン・共有設定をまとめて確認できます。', href: '/resources/', enabled: true, productId: 'pacelet', topicIds: ['documents'], relatedSignalIds: ['security', 'pricing'] },
    'product-contact': { title: '導入について相談する', description: '移行の進め方やチームの運用を相談するフォームです。', href: '/contact/', enabled: true, productId: 'pacelet', topicIds: ['consultation'], relatedSignalIds: ['faq-migration', 'rollout'] },
  },
  pages: {
    home: { productId: 'pacelet' },
    features: { productId: 'pacelet', contentId: 'product-features' },
    cases: { productId: 'pacelet', contentId: 'product-cases' },
    resources: { productId: 'pacelet', contentId: 'product-documents' },
    contact: { productId: 'pacelet', contentId: 'product-contact' },
  },
};
