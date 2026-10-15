import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentEvent, ImportedImage, RunSummary } from '../contracts/debug';
import { redact, type ModelConfig } from '../main/model-config';

function traceSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(traceSafe);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (object.type === 'image' && typeof object.data === 'string') return { type: 'image', mimeType: object.mimeType, omittedFromTrace: true };
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, traceSafe(item)]));
  }
  return value;
}

/** Ordered append-only events. The same redacted event is used for UI and disk. */
export class RunRecorder {
  private queue = Promise.resolve();
  failure = '';
  constructor(readonly directory: string, private secret: string, private onFailure: () => void) {}
  async initialize(runId: string, image: ImportedImage | undefined, bytes: Buffer, prompt: string, timeoutMs: number, config: ModelConfig, simulated = true, conversation = false, executionMode = 'simulation') {
    await mkdir(this.directory, { recursive: false });
    const path = image?.mimeType === 'image/png' ? 'input.png' : 'input.jpg';
    if (image) await writeFile(resolve(this.directory, path), bytes, { flag: 'wx' });
    await writeFile(resolve(this.directory, 'manifest.json'), JSON.stringify(this.clean({ schemaVersion: 5, runId,
      startedAt: Date.now(), timeoutMs, prompt, simulated, gameOutcome: 'unverified',
      input: image ? { id: image.id, name: image.name, width: image.width, height: image.height, source: image.source ?? 'import',
        importedAt: image.importedAt, capturedAt: image.evidence?.capturedAt ?? null, evidence: image.evidence, path } : null,
      provider: config.provider, modelId: config.modelId, endpoint: config.baseUrl,
      observations: image ? [{ observationId: image.id, phase: 'before', path, evidence: image.evidence }] : [],
      conversation,
      piCommit: '4270522473e677ddba7b093caa0064a3df51d459', runtime: 'src/agent/runtime.mjs', inputBackend: conversation ? 'intent-routed' : simulated ? 'mcp-emulator' : executionMode === 'gamepad' ? 'vigem-xbox360' : 'win32-sendinput',
    }), null, 2), { flag: 'wx' });
  }
  async observation(image: ImportedImage, bytes: Buffer) {
    const path = `observation-${image.id}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`;
    if (image) await writeFile(resolve(this.directory, path), bytes, { flag: 'wx' });
    return path;
  }
  clean<T>(value: T): T { return redact(traceSafe(value), [this.secret]) as T; }
  append(event: AgentEvent) {
    this.queue = this.queue.then(() => appendFile(resolve(this.directory, 'events.jsonl'), JSON.stringify(event) + '\n')).catch(() => {
      if (!this.failure) { this.failure = '事件写入失败'; this.onFailure(); }
    });
  }
  async flush() { await this.queue; }
  async summary(summary: RunSummary) { await writeFile(resolve(this.directory, 'summary.json'), JSON.stringify(this.clean(summary), null, 2)); }
}
