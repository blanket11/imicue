/** Bound each probe and the whole launch, including transports that ignore abort. */
export async function waitForWebDriverReady(url: string, options: {
  timeoutMs?: number;
  probeTimeoutMs?: number;
  intervalMs?: number;
  fetch?: typeof globalThis.fetch;
  unavailable?: () => boolean;
} = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  const transport = options.fetch ?? globalThis.fetch;
  do {
    if (options.unavailable?.()) throw new Error('driver_unavailable');
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        transport(url, { signal: controller.signal }).then((response) => {
          void response.body?.cancel().catch(() => undefined);
          return response.ok;
        }, () => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => { controller.abort(); resolve(false); }, Math.min(options.probeTimeoutMs ?? 500, remaining));
        }),
      ]);
      if (options.unavailable?.()) throw new Error('driver_unavailable');
      if (ready && Date.now() < deadline) return;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    const wait = Math.min(options.intervalMs ?? 100, deadline - Date.now());
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  } while (Date.now() < deadline);
  throw new Error('driver_start_timeout');
}
