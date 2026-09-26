import type { ResolvedEvaluationInput } from '@imicue/core';

export type InputVariant = 'dictionary-ja' | 'dictionary-en' | 'labels';
// Synthetic fixture translations only. Production dictionaries are never rewritten.
const english: Record<string, string> = {
  features: 'An introduction to the features of the fictional product DemoContract.',
  pricing: 'An introduction to the pricing of DemoContract.',
  cases: 'An introduction to use cases for DemoContract.',
  'feature-guide': 'The body of the DemoContract feature guide.',
  action: 'An explicit interaction with a registered feature.',
  foreign: 'An introduction to the features of a different fictional product.',
};
const englishCandidates: Record<string, string> = {
  'feature-guide': 'A detailed explanation of DemoContract features.',
  'pricing-guide': 'A detailed explanation of DemoContract pricing.',
  'case-guide': 'A detailed explanation of DemoContract use cases.',
};
const englishTopics: Record<string, string> = {
  features: 'Features of the fictional product DemoContract.',
  pricing: 'Pricing of the fictional product DemoContract.',
  cases: 'Use cases for the fictional product DemoContract.',
};
function translated(table: Record<string, string>, id: string): string {
  if (!Object.hasOwn(table, id)) throw new Error('missing_fixture_translation');
  return table[id]!;
}
export function evaluationInput(input: ResolvedEvaluationInput, variant: InputVariant): ResolvedEvaluationInput {
  if (variant === 'dictionary-ja') return input;
  return {
    ...input,
    observations: input.observations.map((row) => ({ ...row, definition: { ...row.definition,
      modelDescription: variant === 'labels' ? row.definition.label ?? row.signalId : translated(english, row.signalId),
    } })),
    candidates: input.candidates.map((row) => ({ ...row,
      modelDescription: variant === 'labels' ? row.title : translated(englishCandidates, row.contentId),
    })),
    topics: Object.fromEntries(Object.entries(input.topics ?? {}).map(([id, row]) => [id, { ...row,
      modelDescription: variant === 'labels' ? id : translated(englishTopics, id),
    }])),
  };
}
