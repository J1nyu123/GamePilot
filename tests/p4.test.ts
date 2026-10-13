import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeCampaign, loadCampaign, nextAssignment, reserveAssignment, campaignReport, reviewTrial, recordChecklist, checklist, percentile95, validatePlan, type CampaignPlan } from '../src/benchmarks/campaign';
const plan: CampaignPlan = { schemaVersion: 1, timeoutMs: 60000, game: 'test game', scene: 'fixed', resetProcedure: 'manual reset', environment: { machine: 'test', cemu: '1', gameVersion: '1', controller: 'test', modelId: 'fixture', provider: 'fixture' }, tasks: Object.fromEntries(['move','wait','blocked','cancel-model','cancel-action'].map(group => [group, { prompt: `task ${group}`, successCondition: `visible ${group}` }])) as CampaignPlan['tasks'] };
const fixture = async () => { const root = await mkdtemp(join(tmpdir(), 'gamepilot-p4-')); return { root, id: await freezeCampaign(root, plan) }; };
test('incomplete scene cannot be frozen; thresholds are not editable plan fields', () => {
  assert.throws(() => validatePlan({ ...plan, scene: '待填写' }));
  assert.equal(percentile95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  assert.equal(percentile95([]), null);
});
test('plan tampering is rejected', async () => {
  const f = await fixture();
  try { const path = join(f.root, 'benchmarks', f.id, 'plan.json'), saved = JSON.parse(await readFile(path, 'utf8')); saved.plan.scene = 'changed'; await writeFile(path, JSON.stringify(saved)); await assert.rejects(loadCampaign(f.root, f.id), /修改/); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
test('concurrent reservation cannot duplicate a trial; crash remains a failed slot', async () => {
  const f = await fixture();
  try {
    const next = (await nextAssignment(f.root, f.id))!;
    const results = await Promise.allSettled([reserveAssignment(f.root, next, plan.environment), reserveAssignment(f.root, next, plan.environment)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const report = await campaignReport(f.root, f.id); assert.equal(report.rows[0].status, 'failed'); assert.equal(report.status, 'not_accepted');
    assert.equal((await nextAssignment(f.root, f.id))?.trial, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('wrong model and changed assignment cannot consume a trial', async () => {
  const f = await fixture();
  try { const next = (await nextAssignment(f.root, f.id))!; await assert.rejects(reserveAssignment(f.root, next, { ...plan.environment, modelId: 'wrong' })); await assert.rejects(reserveAssignment(f.root, { ...next, prompt: 'changed' }, plan.environment)); assert.equal((await nextAssignment(f.root, f.id))?.trial, 1); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});

// Synthetic records in a temporary directory exercise report logic only, never real acceptance.
async function populate(root: string, id: string) {
  for (;;) {
    const next = await nextAssignment(root, id); if (!next) break;
    const a = await reserveAssignment(root, next, plan.environment), dir = join(root, 'runs', a.runId);
    await mkdir(join(dir, 'observations'), { recursive: true });
    const evidence = (n: number) => ({ sourceId: 'window:1:0', title: 'fixture', identity: '1:2:3', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n, barrierMediaTime: n - .1, barrierPresentedFrames: n - 1, barrierRequestedAt: n * 100, capturedAt: n * 100 + 1, receivedAt: n * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' });
    const release = { id: 'release', receipt: { ok: true, neutral: true }, sourceId: 'window:1:0', identity: '1:2:3', captureGeneration: 1, receivedAt: 999, order: 'release-ack-then-capture' };
    const cancel = a.group.startsWith('cancel-'), blocked = a.group === 'blocked';
    const v = { id: 'v', goalId: 'goal', releaseId: 'release', evidenceIds: ['before', 'after'], verdict: blocked ? 'inconclusive' : 'passed', method: 'vlm', summary: 'fixture', facts: ['fixture'] };
    const summary = { status: cancel ? 'canceled' : blocked ? 'blocked' : 'succeeded', gameOutcome: cancel ? 'unverified' : v.verdict, simulated: false, verification: cancel ? undefined : v, metrics: { moves: a.group === 'move' ? 1 : 0 } };
    const fields: any[] = [{ type: 'model_request' }];
    if (a.group !== 'cancel-model') fields.push({ type: 'tool_execution_start', args: { direction: 'forward', durationMs: a.group === 'cancel-action' ? 1500 : 500 }, toolName: a.group === 'move' || a.group === 'cancel-action' ? 'move_for' : 'wait_for_state' });
    if (!cancel) fields.push({ type: 'verification_end', verification: v });
    if (cancel) fields.push({ type: 'control_stop', result: { neutral: true, stopTiming: { id: a.runId, backend: 'virtual-xbox', reason: 'F8 紧急停止', phase: a.group === 'cancel-model' ? 'ready' : 'executing', resetSentAfterMs: 1, ackAfterMs: 20 } } });
    fields.push({ type: 'input_released', result: { neutral: true } }, { type: 'validation_end', summary });
    const manifest = { schemaVersion: 2, timeoutMs: 60000, runId: a.runId, startedAt: Date.now(), benchmark: a, endpoint: 'https://example.invalid/v1', simulated: false, modelId: 'fixture', provider: 'fixture', prompt: a.prompt, goal: { id: 'goal', successCondition: a.successCondition }, input: { id: 'before', source: 'window' }, observations: [ { observationId: 'before', phase: 'before', path: 'observations/before.jpg', evidence: evidence(1) }, { observationId: 'after', phase: 'after', path: 'observations/after.jpg', evidence: evidence(2), release } ] };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(dir, 'summary.json'), JSON.stringify(summary));
    await writeFile(join(dir, 'events.jsonl'), fields.map((e, i) => JSON.stringify({ ...e, runId: a.runId, sequence: i + 1, timestamp: Date.now() })).join('\n'));
    for (const name of ['input.jpg', 'observations/before.jpg', 'observations/after.jpg']) await writeFile(join(dir, name), 'fixture');
    await reviewTrial(root, id, a.group, a.trial, { reviewer: 'test fixture', notes: 'synthetic test', outcome: 'passed', sceneRestored: true });
  }
  for (const key of checklist) await recordChecklist(root, id, key, { reviewer: 'fixture', outcome: 'passed', notes: 'synthetic only', evidence: 'fixture' });
}
test('all 35 slots, human reviews, checklist and measured latency are required; test data and duplicated runs fail', async () => {
  const f = await fixture();
  try {
    await populate(f.root, f.id);
    const report = await campaignReport(f.root, f.id); assert.equal(report.status, 'accepted', JSON.stringify(report.rows.filter(r => !r.passed))); assert.equal(report.timing.samples, 20);
    const first = report.rows[0], second = report.rows[1];
    await writeFile(join(f.root, 'runs', first.runId!, 'test-context.json'), '{}');
    let changed = await campaignReport(f.root, f.id); assert.equal(changed.rows[0].passed, false); // 4/5 remains possible
    const slot = join(f.root, 'benchmarks', f.id, 'move-2.json'); const reservation = JSON.parse(await readFile(slot, 'utf8')); reservation.runId = first.runId; await writeFile(slot, JSON.stringify(reservation));
    changed = await campaignReport(f.root, f.id); assert.equal(changed.status, 'not_accepted'); assert.equal(changed.rows[1].passed, false);
    assert.ok(second.runId);
    await assert.rejects(reviewTrial(f.root, f.id, 'move', 1, { reviewer: 'again', notes: 'cannot overwrite', outcome: 'passed', sceneRestored: true }));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
