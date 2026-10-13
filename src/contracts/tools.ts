import type { ExecutionPacket } from './verification';

export interface RegisteredTool {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal: AbortSignal | undefined, id: string): Promise<ExecutionPacket>;
}
export interface ToolRegistry {
  tools: RegisteredTool[]; systemPrompt: string; maxCalls: number;
  allow(name: string): string | undefined;
}
