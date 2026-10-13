# P3 开发交付检查

日期：2026-10-13。

结论：首个 `approach_target` 反馈实验的实现、自动测试和受控桌面联测已完成。真实《塞尔达传说：旷野之息》目标定位精度、至少 5 次重复接近、异常场景及冻结原型对照仍待实机验收。P4 实机验收也仍未完成。

## 交付内容

- 独立“P3 目标接近实验”模式；默认模拟模式不变。
- 固定目标、归一化目标区域、面积占比及附加可见条件，完整保存在 manifest。
- 独立 VLM 目标定位，显式状态版本、observationId、置信度来源和 8 秒有效期。
- 最多 8 段 200ms、力度 0.35 的动作；每段归零后取新帧，根据目标位置选择下一段。
- 连续两帧保持屏幕条件后执行独立验证；拒绝 Planner 声明、过期结论或异常退出伪造成功。
- 丢失/低置信度/场景变化/过期/超时停止；发输入前在焦点检查之后再次检查状态有效期。
- UI 反馈卡、关键帧与状态追溯、只读 `audit:p3`、实机实验记录模板。P4 报告拒绝 P3 记录。

Pi 调度仍复用 `GamePilot-p1/src/runtime.mjs`，只新增宿主注入的实验工具分支，没有复制 Agent 循环。目标定位 transport 在 GamePilot 内部通过既有固定版本 pi-ai 运行，没有新增依赖。

## 自动验证

| 项目 | 结果 |
| --- | --- |
| TypeScript / 生产构建 | 通过 |
| P3 技能、状态和停止保护 | 21/21 |
| P3 真实 Pi + 本地模型协议 | 6/6 |
| 原有基础、采集、输入、会话、验证 | 41/41 |
| Pi 输入 / 目标验证集成 | 10/10 + 10/10 |
| 原运行审计 | 19/19 |
| P4 批次、暂停和故障 | 11/11 |
| Python / P1 Runtime | 4/4 + 11/11 |

共 133 项自动测试通过。另执行普通 Electron UI、联合 P2-C/P2-D/P4/P3 桌面联测和独立 P3 桌面联测。使用非游戏窗口、模拟定位/验证端点和注入的 Python dry-run，不发送真实手柄动作。

## 桌面证据

`artifacts/p3-agent-ui-check.json` 保存三类结果：

- 成功样例：左移 → 新帧 → 前移 → 两帧保持 → 独立验证。2 段执行归零、4 次定位、1 次已确认方向修正，最终 succeeded/passed。
- 丢失样例：执行 1 段后目标丢失，最终 blocked/inconclusive，没有第二段盲移。
- 定位取消：定位请求卡住时取消，最终 canceled/unverified、服务确认归零，零动作。

正例 trace 的 P3 审计通过且 `feedbackDemonstrated=true`；`testData=true`。联测还把测试 trace 的发送前状态年龄改为 8000ms，确认审计拒绝，再恢复该临时测试记录；没有修改真实历史运行。

截图：`artifacts/p3-approach.png`。可逐帧复核的测试 trace：`artifacts/p3-sample-trace/`。所有测试产物明确保留 testOnly/physicalInputVerified=false 标记。

## 使用与验收

重启应用后选择“P3 目标接近实验”。操作、参数约定、保护条件及命令见 [P3 使用说明](p3-approach-target.md)。按 `benchmarks/p3-experiment-template.md` 固定场景并记录所有实机结果；不能把上述模拟定位成功率作为游戏实验成功率。
