import type { ResolvedEvaluationInput } from '@imicue/core';

export type InputVariant = 'dictionary-ja' | 'dictionary-en' | 'labels';
// Synthetic fixture translations only. Production dictionaries are never rewritten.
const english: Record<string, string> = {
  features: 'An introduction to searching books and reading notes in a fictional reading-log app.',
  pricing: 'An introduction to fictional plans for saving reading records.',
  cases: 'An introduction to organizing books and reading records.',
  'feature-guide': 'The body of a reading-note search guide.',
  action: 'An explicit interaction with a registered feature.',
  foreign: 'An introduction to the features of a different fictional product.',
};
const englishCandidates: Record<string, string> = {
  'feature-guide': 'A detailed explanation of searching reading notes.',
  'pricing-guide': 'A detailed explanation of fictional reading-log plans.',
  'case-guide': 'A detailed explanation of organizing reading records.',
};
const englishTopics: Record<string, string> = {
  features: 'Search features of a fictional reading-log app.',
  pricing: 'Fictional plans for saving reading records.',
  cases: 'Ways to organize books and reading records.',
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
