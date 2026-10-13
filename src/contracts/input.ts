export type InputMode = 'dry-run' | 'virtual-xbox';
export type XboxButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'BACK' | 'START' | 'LS' | 'RS' | 'DPAD_UP' | 'DPAD_DOWN' | 'DPAD_LEFT' | 'DPAD_RIGHT';
export interface PadAction { buttons: XboxButton[]; durationMs: number; leftStick?: { x: number; y: number }; rightStick?: { x: number; y: number }; leftTrigger?: number; rightTrigger?: number }
export type ManualSkill = { skill: 'move_for'; direction: 'left' | 'right' | 'forward' | 'backward'; strength: number; durationMs: number }
  | { skill: 'press_button'; button: XboxButton; durationMs: number };
export interface Lease { runId: string; generation: number }
export interface InputReply { stopTiming?: { id: string; reason: string; backend: InputMode; requestedAt: number; resetSentAfterMs: number; ackAfterMs: number; phase: string };  id?: string; event?: string; ok?: boolean; protocol?: number; backend?: InputMode; generation?: number; runId?: string; neutral?: boolean;
  status?: 'executed' | 'cancelled' | 'error'; error?: string; executed?: { index: number; durationMs: number }[]; durationMs?: number; index?: number; reason?: string; appliedCount?: number }
export interface InputDebugState {
  status: 'disconnected' | 'connecting' | 'ready' | 'preparing' | 'executing' | 'resetting' | 'error'; mode: InputMode;
  neutral: boolean | null; message: string; runId?: string; generation?: number; python?: string; lastResult?: InputReply;
  cancelAckMs?: number; stopReason?: string; history: InputReply[];
  lastCommand?: ManualSkill;
}
export const inputChannels = { connect: 'input:connect', disconnect: 'input:disconnect', execute: 'input:execute', stop: 'input:stop', state: 'input:state', update: 'input:update' } as const;
