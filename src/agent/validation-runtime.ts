import type { AgentEvent, RunSummary } from '../contracts/debug';
import type { ToolRegistry } from '../contracts/tools';
// @ts-expect-error Pi transport is bundled through the pinned source resolver.
import { validate } from './runtime.mjs';
export interface ValidationOptions {
  baseUrl: string; apiKey: string; modelId: string;
  image?: { type: 'image'; data: string; mimeType: string }; prompt: string;
  maxTurns?: number; timeoutMs: number; signal: AbortSignal;
  onEvent(event: Omit<AgentEvent, 'runId'>): void;
  toolRegistry?: ToolRegistry;
  conversation?: boolean;
  visualContext?: { source: 'import' | 'window' | 'none'; supportsImages: boolean; name?: string };
  executionMode?: 'simulation' | 'keyboard' | 'gamepad';
  recordObservation?: (image: import('../contracts/debug').ImportedImage, bytes: Buffer) => Promise<void>;
}
export const runValidation = (options: ValidationOptions): Promise<RunSummary> => validate(options);
