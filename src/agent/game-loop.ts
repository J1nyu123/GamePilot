import type { ToolRegistry, ToolPacket, RegisteredTool } from '../contracts/tools';

export interface GameObservation { id: string; data: string; mimeType: string }
export interface GameLoopHost {
  capture(signal: AbortSignal): Promise<GameObservation>;
  act(keys: string[], durationMs: number, signal: AbortSignal): Promise<unknown>;
}
export const GAME_KEYS = ['W', 'A', 'S', 'D', 'E', 'F', 'Q', 'R', 'SPACE', 'SHIFT', 'ESC', 'ENTER', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;

export const GAME_TOOL_DEFINITIONS = [
  { name: 'capture_game', label: '观察游戏画面', description: 'Capture a fresh game window image before planning.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'keyboard_action', label: '执行并观察', description: 'Hold game keys for 20–1000 ms, release them, then capture and return the resulting image for verification.',
        parameters: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string', enum: [...GAME_KEYS] }, minItems: 1, maxItems: 3 }, duration_ms: { type: 'integer', minimum: 20, maximum: 1000 } }, required: ['keys', 'duration_ms'], additionalProperties: false } }
];

/** Every successful action returns a fresh image to the same model conversation. */
export function gameLoopRegistry(host: GameLoopHost, signal: AbortSignal, action?: {
  definition: Omit<RegisteredTool, 'execute'>;
  validate(args: Record<string, unknown>): void;
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}): ToolRegistry {
  let observed = false, actions = 0;
  const packet = (image: GameObservation, message: string, state: unknown): ToolPacket => ({
    details: { simulated: false, gameOutcome: 'unverified', message, state },
    content: [{ type: 'text', text: JSON.stringify({ message, observationId: image.id, state, simulated: false }) },
      { type: 'image', data: image.data, mimeType: image.mimeType }],
  });
  return {
    simulated: false, maxCalls: 12,
    systemPrompt: `You are GamePilot, a visual game agent. Follow the user's instruction using visible evidence and registered tools.
First call capture_game to inspect the current scene. State a short public plan naming the visible target and next action, not private reasoning.
For movement instructions, call ${action?.definition.name ?? 'keyboard_action'} with a short bounded step. ${action ? 'Xbox controls: left stick for movement, right stick for camera; infer button functions from the game. Positive stick Y is up/forward. This is a REAL virtual Xbox 360 gamepad, not the in-memory simulator.' : 'Standard controls: WASD movement, SPACE jump, E/F interact, arrows camera if supported by game.'} Do not invent controls or unseen targets.
Each action releases keys and automatically returns a NEW screenshot. Compare that image with the previous image, explain observable progress, then adjust the next step or stop.
Use at most 4 actions. If target is missing, input fails, or progress is unclear, say so. Do not equate tool success with achieving the goal.
Give a final Chinese response explaining actions, observed result and whether the goal is reached, not reached, or uncertain. Do not claim Lumine-level game competence.`,
    allow: () => signal.aborted ? '任务已取消' : undefined,
    tools: [
      { ...GAME_TOOL_DEFINITIONS[0],
        execute: async (_args, toolSignal) => {
          const combined = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          combined.throwIfAborted(); const image = await host.capture(combined); combined.throwIfAborted(); observed = true;
          return packet(image, '当前游戏画面，请识别目标并规划下一步。', { phase: 'observe' });
        } },
      { ...(action?.definition ?? GAME_TOOL_DEFINITIONS[1]),
        execute: async (args, toolSignal) => {
          const combined = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          combined.throwIfAborted();
          if (!observed) throw new Error('必须先调用 capture_game 观察当前画面');
          if (actions >= 4) throw new Error('动作预算已耗尽，请总结现有画面');
          if (action) action.validate(args); else validateKeys(args.keys, args.duration_ms); actions++;
          const receipt = action ? await action.execute(args, combined) : await host.act(args.keys as string[], args.duration_ms as number, combined);
          combined.throwIfAborted(); const image = await host.capture(combined); combined.throwIfAborted();
          return packet(image, '动作已释放；这是动作后的新截图。请比较前后画面，判断进展并反馈结果。', { phase: 'after_action', receipt, action: actions });
        } },
    ],
  };
}
export function validateKeys(keys: unknown, duration: unknown): asserts keys is string[] {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 3 || new Set(keys).size !== keys.length || keys.some(k => !GAME_KEYS.includes(k))) throw new Error('无效游戏按键');
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 20 || duration > 1000) throw new Error('动作时间必须为 20–1000 ms');
}
