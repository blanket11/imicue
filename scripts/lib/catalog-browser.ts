import type { Fetch } from '@typesafe-ai/sdk';
import { validateDecision, validateSnapshot } from '@imicue/core';
import { JEV_MODEL } from '@imicue/server';
import { catalogDefinition } from '../../examples/vanilla/catalog/definition.js';

export const CATALOG_BROWSER_MAX_ATTEMPTS = 24;
export const CATALOG_BROWSER_ATTEMPTS_PER_BROWSER = 8;
export type CatalogBrowserName = 'chromium' | 'firefox' | 'webkit';
export type CatalogBrowserTopic = 'features' | 'cases';

/** Independent run cap, in addition to the shared persistent 600-attempt ledger. No reset API. */
export function createCatalogBrowserAttemptCap() {
  let total = 0;
  const counts = new Map<CatalogBrowserName, number>();
  return {
    wrap(browser: CatalogBrowserName, transport: Fetch): Fetch {
      return async (url, init) => {
        if (init?.signal?.aborted) throw new Error('catalog_browser_aborted');
        const current = counts.get(browser) ?? 0;
        if (current >= CATALOG_BROWSER_ATTEMPTS_PER_BROWSER || total >= CATALOG_BROWSER_MAX_ATTEMPTS) throw new Error('catalog_browser_attempt_limit');
        counts.set(browser, current + 1); total++;
        return transport(url, init);
      };
    },
    count(browser?: CatalogBrowserName): number { return browser ? counts.get(browser) ?? 0 : total; },
  };
}

/** Returns only registered IDs, bounded counters and flags; never retains raw remote bodies. */
export function inspectCatalogBrowserDecision(raw: unknown, observed: unknown, topic: CatalogBrowserTopic, now = Date.now()) {
  const expectedContentId = topic === 'cases' ? 'catalog-098' : 'catalog-099';
  try {
    const snapshot = validateSnapshot(observed, catalogDefinition);
    const decision = validateDecision(raw, catalogDefinition, snapshot, now);
    const observations = snapshot.observations.filter(row => row.source === 'direct');
    const views = observations.reduce((sum, row) => sum + row.qualifiedViews, 0);
    const clicks = observations.reduce((sum, row) => sum + row.clicks, 0);
    const actions = observations.reduce((sum, row) => sum + row.actions, 0);
    const zeroClickBrowsing = views >= 2 && observations.length >= 2 && clicks === 0 && actions === 0;
    const complete = decision.assessments.length === 100 && new Set(decision.assessments.map(row => row.contentId)).size === 100;
    const valid = complete && zeroClickBrowsing && decision.engine.name === 'jev' && decision.engine.model === JEV_MODEL;
    return { valid, complete, zeroClickBrowsing, assessedCount: decision.assessments.length, views, clicks, actions,
      type: decision.type, result: decision.type === 'recommend' ? decision.contentId : decision.reason,
      semanticMatch: decision.type === 'recommend' && decision.contentId === expectedContentId,
      expectedContentId, policyVersion: decision.policyVersion };
  } catch {
    return { valid: false, complete: false, zeroClickBrowsing: false, assessedCount: 0,
      views: 0, clicks: 0, actions: 0, type: 'invalid', result: 'invalid_result', semanticMatch: false, expectedContentId, policyVersion: null };
  }
}
