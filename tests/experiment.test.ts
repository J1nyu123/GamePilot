import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproachExperiment, runExperiment } from '../src/experiments/approach';
import type { RunSummary } from '../src/contracts/debug';
const input = { description: 'pillar', region: [.35, .2, .3, .65], minArea: .06 };
test('Experiment owns frozen configuration and aggregates every trial via injected Runner', async () => {
  const plan = createApproachExperiment(input, 'visible interaction', 'direct', { trials: 3, startingConditions: 'fixed origin', baseline: 'frozen prototype' });
  const prepared: number[] = [], invoked: number[] = [];
  const report = await runExperiment(plan, { prepareTrial: async trial => { prepared.push(trial); }, runTrial: async (received, trial) => {
    assert.equal(received, plan); invoked.push(trial);
    return { status: trial === 1 ? 'succeeded' : 'budget_exceeded', gameOutcome: trial === 1 ? 'passed' : 'unverified',
      simulated: false, turns: 0, completedTools: 1, toolErrors: 0, finalText: '' } as RunSummary;
  } }, new AbortController().signal);
  assert.deepEqual(prepared, [1, 2, 3]); assert.deepEqual(invoked, prepared);
  assert.equal(report.statistics.succeeded, 1); assert.equal(report.statistics.unverified, 2);
  assert.equal(plan.limits.maxSteps, 8); assert.equal(plan.limits.stepMs, 200); assert.ok(Object.isFrozen(plan.spec.region));
  const alternate = createApproachExperiment(input, 'visible interaction', 'agent'); assert.equal(alternate.strategy, 'agent');
});
test('canceled Experiment never resets or starts another trial', async () => {
  const parent = new AbortController(), plan = createApproachExperiment(input, 'visible', 'direct', { trials: 2 });
  let invoked = 0;
  await assert.rejects(runExperiment(plan, { prepareTrial: async () => { parent.abort(); }, runTrial: async () => { invoked++; throw new Error('unexpected'); } }, parent.signal));
  assert.equal(invoked, 0);
});
test('trial setup failures remain in statistics and do not call the Runner', async () => {
  const plan = createApproachExperiment(input, 'visible', 'direct', { trials: 2 }); let invoked = 0;
  const report = await runExperiment(plan, { prepareTrial: async () => { throw new Error('starting condition unavailable'); },
    runTrial: async () => { invoked++; throw new Error('unexpected'); } }, new AbortController().signal);
  assert.equal(invoked, 0); assert.equal(report.trials.length, 2); assert.equal(report.statistics.unverified, 2);
  assert.ok(report.trials.every(row => row.summary.status === 'failed'));
});
