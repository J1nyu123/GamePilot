import { REAL_GAMEPAD_TOOLS } from './gamepad-loop';
import { GAME_TOOL_DEFINITIONS } from './game-loop';
import { GAMEPAD_TOOL_DEFINITIONS } from '../mcp/tool-definitions';
import type { ExecutionMode } from '../contracts/debug';

/** Descriptive metadata only: creating this catalog never connects or executes a tool. */
export function toolCapabilities(mode: ExecutionMode = 'simulation') {
  const keyboard = mode === 'keyboard', gamepad = mode === 'gamepad';
  return {
    executionMode: mode,
    currentStage: 'chat-intent-routing',
    toolsCallableInCurrentStage: false,
    taskTools: (gamepad ? REAL_GAMEPAD_TOOLS : keyboard ? GAME_TOOL_DEFINITIONS : GAMEPAD_TOOL_DEFINITIONS).map(({ name, description, parameters }) => ({ name, description, parameters })),
    activation: '只有明确的游戏操作意图才进入工具执行阶段；询问工具清单、参数或 MCP 属于聊天，不执行工具。',
    backend: gamepad ? 'Pi 调用 Python vgamepad，通过本机 ViGEmBus 创建真实 Xbox 360 XInput 设备；不是 MCP 连接。连接状态需由宿主确认。' : keyboard ? 'Pi 直接调用宿主 Windows SendInput；不是独立 MCP 连接。'
      : 'Pi 直接调用与 MCP 服务共享的内存手柄实现；未连接独立 MCP 服务，不影响真实游戏。',
    requirements: (keyboard || gamepad) ? '需要启动实时窗口预览；导入图片仅可观察，不能据此操作真实游戏。' : '模拟任务需要游戏窗口画面或导入图片。',
    limits: gamepad ? { maxActions: 4, maxToolCalls: 12, durationMs: [20, 1000], maxButtons: 4, simulatedOnly: false } : keyboard ? { maxActions: 4, maxToolCalls: 12, durationMs: [20, 1000], maxSimultaneousKeys: 3 }
      : { maxToolCalls: 4, simulatedOnly: true },
    observation: '只读观察阶段由宿主发送导入图片或窗口截图，不开放动作工具。',
    otherMode: gamepad ? '其他可选模式：simulation 仅内存模拟；keyboard 为真实键盘。当前模式使用 capture_game 和 gamepad_action。' : keyboard ? '切换为 simulation 后可使用 6 个模拟手柄工具，当前模式不开放它们。'
      : '切换为 keyboard 后可使用 capture_game 和 keyboard_action，当前模式不开放它们。',
    standaloneMcp: '项目提供 npm run mcp:gamepad 独立模拟手柄 MCP 服务；存在该入口不代表当前桌面已连接它。',
    unsupported: [ '鼠标点击或移动工具', '终端或任意代码执行', '浏览器或联网搜索工具'],
  };
}
