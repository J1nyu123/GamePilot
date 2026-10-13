import type { AgentEvent, RunSummary } from '../contracts/debug';
import type { InputReply } from '../contracts/input';
import type { ToolPacket } from '../contracts/verification';
import type { ToolRegistry } from '../contracts/tools';
// Bundle the already-tested implementation with its pinned local Pi dependencies.
// @ts-expect-error External P1 .mjs has no declarations; typed boundary maintained here.
import { validate } from '../../runtime/p1/src/runtime.mjs';
export interface ValidationOptions {
  baseUrl: string; apiKey: string; modelId: string;
  image: { type: 'image'; data: string; mimeType: string }; prompt: string;
  maxTurns?: number; timeoutMs: number; signal: AbortSignal; onEvent(event: Omit<AgentEvent, 'runId'>): void;
  movement?: (args: { direction: 'left' | 'right' | 'forward' | 'backward'; durationMs: number }, signal?: AbortSignal) => Promise<InputReply>;
  toolRegistry?: ToolRegistry;
  verifiedTools?: {
    goal: string; allow(name: string): string | undefined;
    move(args: { direction: 'left' | 'right' | 'forward' | 'backward'; durationMs: number }, signal: AbortSignal | undefined, id: string): Promise<ToolPacket>;
    wait(args: { timeoutMs: number }, signal: AbortSignal | undefined, id: string): Promise<ToolPacket>;
  };
}
export const runValidation = (options: ValidationOptions): Promise<RunSummary> => validate(options);
