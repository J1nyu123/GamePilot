import type { ApproachSpec } from '../contracts/approach';
import type { Assignment } from '../benchmarks/campaign';
import { PauseGate } from '../runtime/pause';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AgentEvent, ImportedImage, RunSnapshot, RunSummary } from '../contracts/debug';
import type { ModelConfig } from './model-config';
import type { ValidationOptions } from '../agent/validation-runtime';
import { redact } from './model-config';
import type { GoalSpec, KeyObservation, ReleaseEvidence } from '../contracts/verification';
import { checkEvidence } from '../verification/evidence';
import { freezeTask } from '../contracts/run';
import { validTaskVerification } from '../verification/task-result';

export interface RunTrace { saveObservation(image: ImportedImage, bytes: Buffer, release: ReleaseEvidence): Promise<void> }
export type Runner = (options: ValidationOptions, replaceInput: (image: ImportedImage, bytes: Buffer) => Promise<void>, trace: RunTrace) => Promise<RunSummary>;
function traceSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(traceSafe);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (object.type === 'image' && typeof object.data === 'string') return { type: 'image', mimeType: object.mimeType, storedAsKeyObservation: true };
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, traceSafe(item)]));
  }
  return value;
}
export class DebugSession {
  current: RunSnapshot | null = null;
  private active?: { controller: AbortController; done: Promise<void>; simulated: boolean };
  private pauseGate?: PauseGate;
  private controlEvent?: (type: string, text: string) => void;
  private knownRuns = new Map<string, string>();
  constructor(private runsRoot: string, private runner: Runner, private notify: (event: AgentEvent) => void) {}
  get busy() { return Boolean(this.active); }
  get controlsInput() { return this.active?.simulated === false; }
  runDirectory(id: string) { return this.current?.runId === id ? this.knownRuns.get(id) : undefined; }
  async start(image: ImportedImage, bytes: Buffer, prompt: string, timeoutMs: number, config: ModelConfig,
    execution?: { simulated: boolean; runner: Runner; goal?: GoalSpec; benchmark?: Assignment; experiment?: { kind: 'p3-approach'; spec: ApproachSpec; limits: object; strategy?: import('../contracts/run').ExecutionStrategy }; pausable?: boolean; metrics?: () => RunSummary['metrics'] }) {
    if (this.busy) throw new Error('已有运行正在进行');
    if (execution?.goal) execution = { ...execution, goal: freezeTask(execution.goal) };
    // Reserve the slot before asynchronous disk setup so concurrent IPC calls cannot both start.
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolveDone => { finish = resolveDone; });
    this.active = { controller, done, simulated: execution?.simulated ?? true };
    const runId = execution?.benchmark?.runId ?? randomUUID(), dir = resolve(this.runsRoot, runId), startedAt = Date.now();
    const simulated = execution?.simulated ?? true;
    const observations: KeyObservation[] = [];
    let fixedInput = image;
    const saveManifest = async () => writeFile(resolve(dir, 'manifest.json'), JSON.stringify(redact({ schemaVersion: execution?.experiment?.strategy ? 3 : execution?.goal ? 2 : 1, runId, startedAt, timeoutMs,
      input: { id: fixedInput.id, name: fixedInput.name, importedAt: fixedInput.importedAt, width: fixedInput.width, height: fixedInput.height, source: fixedInput.source || 'import', capturedAt: fixedInput.evidence?.capturedAt ?? null, evidence: fixedInput.evidence },
      prompt: redact(prompt, [config.apiKey]), goal: execution?.goal, task: execution?.experiment?.strategy ? execution?.goal : undefined,
      executionStrategy: execution?.experiment?.strategy,
      observations: observations.map(record => ({ observationId: record.image.id, phase: record.phase, path: record.relativePath, evidence: record.image.evidence, release: record.release })),
      benchmark: execution?.benchmark, experiment: execution?.experiment, provider: config.provider, modelId: config.modelId, endpoint: config.baseUrl, simulated,
      piCommit: '4270522473e677ddba7b093caa0064a3df51d459', runtime: execution?.experiment?.strategy === 'direct' ? 'src/runtime/approach-runner.ts' : 'runtime/p1/src/runtime.mjs',
    }, [config.apiKey]), null, 2));
    const saveObservation = async (snapshot: ImportedImage, data: Buffer, phase: 'before' | 'after', release?: ReleaseEvidence) => {
      if (!execution?.goal) return;
      controller.signal.throwIfAborted();
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(snapshot.id)) throw new Error('无效关键帧 ID');
      if (observations.some(record => record.image.id === snapshot.id)) throw new Error('关键帧 ID 重复，拒绝覆盖证据');
      await mkdir(resolve(dir, 'observations'), { recursive: true });
      const relativePath = `observations/${snapshot.id}.${snapshot.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      await writeFile(resolve(dir, relativePath), data, { flag: 'wx' });
      observations.push({ image: snapshot, phase, relativePath, release }); await saveManifest();
    };
    const saveInput = async (input: ImportedImage, data: Buffer) => {
      image = input; fixedInput = input; bytes = data;
      await writeFile(resolve(dir, image.mimeType === 'image/png' ? 'input.png' : 'input.jpg'), bytes);
      await saveManifest();
    };
    try {
      await mkdir(dir, { recursive: true });
      await saveInput(image, bytes);
    } catch (error) { this.active = undefined; finish(); throw new Error('无法建立运行记录，请检查日志目录权限'); }
    this.knownRuns.set(runId, dir);
    this.current = { runId, status: 'running', imageId: image.id, prompt, events: [], input: image, goal: execution?.goal, observations };
    let sequence = 0, queue = Promise.resolve(), logError = '';
    const emit = (event: Omit<AgentEvent, 'runId' | 'sequence'>) => {
      const clean = redact({ ...event, result: traceSafe(event.result), sequence: ++sequence, runId }, [config.apiKey]);
      if (clean.type === 'task_paused') this.current!.status = 'paused';
      if (clean.type === 'task_resumed') this.current!.status = 'running';
      this.current!.events.push(clean);
      this.notify(clean);
      queue = queue.then(() => appendFile(resolve(dir, 'events.jsonl'), JSON.stringify(clean) + '\n')).catch(() => {
        if (!logError) { logError = '事件写入失败'; controller.abort(); }
      });
    };
    this.controlEvent = (type, text) => emit({ timestamp: Date.now(), type, text });
    this.pauseGate = execution?.goal && execution.pausable !== false ? new PauseGate() : undefined;
    emit({ timestamp: Date.now(), type: 'user_message', text: prompt });
    if (image.evidence && simulated) emit({ timestamp: Date.now(), type: 'observation', observationId: image.id, evidence: image.evidence, text: '窗口新帧已固定为本次模型输入' });
    // Runtime final event is emitted by this wrapper only after summary and event writes settle.
    const task = async () => {
      let summary: RunSummary;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        let usedTurns = 0, segmentStartSequence = sequence;
        const invoke = async (segmentSignal: AbortSignal) => {
        if (usedTurns >= 4) return { status: 'budget_exceeded', simulated, gameOutcome: 'unverified', turns: usedTurns, completedTools: 0, toolErrors: 0, finalText: '', error: '恢复未重置决策预算' } as RunSummary;
        segmentStartSequence = sequence;
        const offset = usedTurns;
        return (execution?.runner ?? this.runner)({ baseUrl: config.baseUrl, apiKey: config.apiKey, modelId: config.modelId,
          image: { type: 'image', data: bytes.toString('base64'), mimeType: image.mimeType },
          prompt, timeoutMs, maxTurns: 4 - usedTurns, signal: segmentSignal,
          onEvent: event => { if (offset && event.toolCallId) event = { ...event, toolCallId: `resume-${offset}:${event.toolCallId}` }; if (event.turn) { usedTurns = Math.max(usedTurns, offset + event.turn); event = { ...event, turn: offset + event.turn }; } if (event.type !== 'validation_end') emit(event); } }, async (input, data) => {
            controller.signal.throwIfAborted(); image = input; await saveInput(input, data); await saveObservation(input, data, 'before'); controller.signal.throwIfAborted();
            this.current!.imageId = input.id; this.current!.input = input;
            emit({ timestamp: Date.now(), type: 'observation', observationId: input.id, evidence: input.evidence, text: '准备完成后重新截图，已固定为本次模型输入' });
          }, { saveObservation: async (input, data, release) => { await saveObservation(input, data, 'after', release); controller.signal.throwIfAborted(); } });
        };
        summary = this.pauseGate ? await this.pauseGate.run(controller.signal, invoke, (result, error) => {
          const lastRelease = [...this.current!.events].reverse().find(e => e.type === 'input_released');
          return (!error || error instanceof Error && error.name === 'AbortError') && result?.status !== 'failed' && (lastRelease?.sequence ?? 0) > segmentStartSequence && (lastRelease?.result as { neutral?: boolean })?.neutral === true;
        }, paused => emit({ timestamp: Date.now(), type: paused ? 'task_paused' : 'task_resumed', text: paused ? '已暂停，服务确认归零；总时间预算继续计时' : '恢复：重新准备、取新帧，保留原目标和剩余预算' })) : await invoke(controller.signal);
      } catch (error) {
        const records = this.current!.events;
        summary = { status: error instanceof Error && error.name === 'AbortError' ? 'canceled' : 'failed', simulated, gameOutcome: 'unverified',
          turns: Math.max(0, ...records.map(event => event.turn ?? 0)),
          completedTools: records.filter(event => event.type === 'tool_execution_end' && event.isError === false).length,
          toolErrors: records.filter(event => event.type === 'tool_execution_end' && event.isError === true).length,
          finalText: '', error: error instanceof Error ? error.message : 'Runtime 意外退出' };
      }
      finally { clearTimeout(timer); }
      summary = { ...summary, ...(execution?.metrics ? { metrics: execution.metrics() } : {}), turns: Math.max(summary.turns, 0, ...this.current!.events.map(e => e.turn ?? 0)), completedTools: this.current!.events.filter(e => ['tool_execution_end', 'skill_execution_end'].includes(e.type) && e.isError === false).length, toolErrors: this.current!.events.filter(e => ['tool_execution_end', 'skill_execution_end'].includes(e.type) && e.isError === true).length };
      await queue;
      const completion = (value: RunSummary): RunSummary => {
        if (!execution?.goal || value.status !== 'succeeded') return value;
        const result = value.verification, before = observations.find(record => record.phase === 'before'), after = observations.at(-1);
        const recorded = [...this.current!.events].reverse().find(event => event.type === 'verification_end')?.verification;
        if (!result || result.verdict !== 'passed' || result.goalId !== execution.goal.id || recorded?.id !== result.id || recorded.verdict !== 'passed'
          || !before || after?.phase !== 'after' || !after.release || result.releaseId !== after.release.id
          || !result.evidenceIds.includes(before.image.id) || !result.evidenceIds.includes(after.image.id)
          || checkEvidence(before.image, after.image, after.release)) return { ...value, status: 'blocked', gameOutcome: 'inconclusive', error: '完成声明缺少可核对的独立验证与关键帧证据' };
        if (value.runResult) {
          const observed = value.runResult.execution?.observations.at(-1);
          const release = [...this.current!.events].reverse().find(e => e.type === 'input_released');
          if (!validTaskVerification(result, freezeTask(execution.goal), before.image.id, after.image.id, after.release.id)
            || !observed || observed.id !== after.image.id || performance.now() > observed.validUntil
            || (release?.result as { neutral?: boolean })?.neutral !== true) return { ...value, status: 'blocked', error: '结束检查未通过：证据过期或归零未确认' };
        }
        return value;
      };
      const normalize = (value: RunSummary): RunSummary => {
        const outcome = value.runResult ? value.gameOutcome : 'unverified';
        let result = logError ? { ...value, status: 'failed' as const, gameOutcome: outcome, error: logError }
          : timedOut && value.status !== 'failed' ? { ...value, status: 'timed_out' as const, gameOutcome: outcome }
          : controller.signal.aborted && value.status !== 'failed' ? { ...value, status: 'canceled' as const, gameOutcome: outcome } : completion(value);
        if (result.runResult) result = { ...result, runResult: { ...result.runResult, status: result.status, taskOutcome: result.gameOutcome,
          stopReason: result.status !== value.status ? logError ? 'trace-error' : timedOut ? 'timeout' : controller.signal.aborted ? 'canceled' : 'completion-rejected' : result.runResult.stopReason } };
        return result;
      };
      summary = normalize(summary);
      summary = redact(summary, [config.apiKey]);
      const recordFailure = (value: RunSummary): RunSummary => ({ ...value, status: 'failed',
        gameOutcome: value.runResult ? value.gameOutcome : 'unverified', error: '运行摘要写入失败',
        ...(value.runResult ? { runResult: { ...value.runResult, status: 'failed', stopReason: 'trace-error' } } : {}) });
      try { await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2)); }
      catch { summary = recordFailure(summary); }
      const savedStatus = summary.status;
      summary = normalize(summary);
      if (summary.status !== savedStatus) await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2)).catch(() => { summary = recordFailure(summary); });
      emit({ timestamp: Date.now(), type: 'validation_end', status: summary.status, summary });
      await queue;
      const settled = normalize(summary);
      if (settled.status !== summary.status) {
        summary = settled;
        const event = { timestamp: Date.now(), sequence: ++sequence, runId, type: 'validation_end', status: summary.status, summary };
        this.current!.events.push(event); this.notify(event);
        await appendFile(resolve(dir, 'events.jsonl'), JSON.stringify(event) + '\n').catch(() => {});
        await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2)).catch(() => {});
      }
      this.current!.summary = summary; this.current!.status = summary.status;
    };
    void task().finally(() => { this.active = undefined; this.pauseGate = undefined; this.controlEvent = undefined; finish(); });
    return { runId };
  }
  pause(runId: string) {
    if (!this.active || this.current?.runId !== runId || !this.pauseGate || this.current.status !== 'running') throw new Error('仅运行中的目标验证任务支持暂停');
    this.pauseGate.request(); this.current.status = 'pausing'; this.controlEvent?.('task_pausing', '正在暂停并等待输入归零');
  }
  resume(runId: string) {
    if (!this.active || this.current?.runId !== runId || this.current.status !== 'paused') throw new Error('任务未暂停');
    this.pauseGate!.resume();
  }
  async waitForEnd() { await this.active?.done; }
  cancel(runId: string, reason = '用户取消') {
    if (!this.active || this.current?.runId !== runId) throw new Error('当前运行已结束');
    this.controlEvent?.('control_requested', reason); this.current.status = 'canceling'; this.active.controller.abort(new DOMException(reason, 'AbortError'));
  }
  cancelActive(reason = '宿主中断') { if (this.active) { if (this.current) this.current.status = 'canceling'; this.active.controller.abort(new DOMException(reason, 'AbortError')); } }
  async close() { this.active?.controller.abort(); await this.active?.done; }
}
