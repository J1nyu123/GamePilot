import { z } from 'zod';
import { XBOX_BUTTONS } from '../mcp/tool-definitions';
import { GAME_TOOL_DEFINITIONS, gameLoopRegistry, type GameLoopHost } from './game-loop';

const schema = z.object({
  buttons: z.array(z.enum(XBOX_BUTTONS)).max(4).refine(a => new Set(a).size === a.length).optional(),
  left_x: z.number().min(-1).max(1).optional(), left_y: z.number().min(-1).max(1).optional(),
  right_x: z.number().min(-1).max(1).optional(), right_y: z.number().min(-1).max(1).optional(),
  left_trigger: z.number().min(0).max(1).optional(), right_trigger: z.number().min(0).max(1).optional(),
  duration_ms: z.number().int().min(20).max(1000),
}).strict();
export const GAMEPAD_ACTION = {
  name: 'gamepad_action', label: '真实手柄动作并观察',
  description: 'Send a bounded Xbox 360 report through ViGEmBus, release all controls, then return a fresh screenshot. Positive Y is up. Missing axes/buttons are neutral.',
  parameters: { type: 'object', properties: {
    buttons: { type: 'array', items: { type: 'string', enum: [...XBOX_BUTTONS] }, maxItems: 4, uniqueItems: true },
    ...Object.fromEntries(['left_x', 'left_y', 'right_x', 'right_y'].map(k => [k, { type: 'number', minimum: -1, maximum: 1 }])),
    ...Object.fromEntries(['left_trigger', 'right_trigger'].map(k => [k, { type: 'number', minimum: 0, maximum: 1 }])),
    duration_ms: { type: 'integer', minimum: 20, maximum: 1000 },
  }, required: ['duration_ms'], additionalProperties: false },
};
export const REAL_GAMEPAD_TOOLS = [GAME_TOOL_DEFINITIONS[0], GAMEPAD_ACTION];
export function gamepadLoopRegistry(host: { capture: GameLoopHost['capture']; act(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> }, signal: AbortSignal) {
  return gameLoopRegistry({ capture: host.capture, act: async () => { throw new Error('Keyboard unavailable in gamepad mode'); } }, signal,
    { definition: GAMEPAD_ACTION, validate: args => { schema.parse(args); }, execute: host.act });
}
