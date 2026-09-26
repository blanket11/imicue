import { copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

for (const name of ['core', 'browser', 'server']) {
  const directory = `packages/${name}`;
  await rm(`${directory}/dist`, { recursive: true, force: true });
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', `${directory}/tsconfig.build.json`], { stdio: 'inherit' });
  await copyFile('LICENSE', `${directory}/dist/LICENSE`);
}
