import { observation, snapshot } from '../../packages/core/test/fixtures.js';

// Authored before the first live v2 run. These are regression expectations, not human labels.
export const freshnessScenarios = [
  { id: 'old-single-theme', split: 'freshness', input: snapshot({ observations: [observation('features', { lastSeenAgoMs: 600_000 })] }), expected: 'insufficient_evidence' },
  { id: 'at-five-minutes', split: 'freshness', input: snapshot({ observations: [observation('features', { lastSeenAgoMs: 300_000 })] }), expected: 'feature-guide' },
  { id: 'past-five-minutes', split: 'freshness', input: snapshot({ observations: [observation('features', { lastSeenAgoMs: 300_001 })] }), expected: 'insufficient_evidence' },
  { id: 'features-to-cases', split: 'freshness', input: snapshot({ observations: [observation('features', { lastSeenAgoMs: 600_000 }), observation('cases')] }), expected: 'case-guide' },
  { id: 'pricing-to-features', split: 'freshness', input: snapshot({ observations: [observation('pricing', { lastSeenAgoMs: 600_000 }), observation()] }), expected: 'feature-guide' },
  { id: 'old-view-still-excluded', split: 'freshness', input: snapshot({ observations: [observation(), observation('feature-guide', { lastSeenAgoMs: 600_000 })] }), expected: 'below_threshold' },
  { id: 'old-action-new-single-view', split: 'freshness', input: snapshot({ observations: [observation('features', { qualifiedViews: 1 }), observation('pricing', { clicks: 1, lastSeenAgoMs: 600_000 })] }), expected: 'insufficient_evidence' },
] as const;
