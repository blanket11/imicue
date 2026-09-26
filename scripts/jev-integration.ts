import { evaluateSnapshot } from '@imicue/core';
import { createJevEngine, JEV_MODEL } from '@imicue/server';
import { definition, snapshot, NOW } from '../packages/core/test/fixtures.js';

if (process.env.RUN_JEV_INTEGRATION !== '1') {
  console.log('SKIP: 実API試験は未実施です。明示的な許可後にRUN_JEV_INTEGRATION=1を指定してください。');
} else if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.log('SKIP: ローカルのTYPESAFE_API_KEYが未設定です。');
} else {
  const requested = Number(process.env.JEV_INTEGRATION_REQUESTS ?? '1');
  if (!Number.isInteger(requested) || requested < 1 || requested > 5) throw new Error('Request count must be between 1 and 5.');
  const engine = createJevEngine({ model: JEV_MODEL });
  for (let index = 0; index < requested; index++) {
    const result = await evaluateSnapshot(definition(), snapshot(), engine, { now: NOW });
    console.log(JSON.stringify({ request: index + 1, type: result.type, model: result.engine.model,
      ...(result.type === 'abstain' ? { reason: result.reason } : { contentId: result.contentId }) }));
    if (result.type === 'abstain' && ['engine_unavailable', 'invalid_result'].includes(result.reason)) { process.exitCode = 1; break; }
  }
}
