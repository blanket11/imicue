import type { Definition, SignalObservation, Snapshot } from '../src/index.js';

export const NOW = Date.parse('2026-09-26T00:00:00Z');

export function definition(): Definition {
  return {
    schemaVersion: '0.1', siteId: 'reading-notes', definitionVersion: 'demo-1',
    topics: {
      features: { description: '架空の読書ノートアプリの検索機能' },
      pricing: { description: '架空の読書ノートアプリの利用プラン' },
      cases: { description: '読書記録を整理する架空の利用例' },
    },
    signals: {
      features: { kind: 'content', description: '読書ノートの検索機能の紹介', productId: 'reading-notes', topicIds: ['features'] },
      pricing: { kind: 'content', description: '読書ノートの利用プランの紹介', productId: 'reading-notes', topicIds: ['pricing'] },
      cases: { kind: 'content', description: '読書記録の整理方法の紹介', productId: 'reading-notes', topicIds: ['cases'] },
      'feature-guide': { kind: 'content', description: '読書メモ検索ガイドの本文', contentId: 'feature-guide', productId: 'reading-notes', topicIds: ['features'] },
      action: { kind: 'action', description: '登録済みの機能操作', productId: 'reading-notes', topicIds: ['features'] },
      foreign: { kind: 'content', description: '別の架空製品の機能紹介', productId: 'another-product', topicIds: ['features'] },
    },
    contents: {
      'feature-guide': { title: '読書メモの検索ガイド', description: '読書ノートの検索機能を説明するガイド', href: '/guides/features/', productId: 'reading-notes', topicIds: ['features'], relatedSignalIds: ['features', 'action'], enabled: true },
      'pricing-guide': { title: '利用プランガイド', description: '読書ノートの利用プランを説明するガイド', href: '/guides/pricing/', productId: 'reading-notes', topicIds: ['pricing'], relatedSignalIds: ['pricing'], enabled: true },
      'case-guide': { title: '読書記録の整理ガイド', description: '読みかけの本と読書記録の整理方法を説明するガイド', href: '/guides/cases/', productId: 'reading-notes', topicIds: ['cases'], relatedSignalIds: ['cases'], enabled: true },
    },
    pages: { home: { productId: 'reading-notes' }, guide: { productId: 'reading-notes', contentId: 'feature-guide' }, shared: {} },
  };
}

/** Fully synthetic scale fixture; only the final registered candidate matches features. */
export function scaleDefinition(count = 100, maxIds = false): Definition {
  const source = definition();
  return {
    ...source,
    signals: { features: source.signals.features!, cases: source.signals.cases! },
    contents: Object.fromEntries(Array.from({ length: count }, (_, index) => {
      const contentId = `candidate-${String(index).padStart(3, '0')}`.padEnd(maxIds ? 64 : 13, 'x');
      const topic = index === count - 1 ? 'features' : 'cases';
      return [contentId, { title: `Synthetic guide ${index}`, description: `Synthetic ${topic} guide ${index}`,
        href: `/guides/${index}/`, enabled: true, topicIds: [topic], relatedSignalIds: [topic] }];
    })),
    pages: { home: {} },
  };
}

export function observation(signalId = 'features', overrides: Partial<SignalObservation> = {}): SignalObservation {
  return { signalId, source: 'direct', qualifiedViews: 2, visibleMs: 30_000, clicks: 0, actions: 0, lastSeenAgoMs: 0, ...overrides };
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: '0.1', siteId: 'reading-notes', definitionVersion: 'demo-1',
    snapshotId: 'snapshot-1', revision: 1, pageViewId: 'page-view-1', pageId: 'home', windowMs: 1_800_000,
    observations: [observation()], recent: [], outcomes: [], coverage: { truncated: false }, ...overrides,
  };
}

// Expectations are authored regression baselines, awaiting human semantic review.
// Development and holdout are separated for a future independent Jev comparison.
export const scenarios = [
  { id: 'first-visit', split: 'development', input: snapshot({ observations: [] }), expected: 'insufficient_evidence' },
  { id: 'features', split: 'development', input: snapshot(), expected: 'feature-guide' },
  { id: 'pricing', split: 'development', input: snapshot({ observations: [observation('pricing', { clicks: 1, qualifiedViews: 0, visibleMs: 0 })] }), expected: 'pricing-guide' },
  { id: 'cases', split: 'development', input: snapshot({ observations: [observation('cases', { visibleMs: 0 })] }), expected: 'case-guide' },
  { id: 'multiple-themes', split: 'development', input: snapshot({ observations: [observation(), observation('pricing')] }), expected: 'ambiguous' },
  { id: 'changing-theme', split: 'development', input: snapshot({ observations: [observation('features', { lastSeenAgoMs: 600_000 }), observation('pricing')] }), expected: 'pricing-guide' },
  { id: 'mixed-products', split: 'development', input: snapshot({ observations: [observation('foreign', { clicks: 1 }), observation('pricing')] }), expected: 'pricing-guide' },
  { id: 'single-idle-view', split: 'development', input: snapshot({ observations: [observation('features', { qualifiedViews: 1, visibleMs: 60_000 })] }), expected: 'insufficient_evidence' },
  { id: 'recommendation-only', split: 'holdout', input: snapshot({ observations: [observation('features', { source: 'recommendation', clicks: 1 })] }), expected: 'insufficient_evidence' },
  { id: 'expired-candidate', split: 'holdout', input: snapshot(), expiresFeature: true, expected: 'below_threshold' },
  { id: 'already-viewed', split: 'holdout', input: snapshot({ observations: [observation(), observation('feature-guide', { qualifiedViews: 1 })] }), expected: 'below_threshold' },
  { id: 'all-weak', split: 'holdout', input: snapshot({ observations: [observation('features', { visibleMs: 0, lastSeenAgoMs: 1_800_000 }), observation('pricing', { visibleMs: 0, lastSeenAgoMs: 1_800_000 })] }), expected: 'below_threshold' },
] as const;
