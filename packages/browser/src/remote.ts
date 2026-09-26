import { EngineFailure, preflightReason, technicalDecision, validateDecision, type Decision, type Definition, type Snapshot } from '@imicue/core';

export interface RemoteDiagnostic { readonly code: 'http_error' | 'remote_invalid' | 'remote_timeout'; readonly status?: number }
export interface RemoteEngine {
  readonly kind: 'remote';
  evaluate(snapshot: Snapshot, options: { definition: Definition; signal: AbortSignal; now?: number }): Promise<Decision>;
}
export interface RemoteOptions {
  endpoint: string;
  baseOrigin?: string;
  allowedOrigins?: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  onDiagnostic?: (diagnostic: RemoteDiagnostic) => void;
}

export function createRemoteEngine(options: RemoteOptions): RemoteEngine {
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_000) throw new Error('invalid_timeout');
  let terminal: 'definition_mismatch' | 'capacity_limit' | 'invalid_result' | undefined;
  let retryAt = 0;
  const now = options.now ?? (() => Date.now());
  const diagnose = (event: RemoteDiagnostic) => { try { options.onDiagnostic?.(Object.freeze(event)); } catch { /* Site callbacks cannot break transport. */ } };
  return {
    kind: 'remote',
    async evaluate(snapshot, evaluation) {
      const abstain = (reason: Parameters<typeof technicalDecision>[1]) => technicalDecision(snapshot, reason);
      if (evaluation.signal.aborted) return abstain('engine_unavailable');
      const early = preflightReason(evaluation.definition, snapshot, evaluation.now);
      if (early) return abstain(early);
      if (terminal) return abstain(terminal);
      if (now() < retryAt) return abstain('engine_unavailable');
      const baseOrigin = options.baseOrigin ?? (typeof location === 'undefined' ? undefined : location.origin);
      let endpoint: URL;
      try {
        endpoint = new URL(options.endpoint, baseOrigin);
        if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
          || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))
          || (endpoint.origin !== baseOrigin && !options.allowedOrigins?.includes(endpoint.origin))) throw new Error('invalid_endpoint');
      } catch { diagnose({ code: 'remote_invalid' }); return abstain('invalid_result'); }
      const body = JSON.stringify(snapshot);
      if (new TextEncoder().encode(body).byteLength > 32 * 1024) return abstain('capacity_limit');
      const controller = new AbortController();
      const abort = () => controller.abort();
      evaluation.signal.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let responseBody: ReadableStream<Uint8Array> | null | undefined;
      const cancel = () => { void (reader ? reader.cancel() : responseBody?.cancel())?.catch(() => undefined); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      let rejectAbort: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new Error('aborted'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      try {
        const work = async () => {
          const response = await (options.fetch ?? globalThis.fetch)(endpoint.href, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
          }).catch(() => { throw new EngineFailure('engine_unavailable'); });
          responseBody = response.body;
          if (controller.signal.aborted) { cancel(); throw new Error('aborted'); }
          if (!response.ok) {
            diagnose({ code: 'http_error', status: response.status });
            cancel();
            if ([400, 409, 413].includes(response.status)) terminal = response.status === 409 ? 'definition_mismatch' : response.status === 413 ? 'capacity_limit' : 'invalid_result';
            if (response.status === 429) {
              const header = response.headers.get('retry-after') ?? '';
              const milliseconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now();
              retryAt = now() + (Number.isFinite(milliseconds) ? Math.max(15_000, milliseconds) : 15_000);
            }
            return abstain(terminal ?? 'engine_unavailable');
          }
          if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('invalid_response');
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > 32 * 1024)) throw new Error('invalid_response');
          reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let text = '';
          let bytes = 0;
          while (true) {
            const chunk = await reader.read().catch(() => { throw new EngineFailure('engine_unavailable'); });
            if (controller.signal.aborted) throw new Error('aborted');
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 32 * 1024) throw new Error('invalid_response');
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
          return validateDecision(JSON.parse(text), evaluation.definition, snapshot, evaluation.now);
        };
        return await Promise.race([work(), abortPromise]);
      } catch (error) {
        const unavailable = error instanceof EngineFailure && error.reason === 'engine_unavailable';
        if (!controller.signal.aborted) diagnose({ code: unavailable ? 'http_error' : 'remote_invalid' });
        else if (timedOut) diagnose({ code: 'remote_timeout' });
        cancel();
        return abstain(controller.signal.aborted || unavailable ? 'engine_unavailable' : 'invalid_result');
      } finally {
        clearTimeout(timer);
        evaluation.signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', cancel);
        if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
      }
    },
  };
}
