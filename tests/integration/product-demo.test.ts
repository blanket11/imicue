import { describe, expect, it } from 'vitest';
import { createRulesEngine, evaluateSnapshot, validateDefinition, type Snapshot } from '@imicue/core';
import { productDefinition as definition } from '../../examples/product/definition.js';
function snapshot(ids: string[]): Snapshot {
  return { schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion, snapshotId: 'product-snapshot', revision: 1, pageViewId: 'home-view', pageId: 'home', windowMs: 1800000,
    observations: ids.map((signalId) => ({ signalId, source: 'direct', qualifiedViews: 1, visibleMs: 30000, clicks: 0, actions: 0, lastSeenAgoMs: 0 })), recent: [], outcomes: [], coverage: { truncated: false } };
}
const decide = (value: Snapshot) => evaluateSnapshot(definition, value, createRulesEngine(), { now: 0 });
describe('fictional product demo dictionary', () => {
  it('validates the same dictionary used by the client and local server', () => { expect(validateDefinition(definition)).toEqual(definition); });
  it.each([
    [['feature-board', 'feature-timeline'], 'product-features'],
    [['case-creative', 'case-operations'], 'product-cases'],
    [['pricing', 'security'], 'product-documents'],
    [['faq-migration', 'rollout'], 'product-contact'],
  ])('recommends from real view aggregates %j, with no click or action', async (ids, contentId) => {
    expect(await decide(snapshot(ids))).toMatchObject({ type: 'recommend', contentId });
  });
  it('does not turn a pricing view into a contact recommendation', async () => {
    expect(await decide(snapshot(['pricing']))).toMatchObject({ type: 'abstain', reason: 'insufficient_evidence' });
    const result = await decide(snapshot(['pricing', 'overview']));
    expect(result).toMatchObject({ type: 'recommend', contentId: 'product-documents' });
    expect(result.assessments.find((row) => row.contentId === 'product-contact')?.score).toBe(0);
  });
  it('abstains with weak, ambiguous and recommendation-derived evidence', async () => {
    const value = snapshot(['feature-board', 'case-creative']);
    expect(await decide(value)).toMatchObject({ type: 'abstain', reason: 'ambiguous' });
    expect(await decide({ ...value, observations: value.observations.map((row) => ({ ...row, visibleMs: 2000 })) })).toMatchObject({ type: 'abstain' });
    expect(await decide({ ...value, observations: value.observations.map((row) => ({ ...row, source: 'recommendation' })) })).toMatchObject({ type: 'abstain' });
  });
  it('excludes current, viewed and completed destinations', async () => {
    const value = snapshot(['feature-board', 'feature-timeline']);
    for (const input of [{ ...value, pageId: 'features' }, snapshot(['feature-board', 'feature-timeline', 'features-detail']), { ...value, outcomes: [{ contentId: 'product-features', kind: 'completed' as const, ageMs: 0 }] }]) {
      const result = await decide(input);
      expect(result.assessments.some((row) => row.contentId === 'product-features')).toBe(false);
      expect(result.type).toBe('abstain');
    }
  });
});
