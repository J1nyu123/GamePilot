import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditRun } from '../src/trace/audit';
import { acceptanceCases } from '../src/contracts/acceptance';
import type { FrameEvidence } from '../src/contracts/capture';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-audit-'));
  const evidence = (n: number): FrameEvidence => ({ sourceId: 'window:1:0', title: 'Cemu', identity: '1:2:3', generation: 1,
    frameSequence: n, sourceMediaTime: n, presentedFrames: n, barrierMediaTime: n - .1, barrierPresentedFrames: n - 1,
    barrierRequestedAt: n * 100, capturedAt: n * 100 + 1, receivedAt: n * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' });
  const release = { id: 'release', receipt: { ok: true, neutral: true, runId: 'input', generation: 2 },
    sourceId: 'window:1:0', identity: '1:2:3', captureGeneration: 1, receivedAt: 999, order: 'release-ack-then-capture' };
  const v = { id: 'v', goalId: 'goal', releaseId: 'release', evidenceIds: ['before', 'after'], verdict: 'passed', method: 'vlm', summary: 'visible', facts: ['heart'] };
  const manifest = { schemaVersion: 2, runId: 'test-run', endpoint: 'https://model.example/v1', simulated: false,
    input: { id: 'before', source: 'window' }, goal: { id: 'goal', successCondition: String(acceptanceCases[0].condition) }, observations: [
      { observationId: 'before', phase: 'before', path: 'observations/before.jpg', evidence: evidence(1) },
      { observationId: 'after', phase: 'after', path: 'observations/after.jpg', evidence: evidence(2), release },
    ] };
  const summary = { status: 'succeeded', gameOutcome: 'passed', simulated: false, verification: v };
  const fields = [ { type: 'tool_execution_start', toolName: 'wait_for_state' }, { type: 'verification_start' },
    { type: 'verification_end', verification: v }, { type: 'input_released', result: { neutral: true } }, { type: 'validation_end', summary } ];
  const events = fields.map((event, i) => ({ ...event, sequence: i + 1, timestamp: i, runId: manifest.runId }));
  await mkdir(join(root, 'observations'));
  await writeFile(join(root, 'observations/before.jpg'), 'fixture-before'); await writeFile(join(root, 'observations/after.jpg'), 'fixture-after');
  await writeFile(join(root, 'input.jpg'), 'fixture-before');
  const save = async () => {
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'summary.json'), JSON.stringify(summary));
    await writeFile(join(root, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  };
  await save();
  return { root, manifest, summary, events, v, save };
}

test('valid read-only candidate passes structural checks without claiming human/physical validation or writing files', async () => {
  const f = await fixture();
  try {
    const original = await readFile(join(f.root, 'events.jsonl'));
    const result = await auditRun(f.root, 'hud');
    assert.equal(result.technicalPassed, true, JSON.stringify(result.checks));
    assert.equal(result.humanReview, 'required'); assert.equal(result.physicalInputVerified, null);
    assert.deepEqual(await readFile(join(f.root, 'events.jsonl')), original);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const damage of ['old-frame', 'wrong-goal', 'missing-image', 'escape-path', 'sequence', 'missing-release', 'false-success', 'empty-facts', 'missing-summary-verdict', 'wrong-input']) {
  test(`audit rejects ${damage}`, async () => {
    const f = await fixture();
    try {
      if (damage === 'old-frame') f.manifest.observations[1].evidence.sourceMediaTime = 1;
      if (damage === 'wrong-goal') f.v.goalId = 'other';
      if (damage === 'missing-image') await rm(join(f.root, 'observations/after.jpg'));
      if (damage === 'escape-path') f.manifest.observations[1].path = '../outside.jpg';
      if (damage === 'sequence') f.events[1].sequence = 100;
      if (damage === 'missing-release') f.events[3].result!.neutral = false;
      if (damage === 'false-success') f.summary.gameOutcome = 'failed';
      if (damage === 'empty-facts') f.v.facts = [];
      if (damage === 'missing-summary-verdict') delete (f.summary as { verification?: unknown }).verification;
      if (damage === 'wrong-input') await writeFile(join(f.root, 'input.jpg'), 'different');
      await f.save(); assert.equal((await auditRun(f.root)).technicalPassed, false);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test('local model and test-context are flagged, never accepted as real case evidence', async () => {
  const f = await fixture();
  try {
    f.manifest.endpoint = 'http://127.0.0.1:8000/v1'; await f.save();
    const local = await auditRun(f.root, 'hud'); assert.equal(local.testData, true); assert.equal(local.technicalPassed, false);
    f.manifest.endpoint = 'https://model.example/v1'; await f.save();
    await writeFile(join(f.root, 'test-context.json'), '{"testOnly":true}');
    assert.equal((await auditRun(f.root, 'hud')).technicalPassed, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('absent/corrupt record yields failed audit instead of inferred success', async () => {
  const f = await fixture();
  try { await writeFile(join(f.root, 'summary.json'), 'bad'); assert.equal((await auditRun(f.root)).technicalPassed, false); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});

test('move preset requires actual visible criterion; readonly templates do not request movement', () => {
  assert.equal(acceptanceCases.find(item => item.id === 'move')!.condition, '');
  assert.ok(acceptanceCases.filter(item => item.id !== 'move').every(item => item.prompt.includes('不要移动')));
});

for (const caseId of ['negative', 'unknown', 'move', 'cancel'] as const) {
  test(`${caseId} has explicit outcome checks, no conclusive-result shortcut`, async () => {
    const f = await fixture();
    try {
      f.manifest.goal.successCondition = acceptanceCases.find(item => item.id === caseId)!.condition || '指定地标的可见相对位置改变';
      if (caseId === 'negative' || caseId === 'unknown') {
        f.v.verdict = caseId === 'negative' ? 'failed' : 'inconclusive';
        f.summary.status = 'blocked'; f.summary.gameOutcome = f.v.verdict;
      }
      if (caseId === 'move') {
        f.events[0].toolName = 'move_for';
        Object.assign(f.events[0], { args: { direction: 'forward', durationMs: 500 } });
      }
      if (caseId === 'cancel') {
        f.summary.status = 'canceled'; f.summary.gameOutcome = 'unverified';
      }
      await f.save();
      const result = await auditRun(f.root, caseId);
      assert.equal(result.technicalPassed, true, JSON.stringify(result.checks));
      assert.equal(result.humanReview, 'required');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test('wait polling may reuse a neutral release, verification must resolve the referenced after frame', async () => {
  const f = await fixture();
  try {
    const originalAfter = f.manifest.observations[1];
    const later = { ...originalAfter, observationId: 'later', path: 'observations/later.jpg', evidence: { ...originalAfter.evidence,
      frameSequence: 3, sourceMediaTime: 3, presentedFrames: 3, barrierMediaTime: 2.9, barrierPresentedFrames: 2, barrierRequestedAt: 300, capturedAt: 301 } };
    f.manifest.observations.push(later); f.v.evidenceIds = ['before', 'later'];
    await writeFile(join(f.root, later.path), 'later'); await f.save();
    assert.equal((await auditRun(f.root, 'hud')).technicalPassed, true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
