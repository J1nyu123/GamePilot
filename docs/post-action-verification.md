# P2-D：释放后新帧、独立验证与轻量 Trace

日期：2026-10-13。状态：代码及自动联测完成；用户确认首个真实 Cemu/豆包只读目标验证成功，日志及关键帧引用已核实。移动后验证、未满足/无法判断条件、联合取消及重复样例待补齐。没有将 P2-C 的人工成功改成自动验证成功。

## 实机确认记录

2026-10-13，用户确认运行 `f7703e7c-3fa7-4f1e-b443-147abee917f1` 验证成功，证据保存在 `D:\work\GamePilot\runs\f7703e7c-3fa7-4f1e-b443-147abee917f1`：

- 输入：真实 Cemu 窗口；模型：doubao-seed-2-1-turbo-260628；simulated=false。
- 固定条件：游戏画面左上角清晰可见红色生命值心形图标。
- 工具：wait_for_state 一次，移动零次；两张关键帧，一次独立 Verifier 请求。
- 结果：verdict=passed，status=succeeded，gameOutcome=passed；可展示事实为左上角三个清晰红色心形图标。
- 初始 observationId：f4f311fe-653e-4f4f-9bc5-6f5b049824dd，源帧 247；后置 observationId：f8600173-aa59-404d-a010-2d713cdf752f，源帧 259。两张 JPG 按 manifest 引用保存在运行内 observations。
- releaseId：4a4a9e1d-f535-4f52-9318-252c2c7d4466；服务 ok=true、neutral=true，顺序为 release-ack-then-capture，后置帧通过源屏障。

该样例验证了只读等待的“归零确认 → 新帧 → 独立视觉判断 → 完成检查与落盘”链路，不证明移动效果判断、跨场景准确性或取消时延。下面验收顺序第 1 项已有一个成功样例；保留所有历史失败和 unverified 记录，不修改原始结论。

补充：用户实际运行“向前走到墙壁”，运行 484cb508-41d5-4ecb-afbd-ae0c15b545d3 完成一次真实前移、归零后新帧和独立 Verifier，最终 blocked/inconclusive；第二次盲目移动被门禁拒绝。它提供移动后无法判断的真实样例，不是移动目标成功。新增 UI 验收模板与只读日志检查，步骤、证据及剩余测试见 [实机补充验收](p2d-acceptance.md)。

文字负例 e82bbf83-e256-42bf-aa27-25b3a0cf7c75 已由用户确认：首次独立 VLM failed，第二次轮询耗尽预算后最终 blocked/inconclusive，零移动且最终归零。未误报成功与有界退出已验证；按既定标准，最终明确 failed 的负例仍需补齐，F8 取消尚无新实机记录。保留原始摘要，不根据用户的“测试成功”改写目标 verdict。

## 本阶段交付

- 新增“真实工具 + 目标验证”模式；原模拟模式与 P2-C 单次真实输入模式保留，默认仍是模拟。
- 独立 GameVerifier：只接收固定成功条件和初始/动作后截图，单独调用同一 VLM，不传 Planner 历史、完成声明或手柄回执。
- RuntimeSupervisor：固定目标、检查释放/新帧证据、限制动作和观察次数、检查完成条件；Pi 正常结束不等于任务成功。
- `move_for` 的后置验证；`wait_for_state` 的只读新帧轮询。不能通过工具参数改写成功条件。
- 同一运行保存 manifest、events、关键截图、summary；界面可选择初始与动作后关键帧，输入回执和目标结论分开展示。

这是职责独立，不是统计错误独立：Planner 和 Verifier 使用同一模型。`passed` 是 VLM 在固定判据下的判断，不是绝对证明，须保存人工复核和误判样例。没有复杂 StateEstimator、目标跟踪、历史重开或事件溯源。

## 启动与操作

关闭旧窗口，在原终端 Ctrl+C 后重启，Main/preload 不能只靠 Renderer 热更新：

```powershell
cd D:\work\GamePilot
.\start.ps1
```

本阶段需要模型 API，不能用 `-CaptureOnly` 替代。正常选择 Cemu、开始预览，连接已验证映射的真实虚拟 Xbox，然后右侧选择“真实工具 + 目标验证”。旧 Main 不支持此模式时禁止启动并提示重启。

