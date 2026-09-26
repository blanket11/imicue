import type { Definition, SignalObservation, Snapshot } from '../src/index.js';

export const NOW = Date.parse('2026-09-26T00:00:00Z');

export function definition(): Definition {
  return {
    schemaVersion: '0.1', siteId: 'demo-contract', definitionVersion: 'demo-1',
    topics: {
      features: { description: '架空製品DemoContractの機能' },
      pricing: { description: '架空製品DemoContractの料金' },
      cases: { description: '架空製品DemoContractの利用例' },
    },
    signals: {
      features: { kind: 'content', description: 'DemoContractの機能紹介', productId: 'demo-contract', topicIds: ['features'] },
      pricing: { kind: 'content', description: 'DemoContractの料金紹介', productId: 'demo-contract', topicIds: ['pricing'] },
      cases: { kind: 'content', description: 'DemoContractの利用例紹介', productId: 'demo-contract', topicIds: ['cases'] },
      'feature-guide': { kind: 'content', description: 'DemoContractの機能ガイド本文', contentId: 'feature-guide', productId: 'demo-contract', topicIds: ['features'] },
      action: { kind: 'action', description: '登録済みの機能操作', productId: 'demo-contract', topicIds: ['features'] },
      foreign: { kind: 'content', description: '別の架空製品の機能紹介', productId: 'another-product', topicIds: ['features'] },
    },
    contents: {
      'feature-guide': { title: '機能ガイド', description: 'DemoContractの機能の詳しい解説', href: '/guides/features/', productId: 'demo-contract', topicIds: ['features'], relatedSignalIds: ['features', 'action'], enabled: true },
      'pricing-guide': { title: '料金ガイド', description: 'DemoContractの料金の詳しい解説', href: '/guides/pricing/', productId: 'demo-contract', topicIds: ['pricing'], relatedSignalIds: ['pricing'], enabled: true },
      'case-guide': { title: '利用例ガイド', description: 'DemoContractの利用例の詳しい解説', href: '/guides/cases/', productId: 'demo-contract', topicIds: ['cases'], relatedSignalIds: ['cases'], enabled: true },
    },
    pages: { home: { productId: 'demo-contract' }, guide: { productId: 'demo-contract', contentId: 'feature-guide' }, shared: {} },
  };
}

export function observation(signalId = 'features', overrides: Partial<SignalObservation> = {}): SignalObservation {
  return { signalId, source: 'direct', qualifiedViews: 2, visibleMs: 30_000, clicks: 0, actions: 0, lastSeenAgoMs: 0, ...overrides };
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: '0.1', siteId: 'demo-contract', definitionVersion: 'demo-1',
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
