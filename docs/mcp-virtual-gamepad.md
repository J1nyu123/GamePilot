# Zero-Prior Virtual Gamepad MCP Tool & Skill

A production-grade, zero-prior virtual Xbox 360 controller tool implementing the official **Model Context Protocol (MCP)** specification. Designed for Autonomous AI Game Agents (such as Zelda: Breath of the Wild players, robotics, or game automation) to execute raw physical controller inputs without domain-specific gameplay heuristics.

---

## 1. 核心设计原则 (Zero Game Priors)

1. **绝对零先验（Zero Game Semantics）**：
   - 工具名及参数中**没有任何游戏专用动词**（无 `attack`, `dodge`, `climb`, `jump`, `walk_to` 等）。
   - 只暴露纯净的硬件级物理操作：按键按下、按键释放、摇杆连续模拟量偏转 `[-1.0, 1.0]`、扳机深度 `[0.0, 1.0]`、限时保持以及硬件归零。
   - AI Agent 必须自行理解视觉画面并将意图转化为物理按键与轴矢量的序列组合。

2. **安全看门狗（Hardware Auto-Neutral Watchdog）**：
   - 任何带有 `duration_ms` 的操作会在到达时限后自动硬件归零。
   - 所有持续按下的操作均受最长 10 秒看门狗监控，防止大模型中断或异常退出导致按键粘连或角色坠崖。
   - 提供最高优先级的 `gamepad_reset_all` 应急归零指令。

3. **双层驱动架构（Dual-Layer Architecture）**：
   - **Windows 实机模式**：基于成熟开源驱动 **ViGEmBus / vgamepad**（Xbox 360 虚拟手柄驱动），被 Cemu、Steam 及所有 PC 游戏无缝识别为原生硬件手柄。
   - **沙箱/跨平台模式**：在 Linux 云容器、CI 环境及 Web 调试界面中自动平滑降级为内存级手柄仿真器。

---

## 2. 工具列表 (MCP Tool Definitions)

| 工具名称 | 参数 | 说明 |
| :--- | :--- | :--- |
| `gamepad_press_button` | `button`: Xbox 按键枚举<br>`duration_ms` (可选): 20~5000 毫秒 | 按下指定按键。若指定持续时间，则在到期后自动释放；若省略则持续按住。 |
| `gamepad_release_button` | `button`: Xbox 按键枚举 | 释放指定按键回弹至未按下状态。 |
| `gamepad_set_stick` | `stick`: `'left'` \| `'right'`<br>`x`: `-1.0` ~ `1.0`<br>`y`: `-1.0` ~ `1.0`<br>`duration_ms` (可选): 20~5000 毫秒 | 偏转左/右模拟摇杆。若指定持续时间，到期后自动回中至 `(0, 0)`。 |
| `gamepad_set_trigger` | `trigger`: `'left'` \| `'right'`<br>`value`: `0.0` ~ `1.0`<br>`duration_ms` (可选): 20~5000 毫秒 | 压下左扳机 (LT) 或右扳机 (RT)。若指定持续时间，到期后自动释放回 `0.0`。 |
| `gamepad_reset_all` | 无 | **安全复位**：立刻释放所有按键、摇杆回中、扳机归零。 |
| `gamepad_get_state` | 无 | 获取当前手柄实时状态快照（已按按键、摇杆坐标、扳机量、是否安全居中）。 |

### 支持的物理按键列表 (`XBOX_BUTTONS`)
- 基础功能键：`A`, `B`, `X`, `Y`
- 缓冲肩键：`LB`, `RB`
- 系统与菜单键：`BACK`, `START`
- 摇杆下压键：`LS` (左摇杆下压), `RS` (右摇杆下压)
- 方向十字键：`DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`

---

## 3. 启动与集成指南

### A. 作为标准 MCP 服务使用 (Claude Desktop / Cursor / Cline)

在客户端的 MCP 配置文件（例如 `claude_desktop_config.json` 或 Cursor 设置）中添加：

```json
{
  "mcpServers": {
    "virtual-gamepad": {
      "command": "node",
      "args": ["--import", "tsx", "<项目根目录>/src/mcp/gamepad-mcp-server.ts"]
    }
  }
}
```

或者使用 npm script 启动：
```bash
npm run mcp:gamepad
```

### B. 在 Node.js / TypeScript Agent 中作为原生 Skill 使用

```typescript
import { ControllerBackend } from './src/mcp/controller-backend';
import { GAMEPAD_TOOL_DEFINITIONS, executeGamepadTool } from './src/mcp/gamepad-skill';

const controller = new ControllerBackend();

// 1. 将 GAMEPAD_TOOL_DEFINITIONS 传给 OpenAI / Gemini / Claude 工具声明列表
const tools = GAMEPAD_TOOL_DEFINITIONS;

// 2. 当大模型触发工具调用时：
const result = await executeGamepadTool('gamepad_press_button', {
  button: 'A',
  duration_ms: 200,
}, controller);

console.log(result.message); // Button 'A' pressed for 200ms (auto-release scheduled).
```

### C. 自动化单元测试验证

运行专项单元测试以验证零先验约束与硬件归零时序：
```bash
npm run test:mcp
```