分别填写任务与“固定成功条件”。成功条件为空时按钮禁用；模糊或不可见条件应该得到 inconclusive，不能根据输入时长推算距离。点击运行后 3 秒内切到真正的 Cemu 并保持前台；模型判断和验证期间失焦也会取消。F8、取消按钮和“停止并归零”均中止真实任务，等待归零确认。任务开始时自动收起底层手动调试面板，为 Transcript 留空间，可手动重新展开。

### 建议实机验收顺序

1. 先做零移动的只读验证。在有生命值 HUD 的游戏场景输入：“不要移动；调用 wait_for_state，等待预算 10000ms，检查下方固定成功条件，然后总结验证结果。”条件：“游戏画面左上角清晰可见红色生命值心形图标。”人工核对是否确实可见，不能只看绿色结论。
2. 做可见地标移动。任务：“沿当前视角短暂前移，尝试靠近画面中的指定石柱；根据新证据判断是否继续，达到条件后停止。”条件需按真实画面写，例如：“指定石柱仍清晰可见，角色与该石柱的可见相对位置比初始截图明显更接近。”如果画面不能支持这一判断，应允许 inconclusive，不强制成功。
3. 做明确未满足的只读条件，例如要求出现实际上不存在的提示文字；不能因为 Planner 总结“完成”而显示目标通过。
4. 验证正在等待 Verifier 时按 F8，以及动作期间取消、失焦、窗口关闭；核对 canceled、释放确认和没有迟到输入。
5. 在左侧“关键截图”查看前后证据，在运行目录检查目标、帧时钟、释放引用、验证事实和最终摘要。分别保存成功、失败、无法判断和取消样例。

P2-D 不承诺按米数移动，也没有接入冲刺按键或 `approach_target`。给模型的移动能力仍是固定力度 0.5、20–1500ms 的左摇杆。

## 顺序与证据契约

```text
Pi 选择一个工具
  → 执行有界输入（或只读等待先确认归零）
  → Main 收到服务释放 ACK
  → 才请求捕获端建立新帧屏障
  → 返回屏障后的源帧
  → 保存关键截图并检查窗口身份/会话/源时钟
  → 独立 Verifier 判定固定目标
  → 回执、结论、新截图返回 Pi
  → 有界继续或结束，由 Supervisor 检查完成
```

释放证据带独立 releaseId、服务 runId/generation、窗口身份及采集 generation。服务 ok/neutral 必须明确；取消、错误或未确认释放不得进入后置验证。控制器检查执行回执对应当前控制租约。

动作后帧必须比最近决策帧具有更新的源帧序号、mediaTime 和 presentedFrames，且 captureTime 不早于捕获端自己的请求屏障。不同进程时钟不直接比较：release.receivedAt 用于诊断，正确性依靠“ACK 后才调用捕获”的因果顺序及源时钟屏障。接口不给 captureTime 时仍可预览，但严格目标验证返回 inconclusive；不补造采集时间。静止像素不变不是旧帧，依据源帧进度判断。

Verifier 的比较基准固定为任务初始截图，不会在第二次移动时偷偷把整体目标改成相对上一步的目标。新图片同时返回 Pi，用于下一轮决策。

完成还需核对验证 goalId、releaseId、截图引用与已落盘的关键帧/最新验证事件。缺少证据、过期、取消、释放或落盘失败，都不能形成 accepted success。

捕获初始化整个过程最多等待 10 秒，取帧另有 3.5 秒 Main 侧上限；停止、窗口关闭或渲染进程退出使在途请求退出。不会仅依靠已被销毁的 Renderer 内部计时器。

## 固定 MVP 预算

| 项目 | 上限 |
| --- | --- |
| 每轮模型游戏工具 | 1；拒绝同一响应批量排队动作 |
| move_for | 每任务 2 次，各 20–1500ms、力度 0.5 |
| wait_for_state | 每任务 1 次，参数 500–10000ms |
| 只读轮询 | 最多 3 张新帧，间隔 500ms |
| 全任务后置检查 | 最多 5 次，初始图加后置图最多 6 张 |
| Pi 轮次 | 最多 4 轮，工具总预算 3 |
| 独立验证请求 | 单次最多 15 秒，maxTokens=1024，不自动重试 |
| 决策/完成证据年龄 | Main 收到证据后的单调时钟最多 15 秒 |
| 全任务时间 | UI 30/60/120 秒选择，包含准备和最终释放 |

