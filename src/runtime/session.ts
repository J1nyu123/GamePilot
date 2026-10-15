import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AgentEvent, ImportedImage, RunSnapshot, RunSummary } from '../contracts/debug';
import type { ModelConfig } from '../main/model-config';
import type { ValidationOptions } from '../agent/validation-runtime';
import { RunRecorder } from '../trace/recorder';

export type Runner = (options: ValidationOptions) => Promise<RunSummary>;
export class DebugSession {
  current: RunSnapshot | null = null;
  private active?: { controller: AbortController; done: Promise<void> };
  private controlEvent?: (text: string) => void;
  private directory?: string;
  constructor(private runsRoot: string, private runner: Runner, private notify: (event: AgentEvent) => void) {}
  get busy() { return Boolean(this.active); }
  runDirectory(id: string) { return this.current?.runId === id ? this.directory : undefined; }
  async start(image: ImportedImage | undefined, bytes: Buffer, prompt: string, timeoutMs: number, config: ModelConfig, executionMode: 'simulation' | 'keyboard' | 'gamepad' = 'simulation', conversation = false) {
    const simulated = executionMode === 'simulation';
    if (this.busy) throw new Error('已有运行正在进行');
    const controller = new AbortController(); let finish!: () => void;
    const done = new Promise<void>(resolveDone => { finish = resolveDone; });
    this.active = { controller, done };
    const runId = randomUUID(), directory = resolve(this.runsRoot, runId);
    const recorder = new RunRecorder(directory, config.apiKey, () => controller.abort());
    try { await mkdir(this.runsRoot, { recursive: true }); await recorder.initialize(runId, image, bytes, prompt, timeoutMs, config, simulated, conversation, executionMode); }
    catch { this.active = undefined; finish(); throw new Error('无法建立运行记录，请检查日志目录权限'); }
    this.directory = directory;
    this.current = { runId, status: 'running', imageId: image?.id ?? '', prompt, input: image, events: [],
      observations: image ? [{ image, phase: 'before', relativePath: image.mimeType === 'image/png' ? 'input.png' : 'input.jpg' }] : [] };
    let sequence = 0;
    const emit = (event: Omit<AgentEvent, 'runId' | 'sequence'>) => {
      const clean = recorder.clean({ ...event, sequence: ++sequence, runId });
      this.current!.events.push(clean); recorder.append(clean);
      try { this.notify(clean); } catch { /* Renderer closure cannot interrupt persistence. */ }
    };
    this.controlEvent = text => emit({ timestamp: Date.now(), type: 'control_requested', text, simulated });
    emit({ timestamp: Date.now(), type: 'user_message', text: prompt });
    if (image) emit({ timestamp: Date.now(), type: 'observation', observationId: image.id, evidence: image.evidence, text: '本次模型输入已固定并保存' });
    const task = async () => {
      let summary: RunSummary, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        summary = await this.runner({ baseUrl: config.baseUrl, apiKey: config.apiKey, modelId: config.modelId,
          image: image ? { type: 'image', data: bytes.toString('base64'), mimeType: image.mimeType } : undefined, prompt, timeoutMs, conversation,
          maxTurns: executionMode !== 'simulation' ? 10 : 4, signal: controller.signal, executionMode,
          recordObservation: async (observed, data) => {
            controller.signal.throwIfAborted();
            const relativePath = await recorder.observation(observed, data);
            controller.signal.throwIfAborted();
            const first = !this.current!.input;
            if (first) { this.current!.input = observed; this.current!.imageId = observed.id; }
            this.current!.observations!.push({ image: observed, phase: first ? 'before' : 'after', relativePath });
            emit({ timestamp: Date.now(), type: first ? 'observation' : 'observation_post', observationId: observed.id, evidence: observed.evidence, simulated, text: '新截图已保存并回传模型' });
          },
          onEvent: event => { if (event.type !== 'validation_end') emit(event); } });
      } catch (error) {
        summary = { status: error instanceof Error && error.name === 'AbortError' ? 'canceled' : 'failed',
          simulated, gameOutcome: 'unverified', turns: 0, completedTools: 0, toolErrors: 0,
          finalText: '', error: error instanceof Error ? error.message : 'Runtime 意外退出' };
      } finally { clearTimeout(timer); }
      const records = this.current!.events;
      summary = { ...summary, simulated, gameOutcome: 'unverified',
        turns: Math.max(summary.turns, 0, ...records.map(e => e.turn ?? 0)),
        completedTools: records.filter(e => e.type === 'tool_execution_end' && e.isError === false).length,
        toolErrors: records.filter(e => e.type === 'tool_execution_end' && e.isError === true).length };
      const normalize = (value: RunSummary): RunSummary => recorder.failure ? { ...value, status: 'failed', error: recorder.failure }
        : timedOut && value.status !== 'failed' ? { ...value, status: 'timed_out' }
        : controller.signal.aborted && value.status !== 'failed' ? { ...value, status: 'canceled' } : value;
      const save = async () => {
        summary = recorder.clean(normalize(summary));
        try { await recorder.summary(summary); }
        catch { summary = { ...summary, status: 'failed', error: '运行摘要写入失败' }; }
      };
      await recorder.flush(); await save();
      let published = summary.status;
      emit({ timestamp: Date.now(), type: 'validation_end', status: summary.status, summary });
      await recorder.flush();
      const settled = normalize(summary);
      if (settled.status !== published) {
        summary = settled; await save(); published = summary.status;
        emit({ timestamp: Date.now(), type: 'validation_end', status: summary.status, summary });
        await recorder.flush();
      }
      this.current!.summary = summary; this.current!.status = summary.status;
    };
    void task().catch(error => {
      this.current!.status = 'failed';
      this.current!.summary = { status: 'failed', simulated, gameOutcome: 'unverified', turns: 0, completedTools: 0,
        toolErrors: 0, finalText: '', error: error instanceof Error ? error.message : '运行记录失败' };
    }).finally(() => { this.active = undefined; this.controlEvent = undefined; finish(); });
    return { runId };
  }
  cancel(runId: string, reason = '用户取消') {
    if (!this.active || this.current?.runId !== runId) throw new Error('当前运行已结束');
    this.controlEvent?.(reason); this.current.status = 'canceling';
    this.active.controller.abort(new DOMException(reason, 'AbortError'));
  }
  cancelActive(reason = '宿主中断') {
    if (!this.active) return;
    if (this.current) this.current.status = 'canceling';
    this.active.controller.abort(new DOMException(reason, 'AbortError'));
  }
  async waitForEnd() { await this.active?.done; }
  async close() { this.cancelActive('应用关闭'); await this.waitForEnd(); }
}
