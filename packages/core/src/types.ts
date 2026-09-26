export type Id = string;
export type Source = 'direct' | 'recommendation';
export type EventKind = 'qualified-view' | 'click' | 'action';
export type OutcomeKind = 'shown' | 'clicked' | 'dismissed' | 'completed';

export interface Meaning {
  readonly label?: string;
  readonly description: string;
  readonly modelDescription?: string;
}

export interface SignalDefinition extends Meaning {
  readonly kind: 'content' | 'action';
  readonly productId?: Id;
  readonly topicIds?: readonly Id[];
  readonly contentId?: Id;
}

export interface ContentDefinition extends Meaning {
  readonly title: string;
  readonly href: string;
  readonly productId?: Id;
  readonly topicIds?: readonly Id[];
  readonly relatedSignalIds?: readonly Id[];
  readonly enabled: boolean;
  readonly availableFrom?: string;
  readonly availableUntil?: string;
}

export interface PageDefinition {
  readonly productId?: Id;
  readonly contentId?: Id;
}

export interface Definition {
  readonly schemaVersion: '0.1';
  readonly siteId: Id;
  readonly definitionVersion: string;
  readonly topics?: Readonly<Record<Id, Meaning>>;
  readonly signals: Readonly<Record<Id, SignalDefinition>>;
  readonly contents: Readonly<Record<Id, ContentDefinition>>;
  readonly pages: Readonly<Record<Id, PageDefinition>>;
}

export interface SignalObservation {
  readonly signalId: Id;
  readonly source: Source;
  readonly qualifiedViews: number;
  readonly visibleMs: number;
  readonly clicks: number;
  readonly actions: number;
  readonly lastSeenAgoMs: number;
}

export interface RecentEvent {
  readonly signalId: Id;
  readonly source: Source;
  readonly kind: EventKind;
  readonly ageMs: number;
}

export interface ContentOutcome {
  readonly contentId: Id;
  readonly kind: OutcomeKind;
  readonly ageMs: number;
}

export interface Snapshot {
  readonly schemaVersion: '0.1';
  readonly siteId: Id;
  readonly definitionVersion: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly pageViewId: string;
  readonly pageId: Id;
  readonly windowMs: number;
  readonly observations: readonly SignalObservation[];
  readonly recent: readonly RecentEvent[];
  readonly outcomes: readonly ContentOutcome[];
  readonly coverage: { readonly truncated: boolean };
}

export interface CandidateAssessment {
  readonly contentId: Id;
  readonly score: number;
  readonly scoreKind: 'heuristic' | 'rubric';
  readonly rawScore?: { readonly value: number; readonly min: number; readonly max: number };
  readonly providerConfidence?: number;
}

export interface EngineInfo {
  readonly name: 'rules' | 'jev';
  readonly version: string;
  readonly model?: string;
}

export type AbstainReason =
  | 'insufficient_evidence' | 'no_eligible_content' | 'below_threshold'
  | 'ambiguous' | 'suppressed' | 'capacity_limit' | 'definition_mismatch'
  | 'engine_unavailable' | 'invalid_result';

export interface DecisionBase {
  readonly schemaVersion: '0.1';
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly pageViewId: string;
  readonly definitionVersion: string;
  readonly policyVersion: string;
  readonly engine: EngineInfo;
  readonly assessments: readonly CandidateAssessment[];
  readonly maxAgeMs: number;
}

export type Decision = DecisionBase & (
  | { readonly type: 'recommend'; readonly contentId: Id }
  | { readonly type: 'abstain'; readonly reason: AbstainReason }
);

export interface ResolvedEvaluationInput {
  readonly topics?: Readonly<Record<Id, Meaning>>;
  readonly snapshot: Snapshot;
  readonly page: PageDefinition;
  readonly observations: readonly (SignalObservation & { readonly definition: SignalDefinition })[];
  readonly candidates: readonly (ContentDefinition & { readonly contentId: Id })[];
}

export class EngineFailure extends Error {
  constructor(readonly reason: 'capacity_limit' | 'invalid_result' | 'engine_unavailable') {
    super(reason);
    this.name = 'EngineFailure';
  }
}

export interface DecisionEngine {
  readonly name: 'rules' | 'jev';
  readonly version: string;
  evaluate(input: ResolvedEvaluationInput, options: { signal: AbortSignal }): Promise<{
    assessments: readonly CandidateAssessment[];
    model?: string;
  }>;
}
