import { validateDefinition, type SignalObservation, type Snapshot } from '@imicue/core';

// Fixed browsing examples, evaluated by the real Rules engine. No tracker is created.
export const definition = validateDefinition({
  schemaVersion: '0.1', siteId: 'public-playground', definitionVersion: 'playground-2',
  topics: {
    features: { description: '本の情報や読書メモを検索する機能' },
    cases: { description: '読みかけの本と読書記録を整理する方法' },
  },
  signals: {
    'features-overview': { kind: 'content', description: '本の題名や著者名から本を探す機能の概要。', topicIds: ['features'] },
    'features-detail': { kind: 'content', description: '検索結果から本の情報と読書メモを確認する手順。', topicIds: ['features'] },
    'cases-overview': { kind: 'content', description: '読みかけと読み終えた本を分けて記録する方法。', topicIds: ['cases'] },
    'cases-detail': { kind: 'content', description: '読書の状態とメモを一覧で整理する手順。', topicIds: ['cases'] },
  },
  contents: {
    'feature-guide': { title: '読書メモを検索するガイド', description: '本の題名やメモの語句から記録を探し、内容を見返す方法を紹介するガイド。', href: '/guides/features/',
      productId: 'sample', topicIds: ['features'], relatedSignalIds: ['features-overview', 'features-detail'], enabled: true },
    'case-guide': { title: '読みかけの本を整理する方法', description: '読みかけ・読み終えた本を記録し、読書の続きを見つけやすくする方法を紹介するガイド。', href: '/guides/cases/',
      productId: 'sample', topicIds: ['cases'], relatedSignalIds: ['cases-overview', 'cases-detail'], enabled: true },
  },
  pages: { home: { productId: 'sample' } },
});

export type Scenario = 'features' | 'cases' | 'both' | 'empty';
export const observationLabels: Record<string, string> = {
  'features-overview': '本の検索機能の概要', 'features-detail': '検索結果とメモの確認手順',
  'cases-overview': '読書記録の整理方法', 'cases-detail': '読みかけの本のまとめ方',
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
