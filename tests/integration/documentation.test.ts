import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createRulesEngine, validateDefinition, type Snapshot } from '@imicue/core';
import { createRemoteEngine, type RemoteEngine, type RemoteOptions } from '@imicue/browser';
import { createDecisionHandler } from '@imicue/server';

function example(path: string, marker: string): string {
  const document = readFileSync(new URL(`../../docs/guides/${path}`, import.meta.url), 'utf8');
  const block = [...document.matchAll(/```js\n([\s\S]*?)\n```/g)].find((match) => match[1]?.includes(marker));
  if (!block?.[1]) throw new Error(`Missing documented example: ${path} / ${marker}`);
  return block[1];
}

const withoutImports = (source: string): string => source.replace(/^import .*;\n/gm, '');

describe('documented custom-site integration', () => {
  it('uses the same dictionary and permitted origins across the browser and server examples', async () => {
    const dictionarySource = example('integration.md', 'export const definition =');
    const documentedDictionary: unknown = runInNewContext(`${dictionarySource.replace(/^export /gm, '')}\ndefinition;`);
    // Copy the data out of the VM realm before applying the public plain-object validation.
    const definition = validateDefinition(JSON.parse(JSON.stringify(documentedDictionary)) as unknown);
    const pageOrigin = 'http://127.0.0.1:5183';
    let handler: ReturnType<typeof createDecisionHandler> | undefined;
    let listenAddress: { port: number; host: string } | undefined;
    runInNewContext(withoutImports(example('server-and-jev.md', 'const handler = createDecisionHandler')), {
      definition, createRulesEngine, createDecisionHandler,
      // Execute the documented setup while replacing its network listener with a local capture.
      createNodeServer: (documentedHandler: ReturnType<typeof createDecisionHandler>) => {
        handler = documentedHandler;
        return { listen(port: number, host: string, onListen: () => void) {
          listenAddress = { port, host };
          onListen();
        } };
      },
      console: { log() {} },
    });
    expect(listenAddress).toEqual({ port: 5193, host: '127.0.0.1' });
    expect(handler).toBeDefined();
    const statuses: number[] = [];
    const engine = runInNewContext(`${withoutImports(example('server-and-jev.md', 'const engine = createRemoteEngine'))}\nengine;`, {
      createRemoteEngine: (options: RemoteOptions) => createRemoteEngine({
        ...options, baseOrigin: pageOrigin,
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Origin', pageOrigin);
          const response = await handler!(new Request(input, { ...init, headers }));
          statuses.push(response.status);
          return response;
        },
      }),
    }) as RemoteEngine;
    const snapshot: Snapshot = {
      schemaVersion: '0.1', siteId: definition.siteId, definitionVersion: definition.definitionVersion,
      snapshotId: 'documented-snapshot', revision: 1, pageViewId: 'documented-page', pageId: 'home', windowMs: 1_800_000,
      observations: [{ signalId: 'board-example-opened', source: 'direct', qualifiedViews: 0,
        visibleMs: 0, clicks: 0, actions: 1, lastSeenAgoMs: 0 }],
      recent: [], outcomes: [], coverage: { truncated: false },
    };
    const decision = await engine.evaluate(snapshot, { definition, signal: new AbortController().signal });
    expect(statuses).toEqual([200]);
    expect(decision).toMatchObject({ type: 'recommend', contentId: 'product-features', engine: { name: 'rules' } });
  });
});
