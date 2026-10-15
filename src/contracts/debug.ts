import type { ApproachStats } from './approach';
import type { ModelConnectionInfo, ModelConnectionInput, ConnectionStatus } from './model-connection';
import type { CaptureState, FrameEvidence, GameWindow } from './capture';
import type { InputDebugState, InputMode, InputCommand } from './input';
import type { GoalSpec, KeyObservation, ReleaseEvidence, VerificationResult, Verdict } from './verification';
export type RunStatus = 'idle' | 'running' | 'canceling' | 'pausing' | 'paused' | 'completed' | 'protocol_passed' | 'control_passed' | 'succeeded' | 'blocked' | 'failed' | 'canceled' | 'timed_out' | 'budget_exceeded' | 'incomplete';
export type ExecutionMode = 'simulation' | 'keyboard' | 'gamepad';
export interface ImportedImage {
  id: string; name: string; path: string; importedAt: number; mimeType: 'image/png' | 'image/jpeg';
  width: number; height: number; size: number; dataUrl: string;
  source?: 'import' | 'window'; evidence?: FrameEvidence;
}
export interface ConfigSummary {
  status: 'ready' | 'missing' | 'invalid'; modelId: string; provider: string;
  configPath: string; message: string; endpoint?: string; connectionStatus?: ConnectionStatus; supportsImages?: boolean;
}
export interface RunSummary {
  status: Exclude<RunStatus, 'idle' | 'running' | 'canceling' | 'pausing' | 'paused'>; simulated: boolean; gameOutcome: 'unverified' | Verdict;
  turns: number; completedTools: number; toolErrors: number; finalText: string; error?: string;
  intent?: 'chat' | 'observe' | 'act' | 'clarify';
  // Historical trace fields, used only by retained display components.
  approach?: ApproachStats; verification?: VerificationResult;
  runResult?: { status: RunStatus; taskOutcome: 'unverified' | Verdict; stopReason: string; strategy?: 'direct' | 'agent' };
}
export interface AgentEvent {
  runId: string; sequence: number; timestamp: number; type: string; turn?: number;
  text?: string; toolCallId?: string; toolName?: string; args?: Record<string, unknown>;
  durationMs?: number; isError?: boolean; result?: unknown; error?: string; summary?: RunSummary;
  status?: RunStatus; stopReason?: string; warning?: string;
  diagnostics?: { contentTypes: string[]; textChars: number; thinkingChars: number; toolCallCount: number;
    tokenUsage?: { input: number; output: number; reasoning?: number; total: number } };
  modelId?: string; maxTokens?: number; thinkingMode?: string;
  observationId?: string; evidence?: FrameEvidence; simulated?: boolean;
  verification?: VerificationResult; release?: ReleaseEvidence;
}
export interface RunSnapshot {
  runId: string; status: RunStatus; imageId: string; prompt: string; events: AgentEvent[];
  summary?: RunSummary; input?: ImportedImage; observations?: KeyObservation[]; goal?: GoalSpec;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DebugApi {
  getModelConnection(): Promise<Result<ModelConnectionInfo>>;
  saveModelConnection(input: ModelConnectionInput): Promise<Result<ModelConnectionInfo>>;
  testModelConnection(): Promise<Result<ModelConnectionInfo>>;
  resetModelConnection(): Promise<Result<ModelConnectionInfo>>;
  getRuntimeCapabilities(): Promise<Result<{ realMovement: boolean; maxRealTools: number; simulatedMcp: true }>>;
  getInputState(): Promise<Result<InputDebugState>>;
  connectInput(mode: InputMode): Promise<Result<null>>;
  disconnectInput(): Promise<Result<null>>;
  executeInput(command: InputCommand): Promise<Result<unknown>>;
  stopInput(): Promise<Result<null>>;
  onInput(callback: (state: InputDebugState) => void): () => void;
  getConfig(): Promise<Result<ConfigSummary>>;
  importImage(): Promise<Result<ImportedImage | null>>;
  connectGamepad(): Promise<Result<{ connected: boolean }>>;
  disconnectGamepad(): Promise<Result<null>>;
  sendMessage(input: { prompt: string; timeoutMs: number; executionMode?: ExecutionMode }): Promise<Result<{ runId: string }>>;
  startRun(input: { imageId: string; prompt: string; timeoutMs: number; executionMode?: ExecutionMode }): Promise<Result<{ runId: string }>>;
  cancelRun(runId: string): Promise<Result<null>>;
  openLogs(runId: string): Promise<Result<null>>;
  getSnapshot(): Promise<Result<RunSnapshot | null>>;
  onEvent(callback: (event: AgentEvent) => void): () => void;
  listWindows(): Promise<Result<GameWindow[]>>;
  startPreview(sourceId: string): Promise<Result<null>>;
  stopPreview(): Promise<Result<null>>;
  captureFrame(): Promise<Result<ImportedImage>>;
  getCaptureState(): Promise<Result<CaptureState>>;
  onCapture(callback: (state: CaptureState) => void): () => void;
}
export const channels = { gamepadConnect: 'gamepad:connect', gamepadDisconnect: 'gamepad:disconnect', message: 'debug:message', capabilities: 'debug:capabilities', config: 'debug:config', image: 'debug:image', start: 'debug:start', cancel: 'debug:cancel', logs: 'debug:logs', snapshot: 'debug:snapshot', event: 'debug:event' } as const;
export const captureChannels = { list: 'capture:list', start: 'capture:start', stop: 'capture:stop', frame: 'capture:frame', state: 'capture:state', update: 'capture:update' } as const;