wait_for_state 的轮询预算从归零 ACK 后开始，包含取帧与验证。到期会中断轮询/模型请求；最终安全清理另有输入服务既定 ACK 超时，不把复位等待算作目标成功。

输入动作不透明重试。failed 且新证据有效时，Pi 可以做一次受限纠正；inconclusive 或过期时禁止盲目继续移动，可用剩余只读等待预算获取新证据。目标已 passed 后拒绝追加工具。

## 结果语义

- `verification.verdict=passed/failed/inconclusive`：固定目标的证据判断。
- `status=succeeded, gameOutcome=passed`：Supervisor 与持久化入口接受本次完成，最终释放已确认。
- `status=blocked`：目标未达到、证据不足、无独立验证或预算/新鲜度限制；没有成功图标。
- `status=failed`：输入/通信/Runtime/落盘等故障；不是游戏目标判断的 failed。
- `canceled/timed_out`：没有接受任务成功。即使此前有通过的验证事实，最终 gameOutcome 也不保留为 accepted passed。
- P2-C `control_passed` 和模拟 `protocol_passed` 仍维持 `gameOutcome=unverified`。

工具回执可证明真实输入执行及释放，但不能证明目标。等待没有满足条件时不显示输入成功勾选。Verification 的公开事实、摘要、截图引用和 JSON 可查看；不展示或保存私有推理。

## Trace

```text
runs/<runId>/
  manifest.json        # schemaVersion=2、原始任务、固定 goal、模型、截图与释放引用
  events.jsonl         # 单一递增 sequence，与 UI 事件一致
  input.jpg            # 准备完成后真正用于初始规划的截图，不被后置图覆盖
  observations/<id>.jpg  # 初始/动作后关键帧，按引用定位
  summary.json         # 状态、目标结论、验证引用与计数
```

只保存关键帧，不保存所有实时预览帧。工具结果中的图像以引用记录，不把 Base64 塞进 JSONL。目录新增，旧任务、配置和源码基线不删除。写入失败停止任务，不实现复杂补偿或状态重建。metrics.moves/waits 是已启动的技能尝试数，observations 是关键帧数，verifierCalls 是已启动的独立验证调用数；不是成功率或付费 token 统计。验证耗时注明为后置观测/保存/检查/判断整段 Main 单调时钟测量，不是假定的模型耗时。

## 文件与检查

新增：`src/contracts/verification.ts`、`src/verification/evidence.ts`、`src/verification/verifier.ts`、`src/runtime/supervisor.ts`、`src/renderer/components/VerificationItem.tsx`、验证/预算/捕获取消测试。复用 P1 Loop，增加 `../GamePilot-p1/src/model.mjs` 和 `verifier-model.mjs`；Pi 上游、Python 输入协议和冻结原型未重写。Main/session、原输入控制器、捕获流和现有 Renderer 增量修改，没有新增依赖。

```powershell
npm run typecheck
npm test
npm run test:agent-input
npm run test:verified-runtime
npm run test:python
npm run build
npm run test:ui
npm run test:agent-ui
npm run test:input-ui
npm run test:capture
npm run test:capture-requests
npm run test:dev
```

自动测试使用真实 Pi Core/pi-ai、Python dry-run、实际 Windows 测试窗口和本地 SSE 模型端点；不消耗远程模型额度、不发送真实游戏动作。桌面联测用可控焦点和独立快捷键，正式 Main 不使用这些替换。

证据：`artifacts/p2d-agent-ui-check.json`（明确 testOnly/physicalInputVerified=false）、`p2d-goal-verification.png`、`p2d-sample-trace/<测试runId>/`、`capture-request-check.json`。样例 Trace 另附 test-context，不能当作 Cemu 目标真实验收。下一步是联合实机复核与 P4 基础 MVP 任务集，不立即展开 P3 复杂反馈技能。
