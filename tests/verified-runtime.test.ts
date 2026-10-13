import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeSupervisor } from '../src/runtime/supervisor';
import { GameVerifier } from '../src/verification/verifier';
import { runValidation } from '../src/agent/validation-runtime';
import type { ImportedImage } from '../src/contracts/debug';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=';
const frame = (n: number): ImportedImage => ({ id: `f-${n}`, name: 'fixture', path: '', importedAt: 1, mimeType: 'image/png', width: 1, height: 1, size: 1, dataUrl: `data:image/png;base64,${png}`, source: 'window',
  evidence: { sourceId: 'window:1:0', title: 'fixture', identity: 'window-same', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n,
    barrierMediaTime: n - .1, barrierPresentedFrames: n - 1, barrierRequestedAt: 100 * n, capturedAt: 100 * n + 1, receivedAt: 100 * n + 2, clock: 'video-media-time', freshness: 'after-source-barrier' } });
type Scenario = 'pass' | 'fail' | 'inconclusive' | 'invalid' | 'correction' | 'wait' | 'claims-only' | 'cancel-verifier' | 'verifier-error' | 'batch';
async function run(scenario: Scenario) {
  const signal = new AbortController(), requests: Record<string, unknown>[] = [], feedback: string[] = [];
  let plannerCalls = 0, verifierCalls = 0, moves = 0, n = 1;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body); requests.push(data);
    const isVerifier = data.messages[0].content.includes('independent visual verifier');
    if (isVerifier) {
      verifierCalls++; assert.ok(!data.tools?.length);
      assert.equal(data.messages.length, 2); assert.equal(data.messages[1].content.filter((c: { type: string }) => c.type === 'image_url').length, 2);
      assert.ok(!JSON.stringify(data.messages).includes('Planner-private-claim'));
      if (scenario === 'cancel-verifier') { signal.abort(); return; }
      if (scenario === 'verifier-error') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"verifier auth test-local-key"}}'); return; }
    } else plannerCalls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'p2d', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (isVerifier) {
      const verdict = scenario === 'fail' || (scenario === 'correction' && verifierCalls === 1) ? 'failed' : scenario === 'inconclusive' ? 'inconclusive' : 'passed';
      send({ reasoning_content: 'PRIVATE VERIFIER REASONING NEVER LOG' });
      send({ content: scenario === 'invalid' ? 'not-json' : JSON.stringify({ verdict, summary: `visible ${verdict}`, facts: ['visible target landmark'] }) }); send({}, 'stop');
    } else if (scenario !== 'claims-only' && (plannerCalls === 1 || (scenario === 'correction' && plannerCalls === 2))) {
      const name = scenario === 'wait' ? 'wait_for_state' : 'move_for', args = name === 'wait_for_state' ? { timeoutMs: 2000 } : { direction: 'forward', durationMs: 40 };
      send({ content: 'Observe fixture; call bounded tool.' }); send({ tool_calls: [{ index: 0, id: `call-${plannerCalls}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ...(scenario === 'batch' ? [{ index: 1, id: 'batch-extra', type: 'function', function: { name, arguments: JSON.stringify(args) } }] : [])] }); send({}, 'tool_calls');
    } else { send({ content: 'Planner-private-claim: task done.' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('test port');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId: 'mock', apiKey: 'test-local-key', provider: 'local', configPath: '' };
  try {
    const verifier = new GameVerifier(config, text => feedback.push(text));
    const supervisor = new RuntimeSupervisor({ id: randomUUID(), successCondition: '可见目标已经接近' }, frame(1), signal.signal, {
      execute: async () => { moves++; return { ok: true, status: 'executed', neutral: true }; }, neutral: async () => ({ ok: true, neutral: true }),
      capture: async () => frame(++n), save: async () => {}, verify: input => verifier.verify(input), emit: () => {},
    });
    const summary = await runValidation({ ...config, prompt: 'Complete fixed visible goal', image: { type: 'image', mimeType: 'image/png', data: png }, timeoutMs: 4000, signal: signal.signal, onEvent: () => {},
      verifiedTools: { goal: supervisor.goal.successCondition, allow: name => supervisor.allow(name), move: (args, s, id) => supervisor.move(args, s, id), wait: (args, s, id) => supervisor.wait(args, s, id) },
    });
    assert.ok(!feedback.join('').includes('PRIVATE VERIFIER')); return { summary: supervisor.finalize(summary), moves, plannerCalls, verifierCalls, requests };
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}
test('real Pi loop includes independent verifier, post image and goal result', async () => {
  const result = await run('pass'); assert.equal(result.summary.status, 'succeeded'); assert.equal(result.summary.gameOutcome, 'passed'); assert.equal(result.moves, 1);
  assert.equal(result.verifierCalls, 1); assert.equal(result.plannerCalls, 2);
  const second = result.requests.at(-1) as { messages: { role: string; content: unknown }[] };
  assert.ok(second.messages.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(c => c.type === 'image_url')));
});
for (const scenario of ['fail', 'inconclusive', 'invalid', 'claims-only', 'verifier-error'] as const) {
  test(`${scenario}: Planner says done but Supervisor refuses success`, async () => { const result = await run(scenario); assert.equal(result.summary.status, 'blocked'); assert.notEqual(result.summary.gameOutcome, 'passed'); assert.ok(!JSON.stringify(result.requests).includes('test-local-key')); });
}
test('Pi uses verifier failure and new evidence for one bounded correction', async () => {
  const result = await run('correction'); assert.equal(result.summary.status, 'succeeded'); assert.equal(result.moves, 2); assert.equal(result.verifierCalls, 2);
});
test('Pi wait_for_state verifies without movement', async () => {
  const result = await run('wait'); assert.equal(result.summary.status, 'succeeded'); assert.equal(result.moves, 0);
});
test('cancel during independent verifier cannot return task passed', async () => {
  const result = await run('cancel-verifier'); assert.equal(result.summary.status, 'canceled'); assert.equal(result.summary.gameOutcome, 'unverified');
});
test('batched tools cannot execute a second input without a new model decision', async () => {
  const result = await run('batch'); assert.equal(result.moves, 1); assert.equal(result.summary.status, 'blocked');
});
