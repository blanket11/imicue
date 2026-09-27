import { validateDefinition, type SignalObservation, type Snapshot } from '@imicue/core';

// Fixed browsing examples, evaluated by the real Rules engine. No tracker is created.
export const definition = validateDefinition({
  schemaVersion: '0.1', siteId: 'public-playground', definitionVersion: 'playground-2',
  topics: {
    features: { description: '契約書の全文検索機能' },
    cases: { description: '営業チームの契約更新の運用' },
  },
  signals: {
    'features-overview': { kind: 'content', description: '契約書の本文から必要な条項を探す、全文検索機能の概要。', topicIds: ['features'] },
    'features-detail': { kind: 'content', description: '検索した語句の前後を一覧で確認する手順。', topicIds: ['features'] },
    'cases-overview': { kind: 'content', description: '営業チームで契約の更新漏れが起きていた事例。', topicIds: ['cases'] },
    'cases-detail': { kind: 'content', description: '担当者と更新予定を一緒に確認する運用に変えた事例。', topicIds: ['cases'] },
  },
  contents: {
    'feature-guide': { title: '契約書の全文検索ガイド', description: '本文の検索から、一致した箇所の確認まで。全文検索の使い方を紹介するガイド。', href: '/guides/features/',
      productId: 'sample', topicIds: ['features'], relatedSignalIds: ['features-overview', 'features-detail'], enabled: true },
    'case-guide': { title: '営業チームの契約更新事例', description: '担当者と更新予定を確認し、契約の更新漏れを防ぐ運用を紹介する事例。', href: '/guides/cases/',
      productId: 'sample', topicIds: ['cases'], relatedSignalIds: ['cases-overview', 'cases-detail'], enabled: true },
  },
  pages: { home: { productId: 'sample' } },
});

export type Scenario = 'features' | 'cases' | 'both' | 'empty';
export const observationLabels: Record<string, string> = {
  'features-overview': '全文検索の概要', 'features-detail': '検索結果の確認手順',
  'cases-overview': '営業チームの課題', 'cases-detail': '契約更新の運用例',
};

export function makeSnapshot(scenario: Scenario): Snapshot {
  const ids = scenario === 'empty' ? [] : Object.keys(definition.signals).filter((id) => scenario === 'both' || id.startsWith(scenario));
  const observations: SignalObservation[] = ids.map((signalId) => ({ signalId, source: 'direct',
    qualifiedViews: 1, visibleMs: 30_000, clicks: 0, actions: 0, lastSeenAgoMs: 0,
  }));
  return { schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion,
    snapshotId: `synthetic-${scenario}`, revision: 1, pageViewId: 'synthetic-page', pageId: 'home',
    windowMs: 1_800_000, observations, recent: [], outcomes: [], coverage: { truncated: false },
  };
}
