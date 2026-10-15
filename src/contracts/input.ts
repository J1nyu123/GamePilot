import type { ControllerState } from '../mcp/controller-backend';
import type { XboxButton } from '../mcp/tool-definitions';
export type { XboxButton };
export type InputMode = 'dry-run';
export interface PadAction { buttons: XboxButton[]; durationMs: number; leftStick?: { x: number; y: number }; rightStick?: { x: number; y: number }; leftTrigger?: number; rightTrigger?: number }
export type ManualSkill = { skill: 'move_for'; direction: 'left' | 'right' | 'forward' | 'backward'; strength: number; durationMs: number }
  | { skill: 'press_button'; button: XboxButton; durationMs: number };
export type InputCommand = ManualSkill | { tool: string; args: Record<string, unknown> };
export interface InputReply {
  id?: string; event?: string; ok?: boolean; backend?: InputMode; generation?: number; runId?: string; neutral?: boolean;
  status?: 'executed' | 'cancelled' | 'error'; error?: string; durationMs?: number; reason?: string;
}
export interface InputDebugState {
  status: 'disconnected' | 'connecting' | 'ready' | 'preparing' | 'executing' | 'resetting' | 'error'; mode: InputMode;
  neutral: boolean | null; message: string; runId?: string; generation?: number; lastResult?: InputReply;
  history: InputReply[]; lastCommand?: ManualSkill; controller?: ControllerState;
}
export const inputChannels = { connect: 'input:connect', disconnect: 'input:disconnect', execute: 'input:execute', stop: 'input:stop', state: 'input:state', update: 'input:update' } as const;
