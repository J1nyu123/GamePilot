import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApproachTarget } from '../src/skills/approach-target';
import { TargetEstimator } from '../src/state/target-estimator';
import { normalizeApproach } from '../src/contracts/approach';
import { GameVerifier } from '../src/verification/verifier';
import { runValidation } from '../src/agent/validation-runtime';
import type { ImportedImage } from '../src/contracts/debug';
// @ts-expect-error Pinned Pi mjs transport is resolved by the test loader.
import { locateTarget } from '../src/state/target-model.mjs';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=';
const frame = (n: number): ImportedImage => ({ id: `frame-${n}`, name: 'fixture', path: '', importedAt: 1, mimeType: 'image/png', width: 1, height: 1, size: 1, dataUrl: `data:image/png;base64,${png}`, source: 'window',
  evidence: { sourceId: 'window:1:0', title: 'fixture', identity: 'same', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n, barrierMediaTime: n-.1, barrierPresentedFrames: n-1, barrierRequestedAt: n*100, capturedAt: n*100+1, receivedAt: n*100+2, clock: 'video-media-time', freshness: 'after-source-barrier' } });
async function run(scenario: 'pass' | 'lost' | 'verifier-failed' | 'claims-only' | 'batch' | 'invalid-args') {
  let planner = 0, tracker = 0, verification = 0, n = 1; const moves: string[] = [];
  const controller = new AbortController();
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body), system = input.messages[0].content;
    const tracking = system.includes('P3 target locator'), verifying = system.includes('independent visual verifier');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'p3', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (tracking) {
      tracker++; assert.deepEqual(input.response_format, { type: 'json_object' }); assert.ok(!input.tools?.length); assert.equal(input.messages.length, 2);
      assert.equal(input.messages[1].content.filter((c: { type: string }) => c.type === 'image_url').length, 3);
      assert.ok(!JSON.stringify(input.messages).includes('planner-private-claim'));
      const box = tracker === 1 ? [.15,.3,.1,.2] : tracker === 2 ? [.4,.3,.2,.2] : [.375,.3,.25,.3];
      send({ content: JSON.stringify({ mode: 'gameplay', visible: scenario !== 'lost', sameTarget: scenario !== 'lost', sceneStable: true, pathClear: true, coordinateSystem: 'ltrb-1000', bounds1000: scenario === 'lost' ? null : { left: Math.round(box[0]*1000), top: Math.round(box[1]*1000), right: Math.round((box[0]+box[2])*1000), bottom: Math.round((box[1]+box[3])*1000) }, interaction: { status: 'present', text: 'A 调查（测试）' }, confidence: .95, facts: ['unique pillar'] }) }); send({}, 'stop');
    } else if (verifying) {
      verification++; assert.ok(!input.tools?.length);
      send({ content: JSON.stringify({ verdict: scenario === 'verifier-failed' ? 'failed' : 'passed', summary: 'fixed visible criterion', facts: ['visible pillar'] }) }); send({}, 'stop');
    } else {
      planner++; assert.deepEqual(input.tools.map((t: { function: { name: string } }) => t.function.name), ['approach_target']);
      if (planner === 1 && scenario !== 'claims-only') {
        const args = { targetId: 'fixed-target', observationId: 'frame-1', ...(scenario === 'invalid-args' ? { maxSteps: 999 } : {}) };
        const call = { index: 0, id: 'approach-1', type: 'function', function: { name: 'approach_target', arguments: JSON.stringify(args) } };
        send({ tool_calls: [call, ...(scenario === 'batch' ? [{ ...call, index: 1, id: 'approach-2' }] : [])] }); send({}, 'tool_calls');
      } else { send({ content: 'planner-private-claim: done' }); send({}, 'stop'); }
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  const config = { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test-key', modelId: 'mock', provider: 'local', configPath: '' };
  try {
    const spec = normalizeApproach({ description: 'unique pillar', region: [.35,.2,.3,.65], minArea: .06 });
    const verifier = new GameVerifier(config);
    const skill = new ApproachTarget(spec, { id: 'goal', successCondition: 'fixed pillar screen condition' }, frame(1), controller.signal, {
      execute: async (input, beforeSend) => { beforeSend(); moves.push(input.skill === 'move_for' ? input.direction : 'button'); return { ok: true, neutral: true, status: 'executed' }; },
      neutral: async () => ({ ok: true, neutral: true }), stop: async () => {}, capture: async () => frame(++n), save: async () => {}, emit: () => {},
      tracker: new TargetEstimator(input => locateTarget({ config, input })), verify: input => verifier.verify(input),
    });
    const summary = await runValidation({ ...config, signal: controller.signal, timeoutMs: 5000, prompt: 'approach fixed target', image: { type: 'image', data: png, mimeType: 'image/png' }, onEvent: () => {},
      approachTools: { goal: 'fixed', targetId: spec.targetId, observationId: 'frame-1', allow: name => skill.allow(name), execute: (args, signal, id) => skill.execute(args, signal, id) } });
    return { summary: skill.finalize(summary), moves, planner, tracker, verification };
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}
test('Pi chooses one feedback skill; independent locator corrects left→forward; independent verifier accepts', async () => {
  const result = await run('pass'); assert.deepEqual(result.moves, ['left', 'forward']); assert.equal(result.tracker, 4); assert.equal(result.verification, 1); assert.equal(result.planner, 2); assert.equal(result.summary.status, 'succeeded');
});
for (const scenario of ['lost', 'verifier-failed', 'claims-only', 'batch', 'invalid-args'] as const) test(`${scenario}: no unverified completion or unbounded second skill`, async () => {
  const result = await run(scenario); assert.notEqual(result.summary.status, 'succeeded'); assert.notEqual(result.summary.gameOutcome, 'passed');
  assert.ok(result.moves.length <= 2); if (['lost', 'claims-only', 'invalid-args'].includes(scenario)) assert.equal(result.moves.length, 0);
});
