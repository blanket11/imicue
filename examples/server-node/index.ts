import { createRulesEngine, type DecisionEngine } from '@imicue/core';
import { createDecisionHandler, createJevEngine, createNodeServer, JEV_MODEL } from '@imicue/server';
import { definition } from '../vanilla/definition.js';

// Mock mode remains the default even if a real key happens to be in the environment.
const mode = process.argv.includes('--jev') ? 'jev' : 'mock';
if (mode === 'jev' && process.env.RUN_JEV_SERVER !== '1') throw new Error('Set RUN_JEV_SERVER=1 only after explicit authorization.');
const rules = createRulesEngine();
const mock: DecisionEngine = {
  name: 'jev', version: 'mock-v1',
  async evaluate(input, options) {
    const result = await rules.evaluate(input, options);
    return { model: 'mock-local-v1', assessments: result.assessments.map((assessment) => ({
      contentId: assessment.contentId, score: Math.min(1, assessment.score * 1.5), scoreKind: 'rubric',
      rawScore: { value: Math.min(1, assessment.score * 1.5) * 3, min: 0, max: 3 }, providerConfidence: 0.8,
    })) };
  },
};
const engine = mode === 'mock' ? mock : createJevEngine({ model: JEV_MODEL });
const handler = createDecisionHandler({ definitions: [definition], engine, mode: 'development',
  origins: ['http://127.0.0.1:5183', 'http://127.0.0.1:4173', 'http://127.0.0.1:5193', 'http://127.0.0.1:5184', 'http://127.0.0.1:5186'] });
const server = createNodeServer(handler);
server.listen(5193, '127.0.0.1', () => console.log(`Imicue ${mode} endpoint: http://127.0.0.1:5193/v1/decide`));
server.on('error', () => { console.error('Imicue server could not start (check port 5193).'); process.exitCode = 1; });
