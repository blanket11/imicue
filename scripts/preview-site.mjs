import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { readSiteHeaders } from './lib/site-headers.mjs';

const { values } = parseArgs({ options: { port: { type: 'string', default: '5187' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
const root = await realpath('dist/site');
const headers = await readSiteHeaders(resolve(root, '_headers'));
const notFound = await readFile(resolve(root, '404.html'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Serve the built site's headers and 404 locally; Cloudflare routing/caching remains a live check.
const server = createServer(async (request, response) => {
  const send = (status, body, contentType) => {
    response.writeHead(status, { ...headers, 'Content-Type': contentType, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  try {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      send(405, Buffer.from('Method not allowed'), 'text/plain; charset=utf-8'); return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (pathname.split('/').some((part) => part.startsWith('.') || part.startsWith('_'))) throw new Error('private_path');
    let file = resolve(root, `.${pathname}`);
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    file = await realpath(file);
    if (!file.startsWith(root + sep) || !Object.hasOwn(mime, extname(file))) throw new Error('invalid_asset');
    send(200, await readFile(file), mime[extname(file)]);
  } catch { send(404, notFound, mime['.html']); }
});
server.on('error', () => { console.error(`Site preview could not start on port ${port}.`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Site preview with deployment headers: http://127.0.0.1:${port}/`));
