# 模块职责与渐进解耦实施记录

日期：2026-10-14。实施仓库：`D:\work\GamePilot`。七步软件迁移已完成；自动测试及受控桌面联测通过，不代表固定起点 P3 重复实验或 P4 正式实机验收通过。

## 代码迁移

| 步骤 | 落地位置 | 行为与兼容 |
| --- | --- | --- |
| 1 公共契约 | `src/contracts/run.ts`、`verification.ts`、`tools.ts` | TaskSpec 深冻结目标及逐项标准；Observation 记录单调时钟有效期；ExecutionResult 与 RunResult 分开。旧字段保留，readRunResult 读取旧摘要，不从执行回执推断成功。 |
| 2 独立 Verifier | `src/verification/verifier.ts`、`task-result.ts`、`runtime/p1/src/verifier-model.mjs` | 复用 GameVerifier；先检查窗口、新帧、释放、连续证据及有效期，再发独立视觉请求。逐项判定引用证据，聚合三态；多条件任务不能只返回口头成功。未发视觉请求明确记 evidence-check。单条件旧响应仍有适配。 |
| 3 收窄 Skill | `src/skills/approach-target.ts` | 不接收 Goal/Agent 总结，不调用 Verifier，没有 finalize。保留有限短移、目标丢失保护、状态有效期、取消及归零；连续保持只产生 arrival-candidate。 |
| 4 提取 Runner | `src/runtime/approach-runner.ts`、`real-execution.ts`、`src/main/session.ts` | IPC 中真实执行编排移入应用服务。Runner 统一技能调度、取证、独立验证、取消与完成检查。8 段 × 200ms、12 次取帧尝试、60 秒跨调用累计；失败后继续不重置。最终输入释放和日志落盘后再次检查完成声明。 |
| 5 Agent 可选 | `src/agent/skill-tools.ts`、`validation-runtime.ts`、`runtime/p1/src/runtime.mjs` | Pi runtime 接收通用工具注册，不再内置 P3 工具或提示词。P3 Agent 与 direct 使用同一 Runner/Verifier。Agent 每轮最多一个工具，引用最新观察；总结失败单独记录。保留 P1/P2 入口。 |
| 6 Experiment | `src/experiments/approach.ts`、现有 `src/benchmarks/campaign.ts` | P3 配置、固定起点说明、重复试次、基线标签与统计独立于具体 Agent；通过注入的 Runner 服务运行试次。每次复位由操作者/调用方明确确认，失败试次保留。P4 冻结计划、35 个试次及人工复核门槛保持不变。 |
| 7 审计与 UI | `src/trace/`、`src/renderer/`、`src/contracts/debug.ts` | 界面选择 Agent/direct；分开展示运行状态、任务结果和停止原因。P3 新记录 schemaVersion=3，审计两条路径及跨调用预算；旧 schemaVersion=2 仍可读取。工具完成数同时统计直接技能事件。preload 继续使用原 startRun 透明桥接，无新增渠道。 |

`src/runtime/supervisor.ts` 作为 P2-D/P4 兼容监督入口继续保留原有动作上限与结果流程；本轮没有全量替换历史链路。P3 的成功授权已独立于 Agent 的 control_passed。

## 结果语义

- `status` 描述运行是否安全结束；`gameOutcome` / `runResult.taskOutcome` 描述验证覆盖的观察时点。
- 技能正常结束与到达候选都不能直接映射为 passed。未调用验证器即预算耗尽，结果为 unverified。
- failed 表示有效证据明确未满足标准；Runner 仅在剩余额度和安全条件允许时继续。inconclusive、目标丢失与状态过期不继续盲移。
- Agent 总结异常不修改已记录的有效验证。取消、证据过期、释放未确认或记录失败仍阻止 succeeded；保留历史验证 ID、逐项证据和观察时点，不回写旧运行。
- 原始图片写入关键帧文件；摘要和事件中的执行报告只保存观察元数据与引用，不重复写入图片 Base64。

## 自动检查

| 命令 | 本轮结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm test` | 67 项通过，包含 Runner/会话审计/Experiment 回归 |
| `npm run test:p3` | 28 项技能和状态回归通过 |
| `npm run test:p3-agent` | 15 项 Pi P3 / Verifier 回归通过 |
| `npm run test:agent-input`、`npm run test:verified-runtime` | 各 10 项通过 |
| `npm run test:acceptance` | 19 项历史审计及验收规则回归通过 |
| `npm run test:p4` | 11 项冻结配置、预算、暂停/恢复回归通过 |
| `npm test --prefix runtime/p1` | 11 项 P1 回归通过 |
| `npm run test:python` | 4 项 Python 回归通过 |

覆盖：三态与逐项引用、过期/重复帧、任务/目标/窗口错配、口头成功声明、候选不等于成功、失败后有限继续、8 段/12 次跨调用预算、总时间不重置、取消迟到响应、最终归零失败、Agent 总结失败、过期历史结论、两条路径审计及旧日志适配。

## 模拟联测

`npm run test:agent-ui` 与 `npm run test:p3-ui` 通过。使用真实 Electron 捕获、Pi 和注入的 Python dry-run，模型只访问本机模拟端点。P3 Agent/direct 的成功及目标丢失均可审计；直接路径没有 Planner 请求。并覆盖定位阶段取消、发送前状态过期审计，以及 P2-C/P2-D、P4 预约绑定、暂停/恢复、累计预算和接管兼容。

测试截图与模拟运行产物位于已忽略的 artifacts/临时目录，不纳入源码提交。没有修改历史 runs，没有调用远程模型或执行真实游戏输入。

## 真实游戏验收

尚未执行本轮重构后的真实游戏验收。仍需按既定标准完成固定起点 P3 至少 5 次重复实验、冻结原型对照，以及 P4 的 35 个试次和故障/人工复核清单。重构没有增加动作预算、降低成功阈值或替代这些证据。

本轮不修改 `D:\work\pi`、`D:\work\UI-TARS-desktop` 或 `D:\work\Cradle-main` 的应用代码，不引入密钥、截图或运行产物。
