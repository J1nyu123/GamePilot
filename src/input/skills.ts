import type { ManualSkill, PadAction, XboxButton } from '../contracts/input';
export const buttons: XboxButton[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START', 'LS', 'RS', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'];
export function toPadAction(input: ManualSkill): PadAction {
  if (!input || !Number.isInteger(input.durationMs) || input.durationMs < 20 || input.durationMs > 1500) throw new Error('动作时长必须为 20–1500 毫秒');
  if (input.skill === 'press_button') {
    if (!buttons.includes(input.button)) throw new Error('不支持的 Xbox 按钮');
    return { buttons: [input.button], durationMs: input.durationMs };
  }
  if (input.skill !== 'move_for' || !['left', 'right', 'forward', 'backward'].includes(input.direction) || !Number.isFinite(input.strength) || input.strength <= 0 || input.strength > 1) throw new Error('移动参数无效');
  const x = input.direction === 'left' ? -input.strength : input.direction === 'right' ? input.strength : 0;
  const y = input.direction === 'forward' ? input.strength : input.direction === 'backward' ? -input.strength : 0;
  return { buttons: [], durationMs: input.durationMs, leftStick: { x, y } };
}
