import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentEvent, ImportedImage } from '../contracts/debug';
import type { InputReply, ManualSkill } from '../contracts/input';
import type { ReleaseEvidence } from '../contracts/verification';
import type { ExecutionResult, Observation } from '../contracts/run';
import { approachLimits as limits, type ApproachSpec, type ApproachStats, type TargetState } from '../contracts/approach';
import { TargetEstimator, stateRejection, approachDecision } from '../state/target-estimator';
import { checkEvidence } from '../verification/evidence';

export interface ApproachDependencies {
  execute(skill: ManualSkill, beforeSend: () => void): Promise<InputReply>;
  neutral(): Promise<InputReply>; stop(reason: string): Promise<void>;
  capture(signal: AbortSignal): Promise<ImportedImage>;
  save(image: ImportedImage, release: ReleaseEvidence): Promise<void>;
  tracker: TargetEstimator;
  emit(type: string, fields: Partial<AgentEvent>): void;
  now?: () => number;
  reserve?(resource: 'steps' | 'observations'): void;
}
export interface ApproachAllocation { maxSteps: number; maxObservations: number; timeoutMs: number }
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
  private stopDetail?: string;
  private current: ImportedImage;
  private release?: ReleaseEvidence;
  private observations: Observation[] = [];
  private now: () => number;
  constructor(readonly spec: ApproachSpec, private initial: ImportedImage, private parent: AbortSignal, private deps: ApproachDependencies,
    private allocation: ApproachAllocation = { maxSteps: limits.maxSteps, maxObservations: limits.maxObservations, timeoutMs: limits.timeoutMs }, current = initial) {
    this.current = current; this.now = deps.now ?? (() => performance.now());
    if (allocation.maxSteps < 0 || allocation.maxSteps > limits.maxSteps || allocation.maxObservations < 1
      || allocation.maxObservations > limits.maxObservations || allocation.timeoutMs <= 0 || allocation.timeoutMs > limits.timeoutMs) throw new Error('技能额度超出固定上限');
  }
  private released(receipt: InputReply): ReleaseEvidence {
    const source = this.initial.evidence;
    if (!source || receipt.ok !== true || receipt.neutral !== true || receipt.status && receipt.status !== 'executed') throw new Error('P3 输入释放未确认');
    return { id: randomUUID(), receipt, sourceId: source.sourceId, identity: source.identity, captureGeneration: source.generation, receivedAt: Date.now(), order: 'release-ack-then-capture' };
  }
  async execute(args: { targetId: string; observationId: string }, toolSignal: AbortSignal | undefined, toolCallId: string): Promise<ExecutionResult> {
    this.parent.throwIfAborted();
    if (this.stats.calls) throw new Error('同一技能实例只允许执行一次');
    if (!args || Object.keys(args).some(k => !['targetId', 'observationId'].includes(k)) || args.targetId !== this.spec.targetId || args.observationId !== this.current.id) throw new Error('P3 工具引用不是固定目标或最新规划截图');
    this.stats.calls++;
    const parent = toolSignal ? AbortSignal.any([this.parent, toolSignal]) : this.parent;
    const deadline = new AbortController(), signal = AbortSignal.any([parent, deadline.signal]);
    const started = this.now();
    const timer = setTimeout(() => deadline.abort(), this.allocation.timeoutMs);
    let stopPromise: Promise<void> | undefined;
    const stop = () => { stopPromise ??= this.deps.stop('P3 反馈技能取消或超时'); void stopPromise.catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    let state: TargetState | undefined, previousState: TargetState | undefined;
    let stable = 0, stableSince = 0, lastDirection: string | undefined;
    const assertTime = () => { signal.throwIfAborted(); if (this.now() - started >= this.allocation.timeoutMs) throw new Blocked('timeout'); };
    try {
      assertTime();
      this.release = this.released(await abortable(this.deps.neutral(), signal));
      for (;;) {
        assertTime();
        if (this.stats.observations >= this.allocation.maxObservations) throw new Blocked('observation-budget');
        this.deps.reserve?.('observations');
        const previous = this.current;
        const observedAt = this.now();
        const image = await abortable(this.deps.capture(signal), signal); assertTime();
        const invalid = checkEvidence(previous, image, this.release!);
        if (invalid) throw new Blocked('invalid-frame');
        await abortable(this.deps.save(image, this.release!), signal); assertTime();
        this.current = image; this.stats.observations++;
        this.observations.push({ id: image.id, source: image.source, image, observedAt,
          validUntil: observedAt + limits.completionMaxAgeMs, clock: 'main-monotonic', release: this.release });
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
        if (this.stats.steps >= this.allocation.maxSteps) throw new Blocked('step-budget');
        const basedOn = state;
        const beforeSend = () => {
          assertTime();
          const invalid = stateRejection(basedOn, this.spec, this.current.id, this.now());
          if (invalid) throw new Blocked(invalid);
        };
        beforeSend(); this.deps.reserve?.('steps'); this.stats.steps++;
        const skill: ManualSkill = { skill: 'move_for', direction, durationMs: limits.stepMs, strength: limits.strength };
        this.deps.emit('approach_step', { toolCallId, observationId: image.id, result: { stateVersion: state.version, ...skill }, text: `短移动 ${direction} ${limits.stepMs}ms，随后归零并重新观察` });
        const receipt = await abortable(this.deps.execute(skill, () => { beforeSend(); this.deps.emit('approach_input', { toolCallId, observationId: image.id, result: { stateVersion: basedOn.version, ageMs: this.now() - observedAt, ...skill }, text: '发送前再次通过状态有效期检查' }); }), signal); assertTime();
        this.release = this.released(receipt); this.stats.executedSteps++;
        if (lastDirection && lastDirection !== direction) this.stats.corrections++;
        lastDirection = direction;
        this.deps.emit('skill_released', { toolCallId, release: this.release, text: 'P3 分段动作已确认执行并归零' });
      }
      assertTime();
      this.stats.stopReason = 'arrival-candidate';
    } catch (error) {
      if (parent.aborted) { this.stats.stopReason = 'canceled'; stop(); await stopPromise; this.deps.emit('approach_end', { toolCallId, result: { ...this.stats }, text: 'P3 已取消并停止输入' }); throw new DOMException('P3 已取消', 'AbortError'); }
      if (deadline.signal.aborted || error instanceof Blocked) {
        this.stats.stopReason = deadline.signal.aborted ? 'timeout' : (error as Blocked).reason;
      } else if (error instanceof Error && error.message === 'P3 输入释放未确认') { stop(); await stopPromise; throw error; }
      else { this.stats.stopReason = 'dependency-error'; this.deps.emit('approach_fault', { toolCallId, text: error instanceof Error ? error.message.slice(0, 500) : '反馈依赖调用失败' }); }
      stop(); await stopPromise;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      if (stopPromise) await stopPromise;
    }
    parent.throwIfAborted();
    this.deps.emit('approach_end', { toolCallId, result: { ...this.stats }, text: `P3 反馈技能结束：${this.stats.stopReason}` });
    return { status: this.stats.stopReason === 'arrival-candidate' ? 'completed' : this.stats.stopReason === 'dependency-error' ? 'failed'
      : ['step-budget', 'observation-budget', 'timeout'].includes(this.stats.stopReason) ? 'budget-exhausted' : 'blocked',
      stopReason: this.stats.stopReason, arrivalCandidate: this.stats.stopReason === 'arrival-candidate',
      evidenceIds: this.observations.map(o => o.id), observations: this.observations,
      release: this.release, receipt: this.release?.receipt, stats: { ...this.stats }, detail: this.stopDetail };
  }
}
