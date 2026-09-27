import { EngineFailure, type DecisionEngine } from '@imicue/core';

export type ProviderAttemptReservation = { ok: true; release: () => void | Promise<void> } | { ok: false; retryAfterMs: number };

export interface ProviderPlan {
  /** Atomically charge one reserved attempt and acquire its concurrency slot. */
  acquireAttempt(): ProviderAttemptReservation | Promise<ProviderAttemptReservation>;
  /** Refund only attempts that were never started. Running attempts release their own slots. */
  release(): void | Promise<void>;
}
export type ProviderPlanReservation = { ok: true; plan: ProviderPlan } | { ok: false; retryAfterMs: number };

/** Production implementations atomically share pending plans, rolling quotas and active attempts across workers. */
export interface ProviderUsageLimiter {
  readonly shared: boolean;
  readonly concurrent: number;
  reservePlan(attempts: number): ProviderPlanReservation | Promise<ProviderPlanReservation>;
}

export class ProviderLimitFailure extends EngineFailure {
  constructor(readonly retryAfterMs: number) { super('engine_unavailable'); }
}

const registered = new WeakMap<DecisionEngine, ProviderUsageLimiter>();
/** Server-internal registration, deliberately not exported from the package entrypoint. */
export function registerProviderEngine(engine: DecisionEngine, limiter: ProviderUsageLimiter): void { registered.set(engine, limiter); }
export function assertSharedProviderEngine(engine: DecisionEngine): void {
  if (engine.name === 'jev' && !registered.get(engine)?.shared) throw new Error('shared_provider_limiter_required');
}

export function createMemoryProviderLimiter(options: { concurrent?: number; perMinute?: number; perDay?: number; now?: () => number } = {}): ProviderUsageLimiter {
  const concurrent = options.concurrent ?? 2;
  const perMinute = options.perMinute ?? 30;
  const perDay = options.perDay ?? 100;
  const now = options.now ?? (() => performance.now());
  for (const limit of [concurrent, perMinute, perDay]) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_limit');
  if (concurrent > 2) throw new Error('invalid_provider_concurrency');
  let active = 0;
  let pending = 0;
  let history: number[] = [];
  let last = -Infinity;
  const time = (): number | undefined => {
    const value = now();
    if (!Number.isFinite(value) || value < last) return undefined;
    last = value;
    history = history.filter((at) => value - at < 86_400_000);
    return value;
  };
  return {
    shared: false, concurrent,
    reservePlan(attempts) {
      if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 8) throw new Error('invalid_plan');
      const at = time();
      if (at === undefined) return { ok: false, retryAfterMs: 86_400_000 };
      const minute = history.filter((entry) => at - entry < 60_000);
      if (minute.length + pending + attempts > perMinute || history.length + pending + attempts > perDay) {
        return { ok: false, retryAfterMs: history.length + pending + attempts > perDay ? 86_400_000 : 60_000 };
      }
      pending += attempts;
      let remaining = attempts;
      let closed = false;
      return { ok: true, plan: {
        acquireAttempt() {
          if (closed || remaining === 0) return { ok: false, retryAfterMs: 1_000 };
          const startedAt = time();
          if (startedAt === undefined) return { ok: false, retryAfterMs: 86_400_000 };
          if (active >= concurrent) return { ok: false, retryAfterMs: 1_000 };
          remaining--; pending--; active++; history.push(startedAt);
          let released = false;
          return { ok: true, release() { if (!released) { released = true; active--; } } };
        },
        release() {
          if (closed) return;
          closed = true;
          pending -= remaining;
          remaining = 0;
        },
      } };
    },
  };
}
