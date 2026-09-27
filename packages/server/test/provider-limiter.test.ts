import { describe, expect, it } from 'vitest';
import { createMemoryProviderLimiter } from '../src/index.js';

describe('provider quota reservations and actual-attempt concurrency', () => {
  it('atomically reserves complete plans across competing evaluations and refunds only unsent quota', async () => {
    const limiter = createMemoryProviderLimiter({ perMinute: 5, perDay: 5 });
    const [first, second] = await Promise.all([limiter.reservePlan(3), limiter.reservePlan(3)]);
    expect(first.ok).toBe(true); expect(second.ok).toBe(false);
    if (!first.ok) throw new Error('fixture');
    const attempt = await first.plan.acquireAttempt();
    expect(attempt.ok).toBe(true);
    first.plan.release(); first.plan.release();
    // One actual attempt remains charged and running; only the two unused permits were returned.
    const remaining = await limiter.reservePlan(4);
    expect(remaining.ok).toBe(true);
    expect((await limiter.reservePlan(1)).ok).toBe(false);
    if (attempt.ok) attempt.release();
    if (remaining.ok) remaining.plan.release();
    expect((await limiter.reservePlan(5)).ok).toBe(false);
    expect((await first.plan.acquireAttempt()).ok).toBe(false);
  });
  it('holds active slots after closing a plan until each local attempt settles', async () => {
    const limiter = createMemoryProviderLimiter({ concurrent: 1 });
    const first = await limiter.reservePlan(2);
    if (!first.ok) throw new Error('fixture');
    const running = await first.plan.acquireAttempt();
    first.plan.release();
    const second = await limiter.reservePlan(1);
    if (!second.ok) throw new Error('fixture');
    expect((await second.plan.acquireAttempt()).ok).toBe(false);
    if (running.ok) { running.release(); running.release(); }
    expect((await second.plan.acquireAttempt()).ok).toBe(true);
  });
  it('charges attempts across rolling windows, including failures, and rejects a backwards clock', async () => {
    let time = 0;
    const limiter = createMemoryProviderLimiter({ perMinute: 1, perDay: 2, now: () => time });
    const spend = async () => {
      const reservation = await limiter.reservePlan(1);
      if (!reservation.ok) return false;
      const attempt = await reservation.plan.acquireAttempt();
      if (attempt.ok) attempt.release();
      reservation.plan.release(); return attempt.ok;
    };
    expect(await spend()).toBe(true); expect(await spend()).toBe(false);
    time = 60_000; expect(await spend()).toBe(true);
    time = 120_000; expect(await spend()).toBe(false);
    time = 86_400_000; expect(await spend()).toBe(true);
    time = 86_399_999; expect(await spend()).toBe(false);
  });
  it('rejects invalid plans and concurrency configuration', () => {
    const limiter = createMemoryProviderLimiter();
    for (const count of [0, 9, -1, 1.5, NaN]) expect(() => limiter.reservePlan(count)).toThrow('invalid_plan');
    expect(() => createMemoryProviderLimiter({ concurrent: 3 })).toThrow('invalid_provider_concurrency');
  });
});
