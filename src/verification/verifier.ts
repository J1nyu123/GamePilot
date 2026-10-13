import { randomUUID } from 'node:crypto';
import type { VerificationRequest, VerificationResult } from '../contracts/verification';
import type { ModelConfig } from '../main/model-config';
import { redact } from '../main/model-config';
import { checkEvidence, parseVerdict } from './evidence';
// @ts-expect-error Pinned local Pi transport module has no declarations.
import { verifyImage } from '../../runtime/p1/src/verifier-model.mjs';

export class GameVerifier {
  constructor(private config: ModelConfig, private onText: (text: string) => void = () => {}, private request: typeof verifyImage = verifyImage) {}
  async verify(input: VerificationRequest): Promise<VerificationResult> {
    const started = performance.now(); input.signal.throwIfAborted();
    const common = { id: randomUUID(), goalId: input.goal.id, releaseId: input.release.id, evidenceIds: [input.before.id, input.after.id] };
    const failure = checkEvidence(input.before, input.after, input.release);
    if (failure) return { ...common, method: 'evidence-check', verdict: 'inconclusive', summary: failure, facts: [], durationMs: performance.now() - started };
    const controller = new AbortController(), cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 15000);
    try {
      const asImage = (image: VerificationRequest['after']) => ({ type: 'image', data: image.dataUrl.split(',')[1], mimeType: image.mimeType });
      const text = await this.request({ ...this.config, successCondition: input.goal.successCondition, before: asImage(input.before), after: asImage(input.after), signal: controller.signal, onText: this.onText });
      input.signal.throwIfAborted(); controller.signal.throwIfAborted();
      return { ...common, ...parseVerdict(text), method: 'vlm', durationMs: performance.now() - started };
    } catch (error) {
      input.signal.throwIfAborted();
      return { ...common, method: 'vlm', verdict: 'inconclusive', summary: controller.signal.aborted ? '验证请求超时，结论未知' : `验证请求失败：${redact(error instanceof Error ? error.message : '未知异常', [this.config.apiKey])}`, facts: [], durationMs: performance.now() - started };
    } finally { clearTimeout(timer); input.signal.removeEventListener('abort', cancel); }
  }
}
