# 模拟手柄 MCP

当前 MCP 只维护内存状态，不连接 Python、ViGEm 或真实 Xbox。Electron Runtime、手动诊断和独立 stdio 服务复用 tool-definitions.ts、gamepad-skill.ts、controller-backend.ts。

六种工具：
- gamepad_press_button
- gamepad_release_button
- gamepad_set_stick（左右摇杆及完整 X/Y 矢量）
- gamepad_set_trigger（左右扳机）
- gamepad_reset_all
- gamepad_get_state

参数在输入写入之前统一验证，拒绝未知字段、非法按钮、NaN、越界轴值及非法时长。显式 duration_ms 为 20–5000ms，省略时由最长 10 秒看门狗归零。重复写入同一轴或按钮会替换原定时器。

Electron 每次任务持有独占模拟控制权。任务工具顺序执行；参数流不直接执行。取消、超时与任务结束会归零所有按钮、摇杆和扳机，并清除定时器，然后发布结束事件。手动诊断支持全部六种工具，模型任务期间不能手动操作。

独立 stdio 服务运行 npm run mcp:gamepad。它有自己的内存状态，与 Electron 进程不会共享设备状态；两者使用相同实现。外部 MCP 客户端应在 GamePilot 根目录运行 node --import tsx src/mcp/gamepad-mcp-server.ts。

所有回执描述模拟控制器状态，不代表被捕获的游戏/页面发生变化。
