import { validateDefinition, type SignalObservation, type Snapshot } from '@imicue/core';

import { productDefinition } from '../examples/product/definition.js';

// The same dictionary as the product demo, evaluated without creating a tracker.
export const definition = validateDefinition(productDefinition);
export type Scenario = 'features' | 'cases' | 'documents' | 'contact' | 'both' | 'empty';
const scenarioSignals: Record<Scenario, readonly string[]> = {
  features: ['feature-board', 'feature-timeline'],
  cases: ['case-creative', 'case-operations'],
  documents: ['security', 'pricing'],
  contact: ['faq-migration', 'rollout'],
  both: ['feature-board', 'feature-timeline', 'case-creative', 'case-operations'],
  empty: [],
};
export const observationLabels: Record<string, string> = {
  'feature-board': 'ボード機能の説明', 'feature-timeline': '予定表の説明',
  'case-creative': '制作チームの事例', 'case-operations': '複数拠点の事例',
  security: '共有範囲の説明', pricing: '料金表',
  'faq-migration': 'データ移行のFAQ', rollout: '導入までの流れ',
};

export function makeSnapshot(scenario: Scenario): Snapshot {
  const ids = scenarioSignals[scenario];
  const observations: SignalObservation[] = ids.map((signalId) => ({ signalId, source: 'direct',
    qualifiedViews: 1, visibleMs: 30_000, clicks: 0, actions: 0, lastSeenAgoMs: 0,
  }));
  return { schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion,
    snapshotId: `synthetic-${scenario}`, revision: 1, pageViewId: 'synthetic-page', pageId: 'home',
    windowMs: 1_800_000, observations, recent: [], outcomes: [], coverage: { truncated: false },
  };
}
