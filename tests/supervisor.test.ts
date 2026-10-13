import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeSupervisor, type SupervisorDependencies } from '../src/runtime/supervisor';
import type { VerificationResult, Verdict } from '../src/contracts/verification';
import type { ImportedImage, RunSummary } from '../src/contracts/debug';
const frame = (n: number): ImportedImage => ({ id: `frame-${n}`, name: 'Cemu', path: '', importedAt: 1, mimeType: 'image/jpeg', width: 10, height: 10, size: 1, dataUrl: 'data:image/jpeg;base64,AA==', source: 'window',
  evidence: { sourceId: 'window:1:0', title: 'Cemu', identity: 'same', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n,
    barrierMediaTime: n - .1, barrierPresentedFrames: n - 1, barrierRequestedAt: n * 100, capturedAt: n * 100 + 1, receivedAt: n * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' } });
const base: RunSummary = { status: 'control_passed', simulated: false, gameOutcome: 'unverified', turns: 2, completedTools: 1, toolErrors: 0, finalText: 'Planner says done' };
const move = { direction: 'forward' as const, durationMs: 200 };
function setup(verdicts: Verdict[] = ['passed'], patch: Partial<SupervisorDependencies> = {}) {
  const controller = new AbortController(), calls = { moves: 0, captures: 0, checks: 0, neutral: 0 }, beforeIds: string[] = [];
  let n = 1;
  const deps: SupervisorDependencies = {
    execute: async () => { calls.moves++; return { ok: true, status: 'executed', neutral: true }; },
    neutral: async () => { calls.neutral++; return { ok: true, neutral: true }; },
    capture: async () => { calls.captures++; return frame(++n); }, save: async () => {}, emit: () => {},
    verify: async input => { beforeIds.push(input.before.id); calls.checks++; return { id: `check-${n}`, goalId: input.goal.id, releaseId: input.release.id,
      verdict: verdicts.shift() ?? 'failed', evidenceIds: [input.before.id, input.after.id], summary: 'visible evidence', facts: ['visible landmark'], method: 'vlm', durationMs: 1 }; }, ...patch,
  };
  return { supervisor: new RuntimeSupervisor({ id: 'fixed-goal', successCondition: '角色靠近可见石柱' }, frame(1), controller.signal, deps), controller, calls, beforeIds };
}
test('post-action capture and verifier never run before release acknowledgement', async () => {
  let acknowledge!: () => void;
  const { supervisor, calls } = setup(['passed'], { execute: async () => { await new Promise<void>(resolve => { acknowledge = resolve; }); return { ok: true, status: 'executed', neutral: true }; } });
  const task = supervisor.move(move, undefined, 'call'); await delay(5);
  assert.equal(calls.captures, 0); assert.equal(calls.checks, 0); acknowledge(); await task;
  assert.equal(calls.captures, 1); assert.equal(supervisor.finalize(base).status, 'succeeded');
});
test('failed release never reaches capture or verification', async () => {
  const { supervisor, calls } = setup(['passed'], { execute: async () => ({ ok: true, neutral: false, status: 'executed' }) });
  await assert.rejects(supervisor.move(move, undefined, 'call'), /释放未确认/); assert.equal(calls.captures, 0);
});
test('cached frame and absent capture clock are inconclusive without a VLM request', async () => {
  for (const image of [frame(1), { ...frame(2), evidence: { ...frame(2).evidence!, capturedAt: null } }]) {
    const { supervisor, calls } = setup(['passed'], { capture: async () => image });
    const packet = await supervisor.move(move, undefined, 'call'); assert.equal(packet.details.verification.verdict, 'inconclusive');
    assert.equal(calls.checks, 0); assert.equal(supervisor.finalize(base).status, 'blocked'); assert.match(supervisor.allow('move_for')!, /证据不足/);
  }
});
test('frame timeout cannot create passed or trigger blind correction', async () => {
  const { supervisor, calls } = setup(['passed'], { capture: async () => { throw new Error('source timeout'); } });
  await supervisor.move(move, undefined, 'call'); assert.equal(calls.checks, 0);
  assert.equal(supervisor.finalize(base).gameOutcome, 'inconclusive'); assert.ok(supervisor.allow('move_for'));
});
test('bounded correction uses fresh evidence but keeps the original fixed goal baseline', async () => {
  const { supervisor, calls, beforeIds } = setup(['failed', 'passed']);
  await supervisor.move(move, undefined, 'one'); assert.equal(supervisor.allow('move_for'), undefined);
  await supervisor.move(move, undefined, 'two'); assert.equal(calls.moves, 2); assert.ok(supervisor.allow('move_for'));
  assert.deepEqual(beforeIds, ['frame-1', 'frame-1']); assert.equal(supervisor.finalize(base).status, 'succeeded');
});
test('wait_for_state polls fixed condition with neutral ACK and sends zero input', async () => {
  const { supervisor, calls } = setup(['failed', 'passed']);
  const packet = await supervisor.wait({ timeoutMs: 2000 }, undefined, 'wait');
  assert.equal(calls.moves, 0); assert.equal(calls.neutral, 1); assert.equal(calls.checks, 2); assert.equal(packet.details.execution, 'condition_met');
});
test('wait observations are bounded and unmet condition cannot be task success', async () => {
  const { supervisor, calls } = setup(['failed', 'failed', 'failed']);
  const packet = await supervisor.wait({ timeoutMs: 10000 }, undefined, 'wait');
  assert.equal(calls.checks, 3); assert.equal(packet.details.execution, 'observation_budget_exhausted'); assert.equal(supervisor.finalize(base).status, 'blocked');
});
test('wait deadline aborts stalled verification, rejects late passed and sends no movement', async () => {
  const { supervisor, calls } = setup(['passed'], { verify: async () => { await delay(2000); throw new Error('late'); } });
  const started = performance.now(); const packet = await supervisor.wait({ timeoutMs: 500 }, undefined, 'wait');
  assert.ok(performance.now() - started < 1000); assert.equal(packet.details.verification.verdict, 'inconclusive'); assert.equal(calls.moves, 0);
});
test('Planner completion claims and expired evidence are refused', async () => {
  const first = setup(); assert.equal(first.supervisor.finalize(base).status, 'blocked');
  let now = 0; const second = setup(['passed'], { now: () => now }); await second.supervisor.move(move, undefined, 'call'); now = 16000;
  assert.equal(second.supervisor.finalize(base).status, 'blocked'); assert.equal(second.supervisor.finalize(base).gameOutcome, 'inconclusive');
});
test('cancellation during verifier cannot produce a goal success', async () => {
  const { supervisor, controller } = setup(['passed'], { verify: async input => { await delay(2000, undefined, { signal: input.signal }); throw new Error('never'); } });
  const pending = supervisor.move(move, undefined, 'call'); setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(supervisor.finalize(base).status, 'canceled');
});
