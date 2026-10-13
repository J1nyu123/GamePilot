import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentEvent, ImportedImage, RunSummary } from '../contracts/debug';
import type { InputReply, ManualSkill } from '../contracts/input';
import type { GoalSpec, ReleaseEvidence, ToolPacket, VerificationRequest, VerificationResult } from '../contracts/verification';
import { approachLimits as limits, type ApproachSpec, type ApproachStats, type TargetState } from '../contracts/approach';
import { TargetEstimator, stateRejection, approachDecision } from '../state/target-estimator';
import { checkEvidence } from '../verification/evidence';

export interface ApproachDependencies {
  execute(skill: ManualSkill, beforeSend: () => void): Promise<InputReply>;
  neutral(): Promise<InputReply>; stop(reason: string): Promise<void>;
  capture(signal: AbortSignal): Promise<ImportedImage>;
  save(image: ImportedImage, release: ReleaseEvidence): Promise<void>;
  verify(input: VerificationRequest): Promise<VerificationResult>;
  tracker: TargetEstimator;
  emit(type: string, fields: Partial<AgentEvent>): void;
  now?: () => number;
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Approach interrupted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
class Blocked extends Error { constructor(readonly reason: string) { super(reason); } }
export class ApproachTarget {
  readonly stats: ApproachStats = { calls: 0, steps: 0, executedSteps: 0, observations: 0, trackingCalls: 0, corrections: 0, stopReason: 'not-started' };
  private verdict?: VerificationResult;
  private stopDetail?: string;
  private toolCallId?: string;
  private current: ImportedImage;
  private release?: ReleaseEvidence;
  private observedAt = -Infinity;
  private now: () => number;
  constructor(readonly spec: ApproachSpec, private goal: GoalSpec, private initial: ImportedImage, private parent: AbortSignal, private deps: ApproachDependencies) {
    this.current = initial; this.now = deps.now ?? (() => performance.now());
  }
  allow(name: string) {
    if (this.parent.aborted) return '任务已取消';
    if (name !== 'approach_target') return 'P3 只允许固定目标接近技能';
    if (this.stats.calls) return '每次 P3 实验只允许调用一次反馈技能，不自动重试';
  }
  private released(receipt: InputReply): ReleaseEvidence {
    const source = this.initial.evidence;
    if (!source || receipt.ok !== true || receipt.neutral !== true || receipt.status && receipt.status !== 'executed') throw new Error('P3 输入释放未确认');
    return { id: randomUUID(), receipt, sourceId: source.sourceId, identity: source.identity, captureGeneration: source.generation, receivedAt: Date.now(), order: 'release-ack-then-capture' };
  }
  async execute(args: { targetId: string; observationId: string }, toolSignal: AbortSignal | undefined, toolCallId: string): Promise<ToolPacket> {
    const rejection = this.allow('approach_target');
    if (rejection) throw new Error(rejection);
    if (!args || Object.keys(args).some(k => !['targetId', 'observationId'].includes(k)) || args.targetId !== this.spec.targetId || args.observationId !== this.initial.id) throw new Error('P3 工具引用不是固定目标或本次规划截图');
    this.stats.calls++; this.toolCallId = toolCallId;
    const parent = toolSignal ? AbortSignal.any([this.parent, toolSignal]) : this.parent;
    const deadline = new AbortController(), signal = AbortSignal.any([parent, deadline.signal]);
    const started = this.now();
    const timer = setTimeout(() => deadline.abort(), limits.timeoutMs);
    let stopPromise: Promise<void> | undefined;
    const stop = () => { stopPromise ??= this.deps.stop('P3 反馈技能取消或超时'); void stopPromise.catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    let state: TargetState | undefined, previousState: TargetState | undefined;
    let stable = 0, stableSince = 0, lastDirection: string | undefined;
    const assertTime = () => { signal.throwIfAborted(); if (this.now() - started >= limits.timeoutMs) throw new Blocked('timeout'); };
    try {
      assertTime();
      this.release = this.released(await abortable(this.deps.neutral(), signal));
      for (;;) {
        assertTime();
        if (this.stats.observations >= limits.maxObservations) throw new Blocked('observation-budget');
        const previous = this.current;
        const observedAt = this.now();
        const image = await abortable(this.deps.capture(signal), signal); assertTime();
        const invalid = checkEvidence(previous, image, this.release!);
        if (invalid) throw new Blocked('invalid-frame');
        await abortable(this.deps.save(image, this.release!), signal); assertTime();
        this.current = image; this.observedAt = observedAt; this.stats.observations++;
        this.deps.emit('observation_post', { observationId: image.id, toolCallId, release: this.release, text: 'P3 已释放输入并保存反馈新帧' });
        this.stats.trackingCalls++;
        this.deps.emit('tracking_start', { toolCallId, observationId: image.id, text: '定位固定目标；定位期间输入保持归零' });
        state = await abortable(this.deps.tracker.estimate({ spec: this.spec, initial: this.initial, previous, image, signal }, observedAt), signal); assertTime();
        this.deps.emit('tracking_state', { toolCallId, observationId: image.id, result: state, text: '目标坐标为归一化框；置信度为模型自报启发值' });
        const invalidState = stateRejection(state, this.spec, image.id, this.now(), previousState);
        if (invalidState) { this.stopDetail = state.invalidReason; throw new Blocked(invalidState); }
        previousState = state;
        const direction = approachDecision(state, this.spec);
        this.deps.emit('approach_decision', { toolCallId, observationId: image.id,
          result: { stateVersion: state.version, observationId: image.id, decision: direction, box: state.box, region: this.spec.region, area: state.box![2] * state.box![3], minArea: this.spec.minArea, ageMs: this.now() - observedAt },
          text: direction === 'hold' ? '到达屏幕条件候选，保持归零并再次取帧确认' : `反馈决策：${direction}` });
        if (direction === 'unsupported-position') throw new Blocked('unsupported-position');
        if (direction === 'hold') {
          if (!stable) stableSince = observedAt;
          stable++;
          if (stable >= limits.stableFrames && observedAt - stableSince >= limits.stableMs) break;
          await delay(limits.stableMs, undefined, { signal }); assertTime();
          this.release = this.released(await abortable(this.deps.neutral(), signal));
          continue;
        }
        stable = 0;
        if (this.stats.steps >= limits.maxSteps) throw new Blocked('step-budget');
        const basedOn = state;
        const beforeSend = () => {
          assertTime();
          const invalid = stateRejection(basedOn, this.spec, this.current.id, this.now());
          if (invalid) throw new Blocked(invalid);
        };
        beforeSend(); this.stats.steps++;
        const skill: ManualSkill = { skill: 'move_for', direction, durationMs: limits.stepMs, strength: limits.strength };
        this.deps.emit('approach_step', { toolCallId, observationId: image.id, result: { stateVersion: state.version, ...skill }, text: `短移动 ${direction} ${limits.stepMs}ms，随后归零并重新观察` });
        const receipt = await abortable(this.deps.execute(skill, () => { beforeSend(); this.deps.emit('approach_input', { toolCallId, observationId: image.id, result: { stateVersion: basedOn.version, ageMs: this.now() - observedAt, ...skill }, text: '发送前再次通过状态有效期检查' }); }), signal); assertTime();
        this.release = this.released(receipt); this.stats.executedSteps++;
        if (lastDirection && lastDirection !== direction) this.stats.corrections++;
        lastDirection = direction;
        this.deps.emit('skill_released', { toolCallId, release: this.release, text: 'P3 分段动作已确认执行并归零' });
      }
      assertTime();
      this.deps.emit('verification_start', { toolCallId, observationId: this.current.id, text: '连续新帧满足屏幕条件，独立验证固定目标' });
      const verdict = await abortable(this.deps.verify({ goal: this.goal, before: this.initial, after: this.current, release: this.release!, signal }), signal);
      assertTime();
      if (verdict.verdict === 'passed' && (verdict.method !== 'vlm' || !verdict.facts.length)) throw new Blocked('invalid-verification');
      if (verdict.goalId !== this.goal.id || verdict.releaseId !== this.release!.id || !verdict.evidenceIds.includes(this.initial.id) || !verdict.evidenceIds.includes(this.current.id)) throw new Blocked('invalid-verification');
      if (this.now() - this.observedAt > limits.completionMaxAgeMs) throw new Blocked('stale-verification');
      this.verdict = verdict; this.stats.stopReason = verdict.verdict === 'passed' ? 'arrived' : 'verification-' + verdict.verdict;
    } catch (error) {
      if (parent.aborted) { this.stats.stopReason = 'canceled'; stop(); await stopPromise; this.deps.emit('approach_end', { toolCallId, result: { ...this.stats }, text: 'P3 已取消并停止输入' }); throw new DOMException('P3 已取消', 'AbortError'); }
      if (deadline.signal.aborted || error instanceof Blocked) {
        this.stats.stopReason = deadline.signal.aborted ? 'timeout' : (error as Blocked).reason;
      } else if (error instanceof Error && error.message === 'P3 输入释放未确认') { stop(); await stopPromise; throw error; }
      else { this.stats.stopReason = 'dependency-error'; this.deps.emit('approach_fault', { toolCallId, text: error instanceof Error ? error.message.slice(0, 500) : '反馈依赖调用失败' }); }
      stop(); await stopPromise;
      this.verdict = { id: randomUUID(), goalId: this.goal.id, releaseId: this.release?.id ?? 'no-release', evidenceIds: [...new Set([this.initial.id, this.current.id])],
        verdict: 'inconclusive', method: 'evidence-check', facts: [], summary: `P3 停止：${this.stats.stopReason}${this.stopDetail ? `（${this.stopDetail}）` : ''}；不继续盲移` };
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      if (stopPromise) await stopPromise;
    }
    parent.throwIfAborted();
    this.deps.emit('verification_end', { toolCallId, verification: this.verdict });
    this.deps.emit('approach_end', { toolCallId, result: { ...this.stats }, text: `P3 反馈技能结束：${this.stats.stopReason}` });
    const details = { simulated: false as const, verification: this.verdict!, observationId: this.current.id, execution: this.stats.stopReason, approach: { ...this.stats } };
    return { details, content: [{ type: 'text', text: JSON.stringify(details) }, { type: 'image', data: this.current.dataUrl.split(',')[1], mimeType: this.current.mimeType }] };
  }
  finalize(base: RunSummary): RunSummary {
    const common = { ...base, approach: { ...this.stats }, verification: this.verdict };
    if (this.parent.aborted) return { ...common, status: base.status === 'failed' ? 'failed' : 'canceled', gameOutcome: 'unverified' };
    if (['failed', 'canceled', 'timed_out'].includes(base.status)) return { ...common, gameOutcome: 'unverified' };
    if (base.status === 'control_passed' && this.stats.stopReason === 'arrived' && this.verdict?.verdict === 'passed'
      && this.now() - this.observedAt <= limits.completionMaxAgeMs) return { ...common, status: 'succeeded', gameOutcome: 'passed' };
    if (this.verdict?.verdict === 'passed') {
      this.stats.stopReason = 'completion-rejected';
      this.verdict = { ...this.verdict, id: randomUUID(), verdict: 'inconclusive', method: 'evidence-check', facts: [], summary: 'P3 完成检查未通过：规划退出异常或验证证据过期' };
      this.deps.emit('verification_end', { toolCallId: this.toolCallId, verification: this.verdict });
      this.deps.emit('approach_end', { toolCallId: this.toolCallId, result: { ...this.stats }, text: this.verdict.summary });
    }
    return { ...common, approach: { ...this.stats }, verification: this.verdict, status: 'blocked', gameOutcome: this.verdict?.verdict === 'failed' ? 'failed' : 'inconclusive', error: `P3 未通过：${this.stats.stopReason}${this.stopDetail ? `（${this.stopDetail}）` : ''}` };
  }
}
