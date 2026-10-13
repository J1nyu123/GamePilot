import type { ApproachSpec, ApproachStats } from './approach';
import type { Assignment } from '../benchmarks/campaign';
export type RunStatus = 'idle' | 'running' | 'canceling' | 'pausing' | 'paused' | 'protocol_passed' | 'control_passed' | 'succeeded' | 'blocked' | 'failed' | 'canceled' | 'timed_out' | 'budget_exceeded' | 'incomplete';
export type ExecutionMode = 'simulation' | 'virtual-xbox' | 'verified-xbox' | 'approach-xbox';
export interface ImportedImage {
  id: string; name: string; path: string; importedAt: number; mimeType: 'image/png' | 'image/jpeg';
  width: number; height: number; size: number; dataUrl: string;
  source?: 'import' | 'window'; evidence?: FrameEvidence;
}
export interface ConfigSummary {
  status: 'ready' | 'missing' | 'invalid'; modelId: string; provider: string;
  configPath: string; message: string; endpoint?: string;
}
export interface RunSummary {
  status: Exclude<RunStatus, 'idle' | 'running' | 'canceling' | 'pausing' | 'paused'>; simulated: boolean; gameOutcome: 'unverified' | Verdict;
  turns: number; completedTools: number; toolErrors: number; finalText: string; error?: string;
  approach?: ApproachStats; verification?: VerificationResult; metrics?: { moves: number; waits: number; observations: number; verifierCalls: number };
  runResult?: import('./run').RunResult;
}
export interface AgentEvent {
  runId: string; sequence: number; timestamp: number; type: string; turn?: number;
  text?: string; toolCallId?: string; toolName?: string; args?: Record<string, unknown>;
  durationMs?: number; isError?: boolean; result?: unknown; error?: string; summary?: RunSummary;
  status?: RunStatus; stopReason?: string; warning?: string;
  diagnostics?: { contentTypes: string[]; textChars: number; thinkingChars: number; toolCallCount: number;
    tokenUsage?: { input: number; output: number; reasoning?: number; total: number } };
  modelId?: string; maxTokens?: number; thinkingMode?: string;
  observationId?: string; evidence?: FrameEvidence;
  simulated?: boolean;
  verification?: VerificationResult; release?: ReleaseEvidence;
}
export interface RunSnapshot { runId: string; status: RunStatus; imageId: string; prompt: string; events: AgentEvent[]; summary?: RunSummary; input?: ImportedImage; observations?: KeyObservation[]; goal?: GoalSpec }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DebugApi {
  getP4Assignment(campaignId: string): Promise<Result<Assignment | null>>;
  getRuntimeCapabilities(): Promise<Result<{ realMovement: boolean; maxRealTools: number; goalVerification?: boolean; targetApproach?: boolean }>>;
  getInputState(): Promise<Result<InputDebugState>>;
  connectInput(mode: InputMode): Promise<Result<null>>;
  disconnectInput(): Promise<Result<null>>;
  executeInput(skill: ManualSkill): Promise<Result<{ runId: string }>>;
  stopInput(): Promise<Result<null>>;
  onInput(callback: (state: InputDebugState) => void): () => void;
  getConfig(): Promise<Result<ConfigSummary>>;
  importImage(): Promise<Result<ImportedImage | null>>;
  startRun(input: { imageId: string; prompt: string; timeoutMs: number; executionMode?: ExecutionMode; successCondition?: string; benchmark?: Assignment; approach?: Omit<ApproachSpec, 'targetId'>; executionStrategy?: import('./run').ExecutionStrategy }): Promise<Result<{ runId: string }>>;
  pauseRun(runId: string): Promise<Result<null>>;
  resumeRun(runId: string): Promise<Result<null>>;
  takeoverRun(runId: string): Promise<Result<null>>;
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
export const channels = { p4: 'debug:p4', pause: 'debug:pause', resume: 'debug:resume', takeover: 'debug:takeover', capabilities: 'debug:capabilities', config: 'debug:config', image: 'debug:image', start: 'debug:start', cancel: 'debug:cancel', logs: 'debug:logs', snapshot: 'debug:snapshot', event: 'debug:event' } as const;
import type { CaptureState, FrameEvidence, GameWindow } from './capture';
import type { InputDebugState, InputMode, ManualSkill } from './input';
import type { GoalSpec, KeyObservation, ReleaseEvidence, VerificationResult, Verdict } from './verification';
export const captureChannels = { list: 'capture:list', start: 'capture:start', stop: 'capture:stop', frame: 'capture:frame', state: 'capture:state', update: 'capture:update' } as const;
