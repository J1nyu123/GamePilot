import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { InputDebugState, InputMode, InputReply, Lease, ManualSkill } from '../contracts/input';
import { PythonGamepad } from './python-client';
import { toPadAction } from './skills';
export class ManualInputController {
  state: InputDebugState = { status: 'disconnected', mode: 'dry-run', neutral: null, message: '手柄服务未连接', history: [] };
  private pad?: PythonGamepad;
  private cancel?: AbortController;
  private done?: Promise<void>;
  private stopping?: Promise<void>;
  private disconnecting?: Promise<void>;
  private lease?: Lease;
  private guardTimer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private stopReport?: (reply: InputReply) => void;
  private stopRecorded = false;
  private agentInterrupt?: (reason: string) => void;
  constructor(private python: string, private script: string, private notify: (state: InputDebugState) => void,
    private options: { createPad?: (notify: (reply: InputReply) => void) => PythonGamepad; prepareMs?: number; guardIntervalMs?: number } = {}) {}
  get busy() { return Boolean(this.done || this.stopping || ['connecting', 'resetting'].includes(this.state.status)); }
  private update(patch: Partial<InputDebugState>) { this.state = { ...this.state, ...patch }; this.notify(this.state); }
  async connect(mode: InputMode) {
    if (this.pad || this.busy) throw new Error('请先断开当前手柄服务');
    if (!['dry-run', 'virtual-xbox'].includes(mode)) throw new Error('无效手柄模式');
    this.disposed = false; this.update({ status: 'connecting', mode, neutral: null, message: '正在连接 Python 手柄服务', python: this.python, history: [], runId: undefined, generation: undefined, lastCommand: undefined, stopReason: undefined, lastResult: undefined, cancelAckMs: undefined });
    const receive = (reply: InputReply) => {
      if (this.disposed) return;
      if (reply.event !== 'ready' && !(reply.id && !reply.event && reply.status === undefined)) this.update({ history: [...this.state.history.slice(-99), reply] });
      if (reply.event === 'action_start' && reply.generation === this.lease?.generation) this.update({ status: 'executing', neutral: false, message: '正在执行有界输入' });
      if (reply.event === 'connection_error' || reply.event === 'fatal') { this.update({ status: 'error', neutral: null, message: reply.error || '输入服务错误' }); this.agentInterrupt?.(reply.error || '输入服务错误'); }
      if (reply.event === 'watchdog') { this.update({ status: 'ready', neutral: reply.neutral === true, message: '心跳丢失，服务已中断并复位', stopReason: 'watchdog' }); this.agentInterrupt?.('手柄看门狗中断'); }
    };
    const pad = this.options.createPad ? this.options.createPad(receive) : new PythonGamepad(this.python, this.script, receive);
    this.pad = pad;
    try { await pad.start(mode); this.update({ status: 'ready', neutral: true, message: mode === 'dry-run' ? '模拟服务已连接 · 不连接设备' : '虚拟 Xbox 已连接 · 输入已归零' }); }
    catch (error) { await pad.dispose().catch(() => {}); this.pad = undefined; this.update({ status: 'error', neutral: null, message: error instanceof Error ? error.message : '连接失败' }); throw error; }
  }
  async execute(input: ManualSkill, guard?: () => Promise<void>) {
    if (!this.pad?.connected || this.busy || this.state.status !== 'ready') throw new Error('请连接服务并等待当前操作结束');
    const action = toPadAction(input), runId = randomUUID(), pad = this.pad;
    const cancellation = new AbortController(); this.cancel = cancellation; const signal = cancellation.signal;
    let finish!: () => void; this.done = new Promise<void>(resolve => { finish = resolve; });
    this.update({ status: 'preparing', runId, neutral: true, lastCommand: input, lastResult: undefined, stopReason: undefined, message: this.state.mode === 'virtual-xbox' ? '3 秒准备：请切换到选定的游戏窗口' : '准备模拟输入' });
    const work = async () => {
      try {
        this.lease = await pad.begin(runId);
        this.update({ generation: this.lease.generation });
        if (this.state.mode === 'virtual-xbox') {
          if (!guard) throw new Error('真实输入必须绑定目标窗口');
          await delay(this.options.prepareMs ?? 3000, undefined, { signal });
          if (signal.aborted) return;
          await guard(); if (signal.aborted) return;
          let checking = false;
          this.guardTimer = setInterval(() => { if (checking || signal.aborted) return; checking = true;
            void guard().catch(error => { if (!signal.aborted && this.state.runId === runId) return this.stop(error instanceof Error ? error.message : '目标窗口不可用'); }).finally(() => { checking = false; }); }, this.options.guardIntervalMs ?? 50);
        }
        if (signal.aborted) return;
        const result = await pad.execute(this.lease, [action]);
        if (signal.aborted) return;
        if (!result.ok || result.neutral !== true || result.status !== 'executed' || result.runId !== this.lease.runId || result.generation !== this.lease.generation) throw new Error(result.error || '输入未正常完成或回执租约不匹配');
        this.update({ status: 'ready', neutral: true, lastResult: result, message: '输入执行完成并已归零 · 游戏效果未经验证' });
      } catch (error) {
        if (!signal.aborted) {
          await this.stop(error instanceof Error ? error.message : '输入执行失败').catch(() => {});
        }
      } finally { cancellation.abort(); clearInterval(this.guardTimer); this.done = undefined; finish(); }
    };
    void work(); return { runId };
  }
  // One host-owned reservation covers preparation, model waits, the tool, and final reset.
  // Uses the already connected device; never creates a second virtual controller.
  async withAgent<T>(signal: AbortSignal, guard: () => Promise<void>,
    work: (execute: (skill: ManualSkill, beforeSend?: () => void) => Promise<InputReply>, ensureNeutral: () => Promise<InputReply>) => Promise<T>,
    interrupt: (reason: string) => void, report: (type: string, text: string, result?: InputReply) => void): Promise<T> {
    if (!this.pad?.connected || this.busy || this.state.status !== 'ready' || this.state.mode !== 'virtual-xbox') throw new Error('真实模型工具需先连接真实虚拟 Xbox 并等待就绪');
    const pad = this.pad, runId = randomUUID(), cancellation = new AbortController(); this.cancel = cancellation;
    let finish!: () => void; this.done = new Promise<void>(resolve => { finish = resolve; });
    this.stopRecorded = false; this.stopReport = reply => report('control_stop', '停止时延：宿主指令入口到 reset 发送和服务归零确认', reply);
    const stopForAbort = () => { cancellation.abort(); void this.stop(signal.reason instanceof Error ? signal.reason.message : 'Agent 已取消，停止输入').catch(() => {}); };
    this.agentInterrupt = reason => { if (!signal.aborted) { report('input_interrupted', reason); interrupt(reason); } };
    signal.addEventListener('abort', stopForAbort, { once: true });
    this.update({ status: 'preparing', neutral: true, runId, lastCommand: undefined, lastResult: undefined, stopReason: undefined, message: 'Agent 3 秒准备：请切换到选定的游戏窗口' });
    report('input_preparing', '真实输入模式 · 3 秒内切换到选定的游戏窗口；F8 停止整个任务');
    try {
      signal.throwIfAborted();
      this.lease = await pad.begin(runId); this.update({ generation: this.lease.generation });
      await delay(this.options.prepareMs ?? 3000, undefined, { signal });
      signal.throwIfAborted(); await guard(); signal.throwIfAborted();
      this.update({ status: 'ready', message: 'Agent 控制权已锁定 · 正在观察/决策' });
      let checking = false;
      this.guardTimer = setInterval(() => {
        if (checking || signal.aborted || cancellation.signal.aborted) return; checking = true;
        void guard().catch(error => {
          if (!signal.aborted && !cancellation.signal.aborted && this.state.runId === runId) {
            const reason = error instanceof Error ? error.message : '游戏窗口不可用';
            this.agentInterrupt?.(reason); void this.stop(reason).catch(() => {});
          }
        }).finally(() => { checking = false; });
      }, this.options.guardIntervalMs ?? 50);
      return await work(async (skill, beforeSend) => {
        signal.throwIfAborted(); cancellation.signal.throwIfAborted();
        const action = toPadAction(skill);
        await guard(); signal.throwIfAborted(); cancellation.signal.throwIfAborted();
        if (!this.lease || this.state.runId !== runId) throw new Error('Agent 控制租约已失效');
        this.update({ lastCommand: skill, message: 'Agent 正在执行真实技能' });
        beforeSend?.(); // Last synchronous freshness check after the asynchronous focus guard.
        const receipt = await pad.execute(this.lease, [action]);
        signal.throwIfAborted(); cancellation.signal.throwIfAborted();
        if (!receipt.ok || receipt.status !== 'executed' || receipt.neutral !== true || receipt.runId !== this.lease?.runId || receipt.generation !== this.lease.generation) throw new Error(receipt.error || '真实输入执行/释放未确认或回执租约不匹配');
        this.update({ status: 'ready', neutral: true, lastResult: receipt, message: 'Agent 输入已释放 · 正在等待模型总结，游戏效果未经验证' });
        return receipt;
      }, async () => {
        signal.throwIfAborted(); cancellation.signal.throwIfAborted(); await guard();
        await pad.reset(); signal.throwIfAborted(); cancellation.signal.throwIfAborted();
        this.lease = await pad.begin(runId); signal.throwIfAborted(); cancellation.signal.throwIfAborted();
        this.update({ status: 'ready', neutral: true, generation: this.lease.generation, message: '只读等待 · 手柄已归零，未发送移动输入' });
        return { ok: true, neutral: true, runId, generation: this.lease.generation };
      });
    } finally {
      signal.removeEventListener('abort', stopForAbort); this.agentInterrupt = undefined;
      cancellation.abort(); clearInterval(this.guardTimer);
      try {
        // A previous stop may still be waiting for its ACK. Do not release ownership early.
        await this.stop(signal.aborted ? 'Agent 已取消' : 'Agent 运行结束', !signal.aborted);
        report('input_released', '服务已确认输入归零 · 不是游戏目标验证', { neutral: true, generation: this.state.generation });
      } finally { this.stopReport = undefined; this.done = undefined; finish(); }
    }
  }
  async stop(reason = '用户停止', completed = false) {
    if (this.stopping) return this.stopping;
    const requested = performance.now(), requestedAt = Date.now(), phase = this.state.status;
    const wasExecuting = Boolean(this.done);
    this.cancel?.abort(); clearInterval(this.guardTimer);
    if (!this.pad?.connected) { this.update({ status: 'error', neutral: null, message: '服务不可用，无法确认复位', stopReason: reason }); throw new Error('服务不可用，无法确认复位'); }
    this.update({ status: 'resetting', neutral: null, message: '正在停止，等待服务归零确认', stopReason: reason });
    const stop = async () => {
      try { const resetSentAfterMs = performance.now() - requested;
        const reply = await this.pad!.reset(); this.lease = undefined;
        if (!completed && !this.stopRecorded && this.stopReport) { this.stopRecorded = true; this.stopReport({ ok: true, neutral: true, stopTiming: { id: randomUUID(), reason, backend: this.state.mode, requestedAt, resetSentAfterMs, ackAfterMs: performance.now() - requested, phase } }); }
        this.update({ status: 'ready', neutral: true, generation: reply.generation, cancelAckMs: reply.cancelAckMs,
          lastResult: wasExecuting && !completed ? { status: 'cancelled', ok: false, neutral: true, runId: this.state.runId, generation: reply.generation } : this.state.lastResult, message: `已停止并收到归零确认 · ${reason}` }); }
      catch (error) { this.update({ status: 'error', neutral: null, message: '停止失败，无法确认归零', stopReason: reason }); throw error; }
    };
    this.stopping = stop();
    try { await this.stopping; } finally { this.stopping = undefined; }
  }
  disconnect() {
    if (this.disconnecting) return this.disconnecting;
    this.disconnecting = this.disconnectDevice().finally(() => { this.disconnecting = undefined; });
    return this.disconnecting;
  }
  private async disconnectDevice() {
    this.cancel?.abort(); clearInterval(this.guardTimer);
    const pad = this.pad;
    if (!pad) { this.update({ status: 'disconnected', neutral: null, message: '手柄服务未连接' }); return; }
    // Keep the service alive until an in-flight begin/execute has settled.
    let error: unknown;
    try { if (pad.connected) await this.stop('断开服务'); await this.done; await pad.dispose(); }
    catch (failure) { error = failure; await pad.dispose().catch(() => {}); }
    finally { this.disposed = true; this.pad = undefined; this.lease = undefined;
      this.update({ status: 'disconnected', neutral: null, message: error ? '设备已断开；断开前复位未确认' : '已归零并断开设备' }); }
    if (error) throw error;
  }
}
