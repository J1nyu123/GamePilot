import test from 'node:test';
import assert from 'node:assert/strict';
import { ApproachRunner, type ApproachRunnerDependencies } from '../src/runtime/approach-runner';
import { TargetEstimator } from '../src/state/target-estimator';
import type { AgentEvent, RunSummary } from '../src/contracts/debug';
import { freezeTask, readRunResult } from '../src/contracts/run';
import { parseTaskVerdict } from '../src/verification/task-result';
import { image, detection, spec, verdict } from './fixtures/approach';

function setup(detections = [detection()]) {
  const parent = new AbortController(), events: Partial<AgentEvent>[] = [], moves: number[] = [];
  let clock = 0, n = 1, calls = 0, checks = 0, stopped = 0;
  const deps: ApproachRunnerDependencies = {
    execute: async (skill, beforeSend) => { beforeSend(); if (skill.skill === 'move_for') moves.push(skill.durationMs); return { ok: true, neutral: true, status: 'executed' }; },
    neutral: async () => ({ ok: true, neutral: true }), stop: async () => { stopped++; }, capture: async () => { clock += 400; return image(++n); },
    save: async () => {}, tracker: new TargetEstimator(async () => JSON.stringify(detections[Math.min(calls++, detections.length - 1)])),
    verify: async input => { checks++; return verdict(input); }, emit: (type, fields) => events.push({ type, ...fields }), now: () => clock,
  };
  const runner = new ApproachRunner(spec, { id: 'goal', successCondition: 'visible target' }, image(1), parent.signal, deps);
  return { runner, deps, parent, events, moves, advance: (ms: number) => { clock += ms; }, counts: () => ({ checks, stopped }) };
}
const base: RunSummary = { status: 'control_passed', gameOutcome: 'unverified', simulated: false, turns: 2, completedTools: 1, toolErrors: 0, finalText: 'done' };
test('immutable task copies criteria; old execution receipts stay unverified', () => {
  const goal = { id: 'goal', successCondition: 'visible', criteria: [{ id: 'c', description: 'visible', required: true }] };
  const task = freezeTask(goal); goal.criteria[0].description = 'changed';
  assert.equal(task.criteria[0].description, 'visible'); assert.ok(Object.isFrozen(task.criteria));
  assert.equal(readRunResult(base).taskOutcome, 'unverified');
});
test('direct skill returns candidate; Runner verifies and reports no Agent turns', async () => {
  const f = setup(); const result = await f.runner.run('direct');
  assert.equal(result.status, 'succeeded'); assert.equal(result.gameOutcome, 'passed'); assert.equal(result.turns, 0);
  assert.equal(result.completedTools, 1); assert.equal(f.counts().checks, 1);
  assert.equal(f.events.filter(e => e.type === 'tool_execution_start').length, 0);
  assert.ok(!JSON.stringify(result).includes('data:image/')); assert.equal(result.runResult?.execution?.arrivalCandidate, true);
});
test('failed verification may continue, sharing the eight movement budget across skills', async () => {
  const moving = detection([.4, .3, .2, .2]);
  const f = setup([...Array.from({ length: 7 }, () => moving), detection(), detection(), moving]);
  f.deps.verify = async input => verdict(input, 'failed');
  const result = await f.runner.run('direct');
  assert.equal(result.status, 'budget_exceeded'); assert.equal(result.gameOutcome, 'failed');
  assert.equal(f.moves.length, 8); assert.ok(f.moves.every(ms => ms === 200)); assert.equal(f.runner.stats.calls, 2);
  assert.equal(result.runResult?.budget?.steps, 8); assert.ok(result.runResult!.budget!.observations <= 12);
});
test('perpetual verification failure exhausts shared observation budget without an unlimited retry', async () => {
  const f = setup(); f.deps.verify = async input => verdict(input, 'failed');
  const result = await f.runner.run('direct');
  assert.equal(result.status, 'budget_exceeded'); assert.equal(result.approach?.calls, 6); assert.equal(result.approach?.observations, 12);
  assert.equal(f.moves.length, 0); assert.equal(result.gameOutcome, 'failed');
});
test('failed then passed uses latest frames and same frozen task', async () => {
  const f = setup(); let checked = 0; const tasks: unknown[] = [];
  f.deps.verify = async input => { tasks.push(input.task); return verdict(input, ++checked === 1 ? 'failed' : 'passed'); };
  const result = await f.runner.run('direct');
  assert.equal(result.status, 'succeeded'); assert.equal(result.approach?.calls, 2); assert.equal(tasks[0], tasks[1]);
  assert.equal(result.verification?.observationId, 'frame-5');
});
test('direction corrections include the first movement of a later skill invocation', async () => {
  const f = setup([detection([.15, .3, .2, .2]), detection(), detection(), detection([.4, .3, .2, .2]), detection(), detection()]);
  let checks = 0; f.deps.verify = async input => verdict(input, ++checks === 1 ? 'failed' : 'passed');
  const result = await f.runner.run('direct'); assert.equal(result.status, 'succeeded');
  assert.equal(result.approach?.calls, 2); assert.equal(result.approach?.corrections, 1);
});
test('arrival alone and exhausted action budget are unverified; inconclusive verification does not retry', async () => {
  const f = setup([detection([.4, .3, .2, .2])]); const result = await f.runner.run('direct');
  assert.equal(result.gameOutcome, 'unverified'); assert.equal(result.verification, undefined); assert.equal(f.counts().checks, 0);
  const g = setup(); g.deps.verify = async input => verdict(input, 'inconclusive');
  const unknown = await g.runner.run('direct'); assert.equal(unknown.approach?.calls, 1); assert.equal(unknown.gameOutcome, 'inconclusive');
});
test('Agent summary failure preserves valid independent verification', async () => {
  const f = setup(); const result = await f.runner.run('agent', async tools => {
    await tools.tools[0].execute({ targetId: spec.targetId, observationId: 'frame-1' }, undefined, 'agent-tool');
    return { ...base, status: 'failed', error: 'summary HTTP error' };
  });
  assert.equal(result.status, 'succeeded'); assert.equal(result.verification?.verdict, 'passed');
  assert.equal(result.runResult?.agentSummaryError, 'summary HTTP error');
  assert.equal(f.runner.finish(result, 'agent').runResult?.agentSummaryError, 'summary HTTP error');
});
test('late Agent summary cannot prove current completion; old verdict remains tied to its frame', async () => {
  const f = setup(); const result = await f.runner.run('agent', async tools => {
    await tools.tools[0].execute({ targetId: spec.targetId, observationId: 'frame-1' }, undefined, 'agent-tool');
    f.advance(16000); return base;
  });
  assert.equal(result.status, 'blocked'); assert.equal(result.gameOutcome, 'passed');
  assert.equal(result.runResult?.stopReason, 'stale-verification'); assert.equal(result.verification?.observationId, 'frame-3');
});
test('cancel after passed and missing final release prevent succeeded while preserving evidence', async () => {
  const f = setup(); const done = await f.runner.run('direct'); f.parent.abort();
  const canceled = f.runner.finish(done, 'direct'); assert.equal(canceled.status, 'canceled'); assert.equal(canceled.verification?.verdict, 'passed');
  const g = setup(); const verified = await g.runner.run('direct');
  const unsafe = g.runner.finish(verified, 'direct', false); assert.equal(unsafe.status, 'failed'); assert.equal(unsafe.gameOutcome, 'passed');
  assert.equal(unsafe.runResult?.stopReason, 'release-unconfirmed');
});
test('wrong target/task/evidence or missing criteria cannot be accepted', async () => {
  for (const change of [{ taskId: 'wrong' }, { targetId: 'wrong' }, { goalId: 'wrong' }, { releaseId: 'wrong' }, { evidenceIds: ['invented'] }, { criteria: [] }]) {
    const f = setup(); f.deps.verify = async input => ({ ...verdict(input), ...change });
    const result = await f.runner.run('direct'); assert.equal(result.status, 'blocked'); assert.equal(result.gameOutcome, 'inconclusive');
    assert.equal(result.runResult?.stopReason, 'invalid-verification');
  }
});
test('cancellation interrupts a verifier ignoring abort and waits for stop', async () => {
  const f = setup(); let entered!: () => void, late!: (value: ReturnType<typeof verdict>) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  f.deps.verify = async input => { entered(); return new Promise(resolve => { late = resolve; }); };
  const running = f.runner.run('direct'); await ready; f.parent.abort(); const result = await running;
  assert.equal(result.status, 'canceled'); assert.equal(result.gameOutcome, 'unverified'); assert.ok(f.counts().stopped > 0);
  // Releasing a late dependency must not emit a verification or revive execution.
  late({} as ReturnType<typeof verdict>); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.filter(e => e.type === 'verification_end').length, 0);
});
test('Agent cancellation of a later skill settles statistics and reset before publishing completion', async () => {
  const f = setup(); let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const reset = new Promise<void>(resolve => { release = resolve; });
  f.deps.stop = async () => reset;
  let tracked = 0;
  f.deps.verify = async input => verdict(input, 'failed');
  f.deps.tracker = new TargetEstimator(async () => { if (++tracked <= 2) return JSON.stringify(detection()); entered(); return new Promise<string>(() => {}); });
  const running = f.runner.run('agent', async tools => {
    await tools.tools[0].execute({ targetId: spec.targetId, observationId: 'frame-1' }, undefined, 'first');
    await tools.tools[0].execute({ targetId: spec.targetId, observationId: f.runner.observationId }, undefined, 'second'); return base;
  });
  await ready; f.parent.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.some(e => e.type === 'runner_end'), false); release();
  const result = await running; assert.equal(result.status, 'canceled'); assert.equal(result.approach?.calls, 2);
  assert.equal(f.events.at(-1)?.type, 'runner_end'); assert.equal(result.approach?.stopReason, 'canceled');
});
test('Runner total time does not restart at a second skill invocation', async () => {
  const f = setup(); let calls = 0;
  f.deps.verify = async input => { f.advance(++calls === 1 ? 59000 : 2000); return verdict(input, 'failed'); };
  const result = await f.runner.run('direct'); assert.equal(result.status, 'timed_out'); assert.ok(f.runner.stats.calls <= 2);
});
test('cancellation reset failure stays failed even when an earlier verification is valid', async () => {
  const f = setup(); const result = await f.runner.run('agent', async tools => {
    await tools.tools[0].execute({ targetId: spec.targetId, observationId: 'frame-1' }, undefined, 'tool');
    f.deps.stop = async () => { throw new Error('reset ACK missing'); }; f.parent.abort(); return base;
  });
  assert.equal(result.status, 'failed'); assert.equal(result.runResult?.stopReason, 'release-unconfirmed');
  assert.equal(result.verification?.verdict, 'passed');
});
test('model oral success, missing items and invented evidence cannot satisfy frozen criteria', () => {
  const task = freezeTask({ id: 'g', successCondition: 'visible' }, spec);
  const oral = JSON.stringify({ verdict: 'passed', summary: 'done', facts: ['I completed the task'] });
  assert.equal(parseTaskVerdict(oral, task, ['before', 'after'], 'after').verdict, 'inconclusive');
  const data = { verdict: 'passed', summary: 'visible', facts: ['pillar'], criteria: task.criteria.map(c => ({ id: c.id, verdict: 'passed', reason: 'visible', evidenceIds: ['invented'] })) };
  assert.equal(parseTaskVerdict(JSON.stringify(data), task, ['before', 'after'], 'after').verdict, 'inconclusive');
});
