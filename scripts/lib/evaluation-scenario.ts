import type { Definition, Snapshot } from '@imicue/core';

export interface EvaluationScenario {
  readonly id: string;
  readonly split: string;
  readonly input: Snapshot;
  readonly expected: string;
  readonly expiresFeature?: boolean;
  readonly source?: Definition;
  readonly review?: {
    readonly title: string;
    readonly situation: string;
    readonly proposal: string;
    readonly acceptable: readonly string[]; // Content IDs or "abstain"; never a human label until reviewed.
  };
}
