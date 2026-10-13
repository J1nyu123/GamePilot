import { randomUUID } from 'node:crypto';
import type { VerificationRequest, VerificationResult } from '../contracts/verification';
import type { ModelConfig } from '../main/model-config';
import { redact } from '../main/model-config';
import { checkEvidence } from './evidence';
import { freezeTask } from '../contracts/run';
import { parseTaskVerdict, unknownCriteria } from './task-result';
import { interruptible } from '../runtime/interruptible';
// @ts-expect-error Pinned local Pi transport module has no declarations.
import { verifyImage } from '../../runtime/p1/src/verifier-model.mjs';

export class GameVerifier {
  constructor(private config: ModelConfig, private onText: (text: string) => void = () => {}, private request: typeof verifyImage = verifyImage) {}
  async verify(input: VerificationRequest): Promise<VerificationResult> {
    const started = performance.now(); input.signal.throwIfAborted();
    const task = input.task ?? freezeTask(input.goal), now = input.now ?? (() => performance.now());
    const observations = input.observations ?? [];
    const evidenceIds = [...new Set([input.before.id, ...observations.map(o => o.id), input.after.id])];
    const common = { id: randomUUID(), goalId: task.id, taskId: task.id, targetId: task.targetId,
      releaseId: input.release.id, evidenceIds, observationId: input.after.id, observedAt: observations.at(-1)?.observedAt };
    const unknown = (summary: string, method: 'vlm' | 'evidence-check'): VerificationResult => ({ ...common, method,
      verdict: 'inconclusive', summary, facts: [], criteria: unknownCriteria(task, summary), durationMs: performance.now() - started });
    const freshness = () => observations.some(o => o.clock !== 'main-monotonic' || !Number.isFinite(o.observedAt)
      || !Number.isFinite(o.validUntil) || now() < o.observedAt || now() > o.validUntil);
    let failure = input.goal.id !== task.id || input.goal.successCondition !== task.successCondition ? '固定任务或成功标准不一致' : checkEvidence(input.before, input.after, input.release);
    if (!failure && observations.length) {
      if (observations.at(-1)?.id !== input.after.id || new Set(observations.map(o => o.id)).size !== observations.length) failure = '连续证据身份不一致';
      for (const [index, o] of observations.entries()) {
        if (o.id !== o.image.id || !o.release || checkEvidence(index ? observations[index - 1].image : input.before, o.image, o.release)) failure = '连续帧缺少有效释放或源屏障';
      }
    }
    if (!failure && task.criteria.some(c => c.id === 'interaction') && (observations.length < 2
      || observations.at(-1)!.observedAt - observations.at(-2)!.observedAt < 300)) failure = '交互条件缺少连续两帧证据';
    if (failure || freshness()) return unknown(failure ?? '验证证据已过期', 'evidence-check');
    const controller = new AbortController(), signal = AbortSignal.any([input.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const asImage = (image: VerificationRequest['after']) => ({ type: 'image', data: image.dataUrl.split(',')[1], mimeType: image.mimeType });
      const text = await interruptible<string>(this.request({ ...this.config, successCondition: task.successCondition,
        targetId: task.targetId, criteria: task.criteria, evidenceIds, beforeId: input.before.id, afterId: input.after.id,
        before: asImage(input.before), after: asImage(input.after),
        frames: observations.filter(o => o.id !== input.after.id).map(o => ({ id: o.id, image: asImage(o.image) })),
        signal, onText: (text: string) => { if (!signal.aborted) this.onText(text); } }), signal);
      signal.throwIfAborted();
      if (freshness()) return unknown('验证完成时证据已过期', 'evidence-check');
      return { ...common, ...parseTaskVerdict(text, task, evidenceIds, input.after.id), method: 'vlm', durationMs: performance.now() - started };
    } catch (error) {
      input.signal.throwIfAborted();
      return unknown(controller.signal.aborted ? '验证请求超时，结论未知' : `验证请求失败：${redact(error instanceof Error ? error.message : '未知异常', [this.config.apiKey])}`, 'vlm');
    } finally { clearTimeout(timer); controller.abort(); }
  }
}
