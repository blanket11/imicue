import { describe, expect, it, vi } from 'vitest';
import { waitForWebDriverReady } from '../../scripts/lib/webdriver-ready.js';

describe('Safari driver readiness deadline', () => {
  it('retries a failed status and accepts a ready driver', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await waitForWebDriverReady('http://driver.test/status', { fetch: transport, intervalMs: 1 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('bounds an unresponsive transport even when it ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const transport = vi.fn<typeof fetch>(async (_url, init) => {
        signals.push(init!.signal!);
        return new Promise<Response>(() => undefined);
      });
      const before = Date.now();
      const failed = expect(waitForWebDriverReady('http://driver.test/status', {
        fetch: transport, timeoutMs: 60, probeTimeoutMs: 10, intervalMs: 1,
      })).rejects.toThrow('driver_start_timeout');
      await vi.advanceTimersByTimeAsync(60);
      await failed;
      expect(Date.now() - before).toBe(60);
      expect(transport.mock.calls.length).toBeGreaterThan(1);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('rejects a driver that exits while a status probe is pending', async () => {
    let exited = false;
    const transport = vi.fn<typeof fetch>(async () => {
      exited = true;
      return new Response('{}');
    });
    await expect(waitForWebDriverReady('http://driver.test/status', {
      fetch: transport, unavailable: () => exited,
    })).rejects.toThrow('driver_unavailable');
  });
});
