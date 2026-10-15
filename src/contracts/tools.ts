export interface ToolPacket {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  details: { simulated: boolean; gameOutcome: 'unverified'; message: string; state: unknown };
}
export interface RegisteredTool {
  name: string; label: string; description: string; parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal: AbortSignal | undefined, id: string): Promise<ToolPacket>;
}
export interface ToolRegistry {
  simulated?: boolean; tools: RegisteredTool[]; systemPrompt: string; maxCalls: number;
  allow(name: string): string | undefined;
}
