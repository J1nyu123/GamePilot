import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ImportedImage, RunSummary } from '../contracts/debug';
import type { InputReply, ManualSkill } from '../contracts/input';
import type { GoalSpec, ReleaseEvidence, ToolPacket, VerificationRequest, VerificationResult } from '../contracts/verification';
import { checkEvidence } from '../verification/evidence';
import { toPadAction } from '../input/skills';

export interface SupervisorDependencies {
  execute(skill: ManualSkill): Promise<InputReply>; neutral(): Promise<InputReply>;
  capture(signal: AbortSignal): Promise<ImportedImage>;
  save(image: ImportedImage, release: ReleaseEvidence): Promise<void>;
  verify(input: VerificationRequest): Promise<VerificationResult>;
  emit(type: string, fields: { text?: string; toolCallId?: string; observationId?: string; release?: ReleaseEvidence; verification?: VerificationResult; durationMs?: number }): void;
  now?: () => number;
}
function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Operation aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export interface SupervisorBudget { moves: number; waits: number; attempts: number; observations: number; verifierCalls: number; verdict?: VerificationResult }
export const newSupervisorBudget = (): SupervisorBudget => ({ moves: 0, waits: 0, attempts: 0, observations: 1, verifierCalls: 0 });
export class RuntimeSupervisor {
  readonly goal: GoalSpec;
  private current: ImportedImage;
  private observedAt: number;
  private get verdict() { return this.budget.verdict; }
  private set verdict(value: VerificationResult | undefined) { this.budget.verdict = value; }
  private get moves() { return this.budget.moves; }
  private set moves(value: number) { this.budget.moves = value; }
  private get waits() { return this.budget.waits; }
  private set waits(value: number) { this.budget.waits = value; }
  private get attempts() { return this.budget.attempts; }
  private set attempts(value: number) { this.budget.attempts = value; }
  private get observations() { return this.budget.observations; }
  private set observations(value: number) { this.budget.observations = value; }
  private get verifierCalls() { return this.budget.verifierCalls; }
  private set verifierCalls(value: number) { this.budget.verifierCalls = value; }
  private now: () => number;
  constructor(goal: GoalSpec, private initial: ImportedImage, private signal: AbortSignal, private deps: SupervisorDependencies, private budget: SupervisorBudget = newSupervisorBudget(), current: ImportedImage = initial) {
    if (!goal.successCondition.trim() || goal.successCondition.length > 2000) throw new Error('必须提供固定的可见成功条件');
    this.goal = Object.freeze({ ...goal }); this.current = current; this.now = deps.now ?? (() => performance.now()); this.observedAt = this.now();
  }
  allow(name: string): string | undefined {
    if (this.signal.aborted) return '任务已取消';
    if (this.verdict?.verdict === 'passed') return '目标已验证，拒绝追加动作';
    if (this.attempts >= 5) return '验证预算已耗尽';
    if (name === 'move_for') {
      if (this.moves >= 2) return '最多两次移动，拒绝继续输入';
      if (this.verdict?.verdict === 'inconclusive') return '证据不足，禁止盲目移动；可尝试只读等待';
      if (this.now() - this.observedAt > 15000) return '决策截图已过期，禁止输入；可尝试只读等待';
    } else if (name === 'wait_for_state') { if (this.waits >= 1) return '只读等待预算已耗尽'; }
    else return '未注册的游戏工具';
  }
  private assertAllowed(name: string) { this.signal.throwIfAborted(); const reason = this.allow(name); if (reason) throw new Error(reason); }
  private release(receipt: InputReply): ReleaseEvidence {
    if (!receipt.ok || receipt.neutral !== true || (receipt.status && receipt.status !== 'executed')) throw new Error('输入释放未确认，拒绝截图及验证');
    const source = this.initial.evidence;
    if (!source) throw new Error('缺少绑定的游戏窗口');
    return { id: randomUUID(), receipt, sourceId: source.sourceId, identity: source.identity, captureGeneration: source.generation, receivedAt: Date.now(), order: 'release-ack-then-capture' };
  }
  private unknown(release: ReleaseEvidence, text: string, after?: ImportedImage): VerificationResult {
    return { id: randomUUID(), goalId: this.goal.id, verdict: 'inconclusive', summary: text,
      evidenceIds: after ? [this.initial.id, after.id] : [this.initial.id], facts: [], method: 'evidence-check', releaseId: release.id };
  }
  private async observe(release: ReleaseEvidence, signal: AbortSignal, toolCallId: string): Promise<ImportedImage | undefined> {
    const started = this.now(); this.attempts++;
    this.deps.emit('observation_post_start', { toolCallId, release, text: '输入释放已确认，正在建立动作后新帧屏障' });
    let after: ImportedImage | undefined;
    try { after = await interruptible(this.deps.capture(signal), signal); }
    catch (error) {
      this.signal.throwIfAborted();
      this.verdict = this.unknown(release, signal.aborted ? '条件等待到期，没有可验证的新证据' : `新帧获取失败：${error instanceof Error ? error.message : '未知异常'}`);
    }
    if (after) {
      this.signal.throwIfAborted(); signal.throwIfAborted();
      await this.deps.save(after, release); this.observations++;
      this.deps.emit('observation_post', { toolCallId, observationId: after.id, release, text: '动作后关键帧已保存' });
      const invalid = checkEvidence(this.current, after, release);
      if (invalid) this.verdict = this.unknown(release, invalid, after);
      else {
        this.current = after; this.observedAt = this.now();
        this.deps.emit('verification_start', { toolCallId, observationId: after.id, text: '独立验证固定成功条件，不采信 Planner 完成声明' });
        this.verifierCalls++;
        try { this.verdict = await interruptible(this.deps.verify({ goal: this.goal, before: this.initial, after, release, signal }), signal); }
        catch (error) {
          this.signal.throwIfAborted();
          this.verdict = this.unknown(release, signal.aborted ? '条件等待到期，验证未完成' : `验证异常：${error instanceof Error ? error.message : '未知异常'}`, after);
        }
        if (this.verdict.goalId !== this.goal.id || this.verdict.releaseId !== release.id || !this.verdict.evidenceIds.includes(after.id) || !this.verdict.evidenceIds.includes(this.initial.id)) this.verdict = this.unknown(release, '验证引用与固定目标或截图不一致', after);
      }
    }
    this.signal.throwIfAborted();
    if (!this.verdict) throw new Error('验证结果缺失');
    this.verdict = { ...this.verdict, durationMs: Math.max(0, this.now() - started) };
    this.deps.emit('verification_end', { toolCallId, verification: this.verdict, durationMs: this.verdict.durationMs });
    return after;
  }
  private packet(execution: string, after?: ImportedImage, receipt?: InputReply): ToolPacket {
    if (!this.verdict) throw new Error('验证结果缺失');
    const details = { simulated: false as const, receipt, verification: this.verdict, observationId: after?.id, execution };
    return { details, content: [{ type: 'text', text: JSON.stringify(details) },
      ...(after ? [{ type: 'image' as const, data: after.dataUrl.split(',')[1], mimeType: after.mimeType }] : [])] };
  }
  async move(args: { direction: 'left' | 'right' | 'forward' | 'backward'; durationMs: number }, toolSignal: AbortSignal | undefined, id: string): Promise<ToolPacket> {
    this.assertAllowed('move_for');
    const signal = toolSignal ? AbortSignal.any([this.signal, toolSignal]) : this.signal; signal.throwIfAborted();
    const skill = { skill: 'move_for' as const, ...args, strength: .5 }; toPadAction(skill);
    this.moves++;
    const receipt = await interruptible(this.deps.execute(skill), signal); signal.throwIfAborted();
    const release = this.release(receipt); this.deps.emit('skill_released', { toolCallId: id, release, text: '技能已执行并释放，尚未验证游戏目标' });
    const after = await this.observe(release, signal, id);
    return this.packet('executed', after, receipt);
  }
  async wait(args: { timeoutMs: number }, toolSignal: AbortSignal | undefined, id: string): Promise<ToolPacket> {
    this.assertAllowed('wait_for_state');
    if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 500 || args.timeoutMs > 10000) throw new Error('等待预算需为 500–10000ms');
    const parent = toolSignal ? AbortSignal.any([this.signal, toolSignal]) : this.signal; parent.throwIfAborted(); this.waits++;
    const release = this.release(await this.deps.neutral()); parent.throwIfAborted();
    const deadline = new AbortController(), signal = AbortSignal.any([parent, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(), args.timeoutMs);
    let after: ImportedImage | undefined;
    try {
      for (let i = 0; i < 3 && this.attempts < 5 && !signal.aborted; i++) {
        after = await this.observe(release, signal, id);
        if (this.verdict?.verdict === 'passed' || signal.aborted) break;
        if (i < 2) await delay(500, undefined, { signal });
      }
    } catch (error) { parent.throwIfAborted(); if (!deadline.signal.aborted) throw error; }
    finally { clearTimeout(timer); }
    parent.throwIfAborted();
    if (!this.verdict) { this.verdict = this.unknown(release, '等待预算已耗尽，没有验证结论'); this.deps.emit('verification_end', { toolCallId: id, verification: this.verdict }); }
    return this.packet(this.verdict.verdict === 'passed' ? 'condition_met' : deadline.signal.aborted ? 'condition_timeout' : 'observation_budget_exhausted', after);
  }
  finalize(base: RunSummary): RunSummary {
    const metrics = { moves: this.moves, waits: this.waits, observations: this.observations, verifierCalls: this.verifierCalls };
    const common = { ...base, metrics, verification: this.verdict };
    if (this.signal.aborted) return { ...common, status: 'canceled', gameOutcome: 'unverified' };
    if (['failed', 'canceled', 'timed_out'].includes(base.status)) return { ...common, gameOutcome: 'unverified' };
    const fresh = this.now() - this.observedAt <= 15000;
    if (base.status === 'control_passed' && this.verdict?.verdict === 'passed' && fresh) return { ...common, status: 'succeeded', gameOutcome: 'passed' };
    return { ...common, status: 'blocked', gameOutcome: !fresh || this.verdict?.verdict === 'passed' ? 'inconclusive' : this.verdict?.verdict ?? 'unverified',
      error: !fresh ? '目标验证证据已过期，拒绝完成' : this.verdict?.summary ?? base.error ?? '没有独立目标验证，拒绝完成' };
  }
}
