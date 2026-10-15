import { setTimeout as delay } from 'node:timers/promises';
import { ControllerBackend } from '../mcp/controller-backend';
import { executeGamepadTool, GAMEPAD_TOOL_DEFINITIONS } from '../mcp/gamepad-skill';
import type { InputCommand, InputDebugState, InputMode } from '../contracts/input';
import type { ToolRegistry } from '../contracts/tools';
import { toPadAction } from './skills';

/** One simulated controller is shared by the task runtime and manual diagnostics. */
export class SimulatedInputController {
  readonly backend = new ControllerBackend();
  state: InputDebugState = { status: 'disconnected', mode: 'dry-run', neutral: null, message: '模拟 MCP 手柄未连接', history: [] };
  private reserved = false;
  private generation = 0;
  private polling?: ReturnType<typeof setInterval>;
  constructor(private notify: (state: InputDebugState) => void) {}
  get busy() { return this.reserved; }
  private update(message = this.state.message) {
    const controller = this.backend.getState();
    this.state = { ...this.state, controller, neutral: controller.neutral,
      status: this.state.status === 'disconnected' ? 'disconnected' : controller.neutral ? 'ready' : 'executing', message };
    this.notify(this.state);
  }
  connect(mode: InputMode = 'dry-run') {
    if (mode !== 'dry-run') throw new Error('当前仅提供模拟 MCP 手柄');
    if (this.reserved) throw new Error('任务执行期间不能连接手柄');
    this.backend.resetAll(); this.state.status = 'ready';
    this.update('模拟 MCP 手柄已连接 · 不发送真实输入');
    clearInterval(this.polling);
    this.polling = setInterval(() => {
      if (JSON.stringify(this.state.controller) !== JSON.stringify(this.backend.getState())) this.update('模拟输入已更新');
    }, 50);
    this.polling.unref();
  }
  disconnect() {
    if (this.reserved) throw new Error('请先取消当前任务');
    clearInterval(this.polling); this.polling = undefined; this.backend.resetAll();
    this.state.status = 'disconnected'; this.update('模拟 MCP 手柄已断开');
  }
  stop(reason = '用户归零') {
    this.generation++; this.backend.resetAll(); this.update(`模拟手柄已归零 · ${reason}`);
  }
  async execute(command: InputCommand) {
    if (this.reserved || this.state.status === 'disconnected') throw new Error('请连接模拟手柄，并等待模型任务结束');
    if ('tool' in command) return this.dispatch(command.tool, command.args);
    const action = toPadAction(command);
    this.state.lastCommand = command;
    return command.skill === 'press_button'
      ? this.dispatch('gamepad_press_button', { button: command.button, duration_ms: command.durationMs })
      : this.dispatch('gamepad_set_stick', { stick: 'left', x: action.leftStick!.x, y: action.leftStick!.y, duration_ms: command.durationMs });
  }
  private async dispatch(name: string, args: Record<string, unknown>) {
    const result = await executeGamepadTool(name, args, this.backend);
    if (!result.ok) throw new Error(result.message);
    this.state.lastResult = { ok: true, neutral: result.state?.neutral, status: 'executed' };
    this.state.history = [...this.state.history.slice(-99), this.state.lastResult];
    this.update(result.message); return result;
  }
  async withRun<T>(signal: AbortSignal, work: (registry: ToolRegistry) => Promise<T>, released: () => void): Promise<T> {
    if (this.reserved) throw new Error('模拟手柄控制权已被占用');
    signal.throwIfAborted();
    if (this.state.status === 'disconnected') this.connect();
    this.reserved = true; this.backend.resetAll(); const generation = ++this.generation;
    const reset = () => this.stop('任务中断');
    signal.addEventListener('abort', reset, { once: true });
    const registry: ToolRegistry = {
      maxCalls: 4,
      systemPrompt: 'You are GamePilot, a visual assistant. Describe only visible facts in the supplied image and select registered controller tools when appropriate. All controller tools modify an IN-MEMORY SIMULATION ONLY. They never operate the captured game or page. Never claim visible game changes or goal completion from simulated receipts. Acknowledge simulation in the final public reply. You may answer observation questions without calling a tool. Tools execute sequentially with a four-call budget. Do not expose private reasoning.',
      allow: () => signal.aborted || generation !== this.generation ? '运行已取消，控制权已失效' : undefined,
      tools: GAMEPAD_TOOL_DEFINITIONS.map(definition => ({ ...definition, label: definition.name,
        execute: async (args, toolSignal) => {
          const combined = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          combined.throwIfAborted(); if (generation !== this.generation) throw new Error('模拟控制权已失效');
          const result = await this.dispatch(definition.name, args);
          const duration = args.duration_ms;
          if (typeof duration === 'number') await delay(duration, undefined, { signal: combined });
          combined.throwIfAborted(); if (generation !== this.generation) throw new Error('模拟控制权已失效');
          const details = { simulated: true as const, gameOutcome: 'unverified' as const, message: result.message, state: this.backend.getState() };
          return { details, content: [{ type: 'text' as const, text: JSON.stringify(details) }] };
        },
      })),
    };
    try { return await work(registry); }
    finally {
      signal.removeEventListener('abort', reset); this.backend.resetAll(); this.reserved = false;
      this.update('运行已结束 · 模拟手柄已归零'); released();
    }
  }
  close() { this.stop('应用关闭'); clearInterval(this.polling); this.polling = undefined; }
}
