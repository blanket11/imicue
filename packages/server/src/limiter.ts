export type Reservation = { ok: true; release: () => void } | { ok: false; retryAfterMs: number };
/** A production implementation must atomically share all counters across workers. */
export interface UsageLimiter {
  readonly shared: boolean;
  acquire(): Reservation | Promise<Reservation>;
}

export function createMemoryLimiter(options: { concurrent?: number; perMinute?: number; perDay?: number; now?: () => number } = {}): UsageLimiter {
  const concurrent = options.concurrent ?? 2;
  const perMinute = options.perMinute ?? 30;
  const perDay = options.perDay ?? 100;
  const now = options.now ?? (() => performance.now());
  for (const limit of [concurrent, perMinute, perDay]) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_limit');
  let active = 0;
  let history: number[] = [];
  let last = -Infinity;
  return {
    shared: false,
    acquire() {
      const time = now();
      if (!Number.isFinite(time) || time < last) return { ok: false, retryAfterMs: 86_400_000 };
      last = time;
      history = history.filter((at) => time - at < 86_400_000);
      const minute = history.filter((at) => time - at < 60_000);
      const waits = [active >= concurrent ? 1_000 : 0,
        minute.length >= perMinute ? minute[0]! + 60_000 - time : 0,
        history.length >= perDay ? history[0]! + 86_400_000 - time : 0];
      const retryAfterMs = Math.max(...waits);
      if (retryAfterMs > 0) return { ok: false, retryAfterMs };
      active++;
      history.push(time);
      let released = false;
      return { ok: true, release() { if (!released) { released = true; active--; } } };
    },
  };
}
