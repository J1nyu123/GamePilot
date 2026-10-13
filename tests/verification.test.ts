import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImportedImage } from '../src/contracts/debug';
import type { ReleaseEvidence } from '../src/contracts/verification';
import { checkEvidence, parseVerdict } from '../src/verification/evidence';

export const observation = (id: string, sequence: number): ImportedImage => ({
  id, name: 'Cemu', path: `${id}.jpg`, importedAt: 10, mimeType: 'image/jpeg', width: 100, height: 100, size: 1, dataUrl: 'data:image/jpeg;base64,AA==', source: 'window',
  evidence: { sourceId: 'window:1:0', title: 'Cemu', identity: '1:2:3', generation: 1, frameSequence: sequence, sourceMediaTime: sequence,
    presentedFrames: sequence, barrierMediaTime: sequence - .1, barrierPresentedFrames: sequence - 1, barrierRequestedAt: sequence * 100,
    capturedAt: sequence * 100 + 1, receivedAt: sequence * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' },
});
export const release: ReleaseEvidence = { id: 'release', receipt: { ok: true, neutral: true, status: 'executed', runId: 'input', generation: 2 },
  sourceId: 'window:1:0', identity: '1:2:3', captureGeneration: 1, receivedAt: 999, order: 'release-ack-then-capture' };

test('source barrier uses its own clock, not unrelated Main/Python timestamps', () => {
  assert.equal(checkEvidence(observation('before', 1), observation('after', 2), release), undefined);
});
test('cached frame, missing capture clock, changed source or unconfirmed release cannot verify', () => {
  const before = observation('before', 1);
  const after = observation('after', 2);
  for (const bad of [
    { ...after, evidence: { ...after.evidence!, capturedAt: null } },
    { ...after, evidence: { ...after.evidence!, capturedAt: 100 } },
    { ...after, evidence: { ...after.evidence!, frameSequence: 1 } },
    { ...after, evidence: { ...after.evidence!, identity: 'replacement' } },
    { ...after, evidence: { ...after.evidence!, generation: 2 } },
    { ...after, evidence: { ...after.evidence!, sourceMediaTime: 1 } },
  ]) assert.ok(checkEvidence(before, bad, release));
  assert.ok(checkEvidence(before, after, { ...release, receipt: { ok: true, neutral: false } }));
});
test('invalid JSON, empty evidence and model-proposed goal changes cannot become passed', () => {
  assert.equal(parseVerdict('not json').verdict, 'inconclusive');
  assert.equal(parseVerdict('{"verdict":"passed","summary":"done","facts":[]}').verdict, 'inconclusive');
  assert.equal(parseVerdict('{"verdict":"passed","summary":"done","facts":["visible"],"newGoal":"anything"}').verdict, 'inconclusive');
  assert.equal(parseVerdict('{"verdict":"failed","summary":"target not reached","facts":["target still distant"]}').verdict, 'failed');
});
