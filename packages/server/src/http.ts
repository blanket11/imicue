import { evaluateSnapshot, validateDefinition, validateSnapshot, type Definition, type DecisionEngine } from '@imicue/core';
import { createMemoryLimiter, type UsageLimiter } from './limiter.js';

class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterMs?: number) { super(code); }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new HttpFailure(504, 'engine_unavailable'));
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function readBody(request: Request, signal: AbortSignal): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 32 * 1024)) throw new HttpFailure(413, 'capacity_limit');
  if (!request.body) throw new HttpFailure(400, 'invalid_snapshot');
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024) throw new HttpFailure(413, 'capacity_limit');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(400, 'invalid_snapshot');
  } finally { reader.releaseLock(); }
}

export interface HandlerOptions {
  definitions: readonly Definition[];
  engine: DecisionEngine;
  origins: readonly string[];
  allowedContentOrigins?: readonly string[];
  mode: 'development' | 'production';
  limiter?: UsageLimiter;
  timeoutMs?: number;
  now?: () => number;
}

export function createDecisionHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  if (!['development', 'production'].includes(options.mode)) throw new Error('explicit_mode_required');
  const limiter = options.limiter ?? createMemoryLimiter();
  if ((options.mode === 'production' || process.env.NODE_ENV === 'production') && !limiter.shared) throw new Error('shared_limiter_required');
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_000) throw new Error('invalid_timeout');
  const origins = new Set(options.origins.map((origin) => {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !(options.mode === 'development' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('invalid_origin');
    return origin;
  }));
  const definitions = new Map<string, Definition>();
  for (const raw of options.definitions) {
    const definition = validateDefinition(raw, { allowedOrigins: options.allowedContentOrigins });
    const key = JSON.stringify([definition.siteId, definition.definitionVersion]);
    if (definitions.has(key)) throw new Error('duplicate_definition');
    definitions.set(key, definition);
  }
  return async (request) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin', 'Content-Type': 'application/json' });
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/v1/decide' || url.search) throw new HttpFailure(404, 'not_found');
      const origin = request.headers.get('origin');
      if (!origin || !origins.has(origin)) throw new HttpFailure(403, 'origin_denied');
      headers.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('access-control-request-method') !== 'POST'
          || (request.headers.get('access-control-request-headers') ?? '').split(',').some((item) => item.trim() && item.trim().toLowerCase() !== 'content-type')) throw new HttpFailure(403, 'origin_denied');
        headers.set('Access-Control-Allow-Methods', 'POST');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'POST') throw new HttpFailure(405, 'method_not_allowed');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
        || request.headers.has('content-encoding')) throw new HttpFailure(415, 'unsupported_media_type');
      const raw = await readBody(request, controller.signal);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpFailure(400, 'invalid_snapshot');
      const data = raw as Record<string, unknown>;
      const fields = ['schemaVersion', 'siteId', 'definitionVersion', 'snapshotId', 'revision', 'pageViewId', 'pageId', 'windowMs', 'observations', 'recent', 'outcomes', 'coverage'];
      if (Object.keys(data).some((key) => !fields.includes(key)) || data.schemaVersion !== '0.1'
        || typeof data.siteId !== 'string' || typeof data.definitionVersion !== 'string') throw new HttpFailure(400, 'invalid_snapshot');
      const definition = definitions.get(JSON.stringify([data.siteId, data.definitionVersion]));
      if (!definition) throw new HttpFailure(409, 'definition_mismatch');
      let snapshot;
      try { snapshot = validateSnapshot(data, definition); } catch { throw new HttpFailure(400, 'invalid_snapshot'); }
      let limitFailure: HttpFailure | undefined;
      const engine: DecisionEngine = { name: options.engine.name, version: options.engine.version,
        async evaluate(input, evaluation) {
          const reservation = await limiter.acquire();
          if (!reservation.ok) {
            limitFailure = new HttpFailure(429, 'rate_limited', reservation.retryAfterMs);
            throw limitFailure;
          }
          // Keep concurrency reserved until the actual work settles, even if a caller times out.
          try {
            if (evaluation.signal.aborted) throw new Error('aborted');
            return await options.engine.evaluate(input, evaluation);
          } finally { reservation.release(); }
        },
      };
      const decision = await abortable(evaluateSnapshot(definition, snapshot, engine, {
        now: options.now?.() ?? Date.now(), signal: controller.signal,
      }), controller.signal);
      if (limitFailure) throw limitFailure;
      if (decision.type === 'abstain' && decision.reason === 'engine_unavailable') throw new HttpFailure(503, 'engine_unavailable');
      return reply(200, decision);
    } catch (error) {
      const failure = error instanceof HttpFailure ? error : new HttpFailure(503, 'engine_unavailable');
      if (failure.retryAfterMs !== undefined) headers.set('Retry-After', String(Math.max(1, Math.ceil(failure.retryAfterMs / 1_000))));
      return reply(failure.status, { error: { code: failure.code } });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  };
}
