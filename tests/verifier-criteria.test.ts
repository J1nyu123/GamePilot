import test from 'node:test';
import assert from 'node:assert/strict';
import { GameVerifier } from '../src/verification/verifier';
import { freezeTask, type Observation } from '../src/contracts/run';
import type { ReleaseEvidence, VerificationRequest } from '../src/contracts/verification';
import { image, spec } from './fixtures/approach';
const config = { baseUrl: 'http://127.0.0.1/v1', apiKey: 'secret-fixture', modelId: 'mock', provider: 'fixture', configPath: '' };
function request(interaction = false) {
  const task = freezeTask({ id: 'task', successCondition: 'visible pillar' }, { ...spec, requireInteraction: interaction });
  const release: ReleaseEvidence = { id: 'release', receipt: { ok: true, neutral: true }, sourceId: 'window:1:0', identity: 'same', captureGeneration: 1, receivedAt: 0, order: 'release-ack-then-capture' };
  const observations: Observation[] = [2, 3].map((n, index) => ({ id: image(n).id, source: 'window', image: image(n), release,
    observedAt: index * 400, validUntil: index * 400 + 15000, clock: 'main-monotonic' }));
  const input: VerificationRequest = { goal: task, task, before: image(1), after: image(3), release, observations,
    signal: new AbortController().signal, now: () => 500 };
  const json = (value: 'passed' | 'failed' | 'inconclusive') => JSON.stringify({ verdict: value, summary: 'visible criterion', facts: ['pillar'],
    criteria: task.criteria.map(c => ({ id: c.id, verdict: value, evidenceIds: ['frame-2', 'frame-3'], reason: 'visible criterion' })) });
  return { input, json };
}
for (const value of ['passed', 'failed', 'inconclusive'] as const) test(`independent verifier returns ${value} per immutable criterion`, async () => {
  const f = request(true); let seen: Record<string, unknown> | undefined;
  const verifier = new GameVerifier(config, () => {}, async (input: Record<string, unknown>) => { seen = input; return f.json(value); });
  const result = await verifier.verify(f.input);
  assert.equal(result.verdict, value); assert.equal(result.method, 'vlm'); assert.equal(result.taskId, 'task');
  assert.equal(result.criteria?.length, f.input.task!.criteria.length); assert.equal(result.observationId, 'frame-3');
  assert.ok(!Object.hasOwn(seen!, 'conversation')); assert.ok(!Object.hasOwn(seen!, 'actions')); assert.ok(Array.isArray(seen!.frames));
});
test('expired, reused, changed-window or mismatched-task evidence is rejected before a model request', async () => {
  for (const change of ['expired', 'reused', 'window', 'task', 'continuous'] as const) {
    const f = request(true); let calls = 0;
    if (change === 'expired') f.input.now = () => 16000;
    if (change === 'reused') f.input.after = image(1);
    if (change === 'window') f.input.after = { ...f.input.after, evidence: { ...f.input.after.evidence!, identity: 'replacement' } };
    if (change === 'task') f.input.goal = { id: 'replacement', successCondition: f.input.goal.successCondition };
    if (change === 'continuous') f.input.observations = f.input.observations!.slice(-1);
    const result = await new GameVerifier(config, () => {}, async () => { calls++; return f.json('passed'); }).verify(f.input);
    assert.equal(result.method, 'evidence-check'); assert.equal(result.verdict, 'inconclusive'); assert.equal(calls, 0);
    assert.ok(result.criteria!.every(c => c.verdict === 'inconclusive'));
  }
});
test('evidence aging during model response cannot become a current success', async () => {
  const f = request(); let clock = 500; f.input.now = () => clock;
  const result = await new GameVerifier(config, () => {}, async () => { clock = 16000; return f.json('passed'); }).verify(f.input);
  assert.equal(result.method, 'evidence-check'); assert.equal(result.verdict, 'inconclusive');
});
test('a model claim without criteria, aggregate disagreement or incomplete interaction citations stays inconclusive', async () => {
  const f = request(true), data = JSON.parse(f.json('passed'));
  const cases = [JSON.stringify({ verdict: 'passed', summary: 'I arrived', facts: ['I completed actions'] }),
    JSON.stringify({ ...data, verdict: 'failed' }),
    JSON.stringify({ ...data, criteria: data.criteria.map((c: { id: string }) => ({ ...c, evidenceIds: ['frame-3'] })) })];
  for (const text of cases) {
    const result = await new GameVerifier(config, () => {}, async () => text).verify(f.input);
    assert.equal(result.verdict, 'inconclusive');
  }
});
test('verifier timeout interrupts a dependency that ignores abort and preserves method as an attempted VLM call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = request(); let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const verifier = new GameVerifier(config, () => {}, async () => { entered(); return new Promise<string>(() => {}); });
  const running = verifier.verify(f.input); await ready; t.mock.timers.tick(15000);
  const result = await running; assert.equal(result.method, 'vlm'); assert.equal(result.verdict, 'inconclusive');
  assert.match(result.summary, /超时/);
});
