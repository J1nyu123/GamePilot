import { randomUUID } from 'node:crypto';
import type { ImportedImage, RunSummary } from '../contracts/debug';
import { approachLimits as limits, type ApproachSpec, type ApproachStats } from '../contracts/approach';
import { freezeTask, type ExecutionResult, type ExecutionStrategy, type TaskSpec } from '../contracts/run';
import type { GoalSpec, ExecutionPacket, VerificationRequest, VerificationResult } from '../contracts/verification';
import type { ToolRegistry } from '../contracts/tools';
import { ApproachTarget, type ApproachDependencies } from '../skills/approach-target';
import { checkEvidence } from '../verification/evidence';
import { unknownCriteria, validTaskVerification } from '../verification/task-result';
import { interruptible } from './interruptible';
import { skillTools } from '../agent/skill-tools';

export interface ApproachRunnerDependencies extends ApproachDependencies {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}
/** Owns one run's budget, verification, and stopping policy across all skill invocations. */
export class ApproachRunner {
  readonly task: TaskSpec;
  readonly stats: ApproachStats = { calls: 0, steps: 0, executedSteps: 0, observations: 0, trackingCalls: 0, corrections: 0, stopReason: 'not-started' };
  private used = { steps: 0, observations: 0 };
  private current: ImportedImage;
  private execution?: ExecutionResult;
  private verification?: VerificationResult;
  private stopReason = 'not-started';
  private running = false;
  private lastDirection?: string;
  private pendingDirection?: string;
  private stopFailure?: string;
  private activeInvocation?: Promise<ExecutionPacket>;
  private now: () => number;
  private started?: number;
  private deadline = new AbortController();
  private signal: AbortSignal;
  constructor(readonly spec: ApproachSpec, goal: GoalSpec, private initial: ImportedImage,
    private parent: AbortSignal, private deps: ApproachRunnerDependencies) {
    this.spec = Object.freeze({ ...spec, region: Object.freeze([...spec.region]) as unknown as ApproachSpec['region'] });
    this.task = freezeTask(goal, this.spec); this.current = initial;
    this.now = deps.now ?? (() => performance.now());
    this.signal = AbortSignal.any([parent, this.deadline.signal]);
  }
  get observationId() { return this.current.id; }
  private remainingMs() { return limits.timeoutMs - (this.now() - (this.started ?? this.now())); }
  allow(name: string): string | undefined {
    if (name !== 'approach_target') return '未注册的技能';
    if (this.signal.aborted) return '运行已取消或超时';
    if (this.running) return '必须等待当前技能与验证结束';
    if (this.verification?.verdict === 'passed') return '固定条件已验证，停止输入';
    if (this.execution && (this.execution.status !== 'completed' || this.verification?.verdict !== 'failed')) return '证据或安全状态不允许继续';
    if (this.used.observations + limits.stableFrames > limits.maxObservations || this.remainingMs() <= 0) return '运行预算耗尽';
  }
  private unknown(reason: string): VerificationResult {
    return { id: randomUUID(), goalId: this.task.id, taskId: this.task.id, targetId: this.task.targetId,
      releaseId: this.execution?.release?.id ?? 'no-release', evidenceIds: [this.initial.id, this.current.id], observationId: this.current.id,
      verdict: 'inconclusive', method: 'evidence-check', facts: [], summary: reason, criteria: unknownCriteria(this.task, reason) };
  }
  execute(args: Record<string, unknown>, toolSignal: AbortSignal | undefined, id: string): Promise<ExecutionPacket> {
    const alreadyRunning = this.running;
    const work = this.executeSkill(args, toolSignal, id);
    // A rejected concurrent call must not replace the invocation whose reset is still pending.
    if (!alreadyRunning) this.activeInvocation = work;
    return work;
  }
  private async executeSkill(args: Record<string, unknown>, toolSignal: AbortSignal | undefined, id: string): Promise<ExecutionPacket> {
    this.started ??= this.now();
    const rejection = this.allow('approach_target'); if (rejection) throw new Error(rejection);
    this.running = true;
    const signal = toolSignal ? AbortSignal.any([this.signal, toolSignal]) : this.signal;
    const skill = new ApproachTarget(this.spec, this.initial, signal, { ...this.deps,
      emit: (type, fields) => {
        if (type === 'approach_input') this.pendingDirection = (fields.result as { direction: string }).direction;
        if (type === 'skill_released' && this.pendingDirection) {
          if (this.lastDirection && this.lastDirection !== this.pendingDirection) this.stats.corrections++;
          this.lastDirection = this.pendingDirection; this.pendingDirection = undefined;
        }
        this.deps.emit(type, fields);
      },
      reserve: resource => { signal.throwIfAborted();
        if (this.remainingMs() <= 0 || this.used[resource] >= (resource === 'steps' ? limits.maxSteps : limits.maxObservations)) throw new Error('运行预算耗尽');
        this.used[resource]++;
      } }, { maxSteps: limits.maxSteps - this.used.steps, maxObservations: limits.maxObservations - this.used.observations,
      timeoutMs: Math.min(limits.timeoutMs, this.remainingMs()) }, this.current);
    try {
      this.execution = await skill.execute(args as { targetId: string; observationId: string }, signal, id);
      const last = this.execution.observations.at(-1); if (last) this.current = last.image;
      this.stopReason = this.execution.stopReason;
      if (this.execution.arrivalCandidate && this.execution.release && last) {
        this.deps.emit('verification_start', { toolCallId: id, observationId: last.id, text: 'Runner 独立验证固定标准与连续新帧' });
        try {
          this.verification = await interruptible(this.deps.verify({ goal: this.task, task: this.task, before: this.initial,
            after: this.current, release: this.execution.release, observations: this.execution.observations.slice(-limits.stableFrames), signal, now: this.now }), signal);
          signal.throwIfAborted();
          const known = new Set([this.initial.id, ...this.execution.observations.map(o => o.id)]);
          if (!validTaskVerification(this.verification, this.task, this.initial.id, last.id, this.execution.release.id)
            || this.verification.observedAt !== last.observedAt || this.verification.evidenceIds.some(id => !known.has(id))) {
            this.verification = this.unknown('验证身份、逐项标准或证据引用不一致'); this.stopReason = 'invalid-verification';
          } else this.stopReason = 'verification-' + this.verification.verdict;
        } catch (error) {
          signal.throwIfAborted();
          this.verification = this.unknown(`验证依赖失败：${error instanceof Error ? error.message : '未知错误'}`); this.stopReason = 'verification-error';
        }
        this.deps.emit('verification_end', { toolCallId: id, verification: this.verification });
      }
      const details = { simulated: false as const, execution: this.execution.stopReason, verification: this.verification,
        observationId: this.current.id, receipt: this.execution.receipt, gameOutcome: this.verification?.verdict ?? 'unverified' };
      return { details, content: [{ type: 'text', text: JSON.stringify(details) }, { type: 'image', data: this.current.dataUrl.split(',')[1], mimeType: this.current.mimeType }] };
    } finally {
      for (const key of ['calls', 'steps', 'executedSteps', 'observations', 'trackingCalls'] as const) this.stats[key] += skill.stats[key];
      this.stats.stopReason = skill.stats.stopReason; this.running = false;
      this.deps.emit('runner_execution', { toolCallId: id, result: { ...this.stats }, text: '运行累计技能与预算记录' });
    }
  }
  registry(): ToolRegistry {
    return skillTools(this.task, this.current.id, [{ name: 'approach_target', label: '固定目标反馈技能', description: '有限短移与新帧纠偏，返回执行结果及 Runner 的独立验证。重试共用运行预算。',
        parameters: { type: 'object', properties: { targetId: { type: 'string', const: this.spec.targetId }, observationId: { type: 'string' } }, required: ['targetId', 'observationId'], additionalProperties: false },
        execute: (args, signal, id) => this.execute(args, signal, id) }], Math.floor(limits.maxObservations / limits.stableFrames), name => this.allow(name));
  }
  async run(strategy: ExecutionStrategy, agent?: (registry: ToolRegistry) => Promise<RunSummary>): Promise<RunSummary> {
    if (this.started !== undefined) throw new Error('同一 Runner 只启动一次');
    this.started = this.now();
    const timer = setTimeout(() => this.deadline.abort(), limits.timeoutMs);
    let base: RunSummary = { status: 'incomplete', simulated: false, gameOutcome: 'unverified', turns: 0, completedTools: 0, toolErrors: 0, finalText: '' };
    const stop = () => { void this.deps.stop('Runner 取消或预算超时').catch(() => {}); };
    this.signal.addEventListener('abort', stop, { once: true });
    try {
      if (strategy === 'agent') {
        if (!agent) throw new Error('Agent 执行适配器缺失');
        base = await interruptible(agent(this.registry()), this.signal);
      } else {
        while (!this.allow('approach_target')) {
          const id = `direct-${this.stats.calls + 1}`;
          this.deps.emit('skill_execution_start', { toolCallId: id, toolName: 'approach_target', args: { targetId: this.spec.targetId, observationId: this.current.id } });
          const packet = await this.execute({ targetId: this.spec.targetId, observationId: this.current.id }, undefined, id);
          this.deps.emit('skill_execution_end', { toolCallId: id, toolName: 'approach_target', result: packet.details, isError: false });
        }
      }
    } catch (error) {
      base = { ...base, status: this.parent.aborted ? 'canceled' : this.deadline.signal.aborted ? 'timed_out' : 'failed',
        error: error instanceof Error ? error.message : '执行依赖失败' };
    } finally {
      await this.activeInvocation?.catch(() => {});
      clearTimeout(timer); this.signal.removeEventListener('abort', stop);
      if (this.signal.aborted) await this.deps.stop('Runner 已结束').catch(error => { this.stopFailure = String(error); base = { ...base, status: 'failed', error: this.stopFailure }; });
    }
    return this.finish(base, strategy);
  }
  /** Rechecked after the input controller releases its reservation. Never rewrites a valid historical verdict. */
  finish(base: RunSummary, strategy: ExecutionStrategy, neutralConfirmed = true): RunSummary {
    const last = this.execution?.observations.at(-1), verification = this.verification;
    const fresh = !!last && this.now() >= last.observedAt && this.now() <= last.validUntil;
    const valid = !!verification && !!last?.release && validTaskVerification(verification, this.task, this.initial.id, last.id, last.release.id)
      && !checkEvidence(this.initial, last.image, last.release);
    let status: RunSummary['status'] = 'blocked';
    if (!neutralConfirmed || this.stopFailure || base.status === 'failed' && (strategy === 'direct' || !verification)) { status = 'failed'; this.stopReason = neutralConfirmed && !this.stopFailure ? 'execution-error' : 'release-unconfirmed'; }
    else if (this.parent.aborted) { status = 'canceled'; this.stopReason = 'canceled'; }
    else if (this.deadline.signal.aborted || this.remainingMs() <= 0) { status = 'timed_out'; this.stopReason = 'timeout'; }
    else if (this.execution?.status === 'failed') { status = 'failed'; this.stopReason = this.execution.stopReason; }
    else if (valid && verification!.verdict === 'passed' && fresh) { status = 'succeeded'; this.stopReason = 'verified'; }
    else if (verification?.verdict === 'passed' && !fresh) this.stopReason = 'stale-verification';
    else if (this.execution?.status === 'budget-exhausted' || this.used.observations + limits.stableFrames > limits.maxObservations) { status = 'budget_exceeded'; this.stopReason = this.execution?.status === 'budget-exhausted' ? this.execution.stopReason : 'observation-budget'; }
    const outcome = verification?.verdict ?? 'unverified';
    const agentSummaryError = base.runResult?.agentSummaryError ?? (!base.runResult && strategy === 'agent' && base.status !== 'control_passed' ? base.error ?? `Agent 总结状态：${base.status}` : undefined);
    const result: RunSummary = { ...base, status, gameOutcome: outcome, approach: { ...this.stats }, verification,
      ...(strategy === 'direct' ? { completedTools: this.stats.calls } : {}),
      error: status === 'succeeded' ? undefined : base.error ?? `运行停止：${this.stopReason}${this.execution?.detail ? `（${this.execution.detail}）` : ''}`,
      runResult: { status, taskOutcome: outcome, stopReason: this.stopReason, strategy, verification,
        execution: this.execution ? { ...this.execution, observations: this.execution.observations.map(({ image: _image, ...record }) => record) } : undefined, agentSummaryError,
        finishedAt: this.now(), clock: 'main-monotonic', budget: { ...this.used, elapsedMs: this.now() - (this.started ?? this.now()) } } };
    this.deps.emit('runner_end', { result: result.runResult, text: `运行 ${status}；任务 ${outcome}；停止原因 ${this.stopReason}` });
    return result;
  }
}
