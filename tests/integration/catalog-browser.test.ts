import { describe, expect, it, vi } from 'vitest';
import { evaluateSnapshot, type DecisionEngine, type Snapshot } from '@imicue/core';
import { JEV_MODEL } from '@imicue/server';
import { catalogDefinition } from '../../examples/vanilla/catalog/definition.js';
import { createCatalogBrowserAttemptCap, inspectCatalogBrowserDecision } from '../../scripts/lib/catalog-browser.js';

const now = Date.parse('2026-09-27T00:00:00Z');
function snapshot(topic: 'features' | 'cases' = 'features'): Snapshot {
  return { schemaVersion: '0.1', siteId: catalogDefinition.siteId, definitionVersion: catalogDefinition.definitionVersion,
    snapshotId: 'browser-fixture', revision: 3, pageViewId: 'browser-page', pageId: `catalog-${topic}`, windowMs: 1_800_000,
    observations: ['overview', 'detail'].map(part => ({ signalId: `catalog-${topic}-${part}`, source: 'direct',
      qualifiedViews: 1, visibleMs: 3100, clicks: 0, actions: 0, lastSeenAgoMs: 0 })),
    recent: [], outcomes: [], coverage: { truncated: false } };
}
const engine = (winner: string): DecisionEngine => ({ name: 'jev', version: 'offline-test',
  async evaluate(input) { return { model: JEV_MODEL, assessments: input.candidates.map(({ contentId }) => ({
    contentId, score: contentId === winner ? 0.9 : 0, scoreKind: 'rubric', providerConfidence: 0.8,
    rawScore: { value: contentId === winner ? 2.7 : 0, min: 0, max: 3 },
  })) }; } });

describe('catalog real-browser harness safety helpers, offline only', () => {
  it('caps paid transport at eight attempts per browser and 24 per run, including failed attempts', async () => {
    const cap = createCatalogBrowserAttemptCap();
    const transport = vi.fn(async () => { throw new Error('synthetic-private-error'); });
    for (const name of ['chromium', 'firefox', 'webkit'] as const) {
      const wrapped = cap.wrap(name, transport);
      for (let index = 0; index < 8; index++) await expect(wrapped('https://api.typesafe.ai/v1/systemone')).rejects.toThrow();
      await expect(wrapped('https://api.typesafe.ai/v1/systemone')).rejects.toThrow('catalog_browser_attempt_limit');
      expect(cap.count(name)).toBe(8);
    }
    expect(cap.count()).toBe(24); expect(transport).toHaveBeenCalledTimes(24);
    // A new wrapper for the same browser does not reset its counter.
    await expect(cap.wrap('chromium', transport)('https://api.typesafe.ai/v1/systemone')).rejects.toThrow('catalog_browser_attempt_limit');
  });
  it('does not count or send a pre-aborted browser attempt', async () => {
    const cap = createCatalogBrowserAttemptCap(); const transport = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(cap.wrap('chromium', transport)('https://api.typesafe.ai/v1/systemone', { signal: controller.signal })).rejects.toThrow('catalog_browser_aborted');
    expect(cap.count()).toBe(0); expect(transport).not.toHaveBeenCalled();
  });
  it.each(['features', 'cases'] as const)('validates real-wire-compatible 100 assessments from zero-click %s views', async (topic) => {
    const observed = snapshot(topic);
    const expected = topic === 'cases' ? 'catalog-098' : 'catalog-099';
    const decision = await evaluateSnapshot(catalogDefinition, observed, engine(expected), { now });
    const result = inspectCatalogBrowserDecision(decision, observed, topic, now);
    expect(result).toMatchObject({ valid: true, complete: true, zeroClickBrowsing: true, assessedCount: 100,
      clicks: 0, actions: 0, type: 'recommend', result: expected, semanticMatch: true });
    expect(result).not.toHaveProperty('snapshot'); expect(result).not.toHaveProperty('assessments');
  });
  it('separates contract-valid abstention or wrong-topic output from semantic success', async () => {
    const observed = snapshot();
    const wrong = await evaluateSnapshot(catalogDefinition, observed, engine('catalog-098'), { now });
    expect(inspectCatalogBrowserDecision(wrong, observed, 'features', now)).toMatchObject({ valid: true, semanticMatch: false, result: 'catalog-098' });
    const abstain = await evaluateSnapshot(catalogDefinition, observed, engine('no-match'), { now });
    expect(inspectCatalogBrowserDecision(abstain, observed, 'features', now)).toMatchObject({ valid: true, semanticMatch: false, type: 'abstain', result: 'below_threshold' });
  });
  it('rejects stale, incomplete, clicked or secret-containing raw error responses without retaining them', async () => {
    const observed = snapshot();
    const decision = await evaluateSnapshot(catalogDefinition, observed, engine('catalog-099'), { now });
    const incomplete = { ...decision, assessments: decision.assessments.slice(0, 99) };
    expect(inspectCatalogBrowserDecision(incomplete, observed, 'features', now).valid).toBe(false);
    expect(inspectCatalogBrowserDecision(decision, { ...observed, revision: 4 }, 'features', now).valid).toBe(false);
    const clicked = { ...observed, observations: observed.observations.map(row => ({ ...row, clicks: 1 })) };
    const clickedDecision = await evaluateSnapshot(catalogDefinition, clicked, engine('catalog-099'), { now });
    expect(inspectCatalogBrowserDecision(clickedDecision, clicked, 'features', now).zeroClickBrowsing).toBe(false);
    const redacted = inspectCatalogBrowserDecision({ error: 'synthetic-secret-body', apiKey: 'synthetic-secret-key' }, observed, 'features', now);
    expect(redacted.valid).toBe(false); expect(JSON.stringify(redacted)).not.toContain('synthetic-secret');
  });
});
