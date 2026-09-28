import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep existing bookmarks on one origin, including its sessionStorage.
export function createDemoRedirect() {
  return createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const query = new URL(request.url ?? '/', 'http://127.0.0.1').search;
    response.writeHead(307, {
      Location: `http://127.0.0.1:5183${path}${query}`,
      'Cache-Control': 'no-store',
    }).end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const redirect = createDemoRedirect();
  let child;
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    redirect.close();
    redirect.closeAllConnections();
    child?.kill('SIGTERM');
  };
  redirect.on('error', () => {
    console.error('5186番を使用中です。以前のデモを停止してから npm run dev を実行してください。');
    stop(1);
  });
  redirect.listen(5186, '127.0.0.1', () => {
    console.log('PACELET: http://127.0.0.1:5183/ (5186番からも転送します)');
    child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('next/dist/bin/next')), 'dev',
      '--hostname', '127.0.0.1', '--port', '5183'], {
      cwd: fileURLToPath(new URL('../examples/next-static/', import.meta.url)),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit',
    });
    child.on('error', () => { console.error('PACELETの起動に失敗しました。'); stop(1); });
    child.on('exit', (code) => stop(code ?? 1));
  });
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}
