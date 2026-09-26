import { validateDefinition, type SignalObservation, type Snapshot } from '@imicue/core';

// Synthetic inputs for an explicit playground. This page never creates a browser tracker.
export const definition = validateDefinition({
  schemaVersion: '0.1', siteId: 'public-playground', definitionVersion: 'playground-1',
  topics: { features: { description: '架空サービスの機能' }, pricing: { description: '架空サービスの料金' } },
  signals: {
    features: { kind: 'action', description: '架空サービスの機能を使う操作', productId: 'sample', topicIds: ['features'] },
    pricing: { kind: 'action', description: '架空サービスの料金を調べる操作', productId: 'sample', topicIds: ['pricing'] },
    'features-view': { kind: 'content', description: '架空サービスの機能紹介の表示', productId: 'sample', topicIds: ['features'] },
    'pricing-view': { kind: 'content', description: '架空サービスの料金紹介の表示', productId: 'sample', topicIds: ['pricing'] },
  },
  contents: {
    'feature-guide': { title: '機能ガイド', description: '操作した機能を詳しく知るためのガイドです。', href: '/guides/features/',
      productId: 'sample', topicIds: ['features'], relatedSignalIds: ['features', 'features-view'], enabled: true },
    'pricing-guide': { title: '料金ガイド', description: '料金やプランの違いを確かめるためのガイドです。', href: '/guides/pricing/',
      productId: 'sample', topicIds: ['pricing'], relatedSignalIds: ['pricing', 'pricing-view'], enabled: true },
  },
  pages: { home: { productId: 'sample' } },
});

export type Scenario = 'features' | 'pricing' | 'both' | 'empty';

export function makeSnapshot(scenario: Scenario): Snapshot {
  const ids = scenario === 'empty' ? [] : scenario === 'both' ? ['features-view', 'pricing-view'] : [scenario];
  const observations: SignalObservation[] = ids.map((signalId) => ({ signalId, source: 'direct',
    qualifiedViews: scenario === 'both' ? 2 : 0, visibleMs: 0, clicks: 0,
    actions: scenario === 'both' ? 0 : 1, lastSeenAgoMs: 0,
  }));
  return { schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion,
    snapshotId: `synthetic-${scenario}`, revision: 1, pageViewId: 'synthetic-page', pageId: 'home',
    windowMs: 1_800_000, observations, recent: [], outcomes: [], coverage: { truncated: false },
  };
}
