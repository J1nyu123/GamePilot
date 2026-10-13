import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DebugSession } from '../src/main/session';
import { ApproachRunner } from '../src/runtime/approach-runner';
import { createApproachExperiment } from '../src/experiments/approach';
import { TargetEstimator } from '../src/state/target-estimator';
import { auditApproach } from '../src/trace/approach-audit';
import { auditRun } from '../src/trace/audit';
import type { AgentEvent, RunSummary } from '../src/contracts/debug';
import { image, spec, detection, verdict } from './fixtures/approach';

async function trace(strategy: 'direct' | 'agent', variant: 'passed' | 'failed' | 'inconclusive' | 'canceled' | 'stale' | 'trace-error' = 'passed') {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-runner-session-'));
  const plan = createApproachExperiment({ description: spec.description, region: spec.region, minArea: spec.minArea }, 'visible pillar', strategy);
  const config = { baseUrl: 'http://127.0.0.1/v1', apiKey: 'fixture-secret', modelId: 'mock', provider: 'fixture', configPath: '' };
  const events: AgentEvent[] = []; let n = 1;
  const session: DebugSession = new DebugSession(root, async () => { throw new Error('unexpected simulation'); }, event => events.push(event));
  const { runId } = await session.start(image(1), Buffer.from('x'), 'fixture', 10000, config, {
    simulated: false, goal: plan.task, experiment: plan, pausable: false,
    runner: async (options, replaceInput, saved) => {
      await replaceInput(image(1), Buffer.from('x'));
      const emit = (type: string, fields: Partial<AgentEvent>) => options.onEvent({ sequence: 0, timestamp: Date.now(), type, simulated: false, ...fields });
      const runner = new ApproachRunner(plan.spec, plan.task, image(1), options.signal, {
        execute: async (_input, before) => { before(); return { ok: true, neutral: true, status: 'executed' }; },
        neutral: async () => ({ ok: true, neutral: true }), stop: async () => {}, capture: async () => image(++n),
        save: (frame, release) => saved.saveObservation(frame, Buffer.from('x'), release),
        tracker: new TargetEstimator(async () => JSON.stringify(detection())),
        verify: async input => verdict(input, ['failed', 'inconclusive'].includes(variant) ? variant as 'failed' | 'inconclusive' : 'passed'), emit,
      });
      const base: RunSummary = { status: 'control_passed', simulated: false, gameOutcome: 'unverified', turns: 2, completedTools: 1, toolErrors: 0, finalText: 'fixture' };
      const result = await runner.run(strategy, async tools => {
        const args = { targetId: plan.spec.targetId, observationId: runner.observationId };
        emit('tool_execution_start', { turn: 1, toolCallId: 'tool', toolName: 'approach_target', args });
        const packet = await tools.tools[0].execute(args, undefined, 'tool');
        emit('tool_execution_end', { turn: 1, toolCallId: 'tool', toolName: 'approach_target', result: packet.details, isError: false });
        return base;
      });
      emit('input_released', { result: { neutral: true } });
      if (variant === 'canceled') session.cancelActive();
      const finished = runner.finish(result, strategy);
      if (variant === 'stale') {
        const records = finished.runResult!.execution!.observations;
        records[records.length - 1] = { ...records.at(-1)!, validUntil: performance.now() - 1 };
      }
      if (variant === 'trace-error') await mkdir(join(root, session.current!.runId, 'summary.json'));
      return finished;
    },
  });
  await session.waitForEnd();
  return { root, session, events, dir: join(root, runId) };
}
for (const strategy of ['direct', 'agent'] as const) test(`${strategy}: new manifests audit with immutable criteria and no historical rewrite`, async () => {
  const f = await trace(strategy);
  try {
    assert.equal(f.session.current?.status, 'succeeded');
    const report = await auditApproach(f.dir); assert.equal(report.technicalPassed, true, JSON.stringify(report.checks));
    const manifest = JSON.parse(await readFile(join(f.dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 3); assert.equal(manifest.executionStrategy, strategy);
    assert.deepEqual(manifest.task, manifest.goal);
    assert.deepEqual((await readFile(join(f.dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)), f.events);
    const path = join(f.dir, 'summary.json'), summary = JSON.parse(await readFile(path, 'utf8'));
    summary.verification.criteria[0].evidenceIds = ['invented'];
    await writeFile(path, JSON.stringify(summary)); assert.equal((await auditRun(f.dir)).technicalPassed, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('summary persistence failure preserves historical verification and fails the run', async () => {
  const f = await trace('direct', 'trace-error');
  try {
    const summary = f.session.current!.summary!;
    assert.equal(summary.status, 'failed'); assert.equal(summary.gameOutcome, 'passed');
    assert.equal(summary.runResult?.status, 'failed'); assert.equal(summary.runResult?.stopReason, 'trace-error');
    assert.equal(summary.verification?.verdict, 'passed'); assert.equal((await auditRun(f.dir)).technicalPassed, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
for (const variant of ['failed', 'inconclusive', 'canceled', 'stale'] as const) test(`session ${variant}: run status remains separate from task result`, async () => {
  const f = await trace('direct', variant);
  try {
    assert.notEqual(f.session.current?.status, 'succeeded');
    assert.equal(f.session.current?.summary?.gameOutcome, variant === 'canceled' || variant === 'stale' ? 'passed' : variant);
    assert.equal(f.session.current?.summary?.runResult?.status, f.session.current?.status);
    const report = await auditApproach(f.dir); assert.equal(report.technicalPassed, true, JSON.stringify(report.checks));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
