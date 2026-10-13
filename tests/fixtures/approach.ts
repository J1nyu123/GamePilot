import type { ImportedImage } from '../../src/contracts/debug';
import { normalizeApproach, type Box, type TargetDetection } from '../../src/contracts/approach';
import type { VerificationRequest, VerificationResult } from '../../src/contracts/verification';
export const spec = normalizeApproach({ description: 'unique pillar', region: [.35, .2, .3, .65], minArea: .06 });
export const image = (n: number): ImportedImage => ({ id: `frame-${n}`, name: 'fixture', path: '', importedAt: 1,
  mimeType: 'image/png', width: 1, height: 1, size: 1, dataUrl: 'data:image/png;base64,eA==', source: 'window', evidence: {
    sourceId: 'window:1:0', title: 'fixture', identity: 'same', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n,
    barrierMediaTime: n - .1, barrierPresentedFrames: n - 1, barrierRequestedAt: n * 100, capturedAt: n * 100 + 1,
    receivedAt: n * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' } });
export const detection = (box: Box = [.375, .3, .25, .3]): TargetDetection => ({ mode: 'gameplay', visible: true, sameTarget: true,
  sceneStable: true, pathClear: true, box, confidence: .95, facts: ['same visible pillar'] });
export function verdict(input: VerificationRequest, value: VerificationResult['verdict'] = 'passed'): VerificationResult {
  const task = input.task!;
  const evidenceIds = [input.before.id, ...input.observations!.map(o => o.id)];
  return { id: `verification-${input.after.id}`, goalId: task.id, taskId: task.id, targetId: task.targetId,
    observationId: input.after.id, observedAt: input.observations!.at(-1)!.observedAt, releaseId: input.release.id,
    verdict: value, method: 'vlm', summary: `visible ${value}`, facts: ['visible pillar'], evidenceIds,
    criteria: task.criteria.map(c => ({ id: c.id, verdict: value, evidenceIds: evidenceIds.slice(1), reason: `visible ${value}` })) };
}
