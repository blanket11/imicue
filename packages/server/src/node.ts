import { createServer, type Server } from 'node:http';

/** Host is fixed by the server; incoming Host headers never control an outbound URL. */
export function createNodeServer(handler: (request: Request) => Promise<Response>): Server {
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => { if (!outgoing.writableFinished) controller.abort(); });
    try {
      const method = incoming.method ?? 'GET';
      const body = ['GET', 'HEAD'].includes(method) ? undefined : new ReadableStream<Uint8Array>({
        start(stream) {
          incoming.pause();
          incoming.on('data', (chunk: Buffer) => { stream.enqueue(chunk); incoming.pause(); });
          incoming.once('end', () => stream.close());
          incoming.once('error', () => stream.error(new Error('invalid_request')));
        },
        pull() { incoming.resume(); },
        cancel() { incoming.pause(); incoming.removeAllListeners('data'); incoming.removeAllListeners('end'); },
      });
      const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), {
        method, headers: new Headers(Object.entries(incoming.headers).flatMap(([key, value]) =>
          value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((item): [string, string] => [key, item]))),
        signal: controller.signal,
        ...(body ? { body, duplex: 'half' } : {}),
      } as RequestInit);
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      if (!incoming.complete) { outgoing.once('finish', () => incoming.destroy()); incoming.resume(); }
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end('{"error":{"code":"invalid_request"}}');
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  return server;
}
