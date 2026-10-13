# P4 基础 MVP 开发与实机验收

日期：2026-10-13。P4 的验收工具及暂停/恢复、接管能力已实现；真实任务集尚未验收。用户指定游戏为《塞尔达传说：旷野之息》、初始存档。具体出生点/位置、朝向、镜头、地标和移动判据仍须在游戏画面中固定。

## 固定配置与任务

复制 `benchmarks/botw-initial.template.json` 到自己的配置文件，填写所有“待填写”项。每次运行前由操作者恢复同一初始场景；程序不操作存档。移动成功条件必须描述角色相对指定地标的可见变化，不使用米数推测，不以摇杆归零代替视觉位移。

```powershell
cd D:\work\GamePilot
npm run p4 -- freeze benchmarks/botw-initial.json
npm run p4 -- next <批次UUID>
```

freeze 校验必填项后建立新的不可覆盖批次，保存计划 SHA-256 和冻结时间。已有配置被更改会拒绝读取；需要变更时创建新批次，旧批次仍保留。模型 ID/provider 必须与冻结配置一致。机器、Cemu、驱动/映射、游戏版本和场景由人工复核保证一致。

界面展开“P4 固定任务验收”，填入批次 UUID，点击“载入下一项”。此操作只填入冻结任务，不运行模型或手柄。完成场景复位后点击“运行一次”。运行前会原子预约当前试次，将批次、计划哈希、任务类别、序号和 runId 写入 manifest。重复提交不能占用同一试次；预约后启动失败或崩溃的试次也保留，不能静默重试覆盖。

| 组 | 次数 | 固定标准 |
| --- | --- | --- |
| move | 5 | 一次前移 500ms；独立验证、人工视觉复核通过至少 4 次 |
| wait | 5 | 只调用一次 wait_for_state；固定可见条件验证通过至少 4 次 |
| blocked | 5 | 一次只读等待；条件不满足时 blocked/failed 或 blocked/inconclusive；5 次均不误报通过 |
| cancel-model | 10 | 模型请求等待期间、尚未调用工具时按 F8 或取消 |
| cancel-action | 10 | 一次前移 1500ms 执行期间按 F8 或取消 |

取消若发生太早/太晚，仍保留该结果，该试次不通过。所有 35 项必须有完整记录和场景复核，缺日志/缺图/模拟端点不能按“允许失败的 1 次”绕过证据要求。与 P2-D 严格 negative 案例不同，P4 受阻组允许最终 inconclusive，验收的是不误报与有界退出；不会改写之前的 negative 结论。

## 人工复核及报告

每次核对初始/动作后截图、实际游戏反应和场景复位，保存复核 JSON：

```json
{"reviewer":"操作者姓名","sceneRestored":true,"outcome":"passed","notes":"记录具体地标、实际反应、关键帧编号；失败写明原因"}
```

```powershell
npm run p4 -- review <批次UUID> move 1 review.json
npm run p4 -- report <批次UUID> p4-report.json
```

outcome 可为 passed 或 failed；复核文件不覆盖。报告只读 runs 和批次记录，逐项列出通过、失败、缺失和原因，汇总成功数、取消延迟 P95、检查项与总判定。输出文件必须是新路径。退出码：0=验收通过，1=未通过/待补齐，2=参数或文件错误。报告中的 accepted 依赖操作者署名复核，不能证明日志真实性或模型泛化。

报告还要求以下检查项各有证据：窗口身份/最小化关闭、模型过程、滚动保留、模型等待与动作阶段分别暂停、恢复新帧、两阶段接管、模型超时、捕获失败、Python 退出、取消竞态、日志写入失败。

```json
{"reviewer":"操作者姓名","outcome":"passed","notes":"实际操作、预期与结果","evidence":"运行UUID及截图/测试报告路径"}
```

```powershell
npm run p4 -- check <批次UUID> pause-model check.json
```

完整检查项 ID 见 `src/benchmarks/campaign.ts` 的 checklist。证据字段必须填写，工具不自动理解证据内容，需人工审查。实机异常测试与自动故障注入应在 notes 中明确区分。

## 暂停、恢复和接管

“真实工具 + 目标验证”模式运行时可暂停。暂停中断当前模型/工具调用，等待当前输入控制段退出并确认 neutral ACK，随后显示“已暂停”。没有归零确认会失败，不能显示暂停成功。暂停期间整个任务仍占用运行槽，不能手动发输入、切换源或启动新任务。

恢复仍使用同一 runId、固定成功条件和初始参考图；3 秒准备后重新取得窗口新帧，旧模型响应不会继续执行。Pi 从新图开始新的决策段，Transcript 保留此前事件。总时间预算在暂停期间继续计时；4 轮决策、2 次移动、1 次等待、5 次后置检查的累计预算不重置。被中断的移动/等待也消耗预算，不透明重试动作。恢复不会复用旧 passed 作为新完成依据。

“接管游戏”先取消任务并等待最终释放确认，只有安全取消完成后才请求聚焦原绑定窗口。窗口身份变化、最小化或 Windows 拒绝前台切换时会明确报错；任务保持已取消，不重新发输入。恢复只在本次进程有效，不实现重启恢复或历史回放。

## 停止时延

事件 `control_stop.result.stopTiming` 保存原因、当前输入阶段、后端、测量 ID、指令入口时间，以及 Main 单调时钟测得的：

- resetSentAfterMs：宿主 stop 处理入口到 reset 调用发出。
- ackAfterMs：同一入口到 Python 确认 neutral。

每个输入控制段只记录第一次停止样本；正常结束的最终复位不计为用户取消。验收取 20 个独立 run 的用户取消/F8 样本，按 nearest-rank 计算 P95，要求 ACK P95 ≤ 500ms。失焦、接管、暂停、看门狗不能混入正常取消统计。测量不含操作系统投递快捷键前的时间，不代表游戏动画或物理设备停止时刻。

## 自动验证与当前边界

```powershell
npm run typecheck
npm test
npm run test:p4
npm run test:acceptance
npm run test:agent-input
npm run test:verified-runtime
npm run build
npm run test:agent-ui
```

新增自动用例覆盖计划篡改、并发试次预约、失败保留、重复运行、模拟证据拒绝、35 项聚合、人工复核、暂停等待 ACK、暂停期间总超时，以及同 runId 恢复。桌面联测采用本地模拟模型、非游戏测试窗口、Python dry-run；不作为本游戏实机通过证据。

本次实跑结果及证据见 [P4 开发交付检查](p4-development-report.md)。

P4 开发交付不等于 P4 实机退出条件已满足。填写场景及判据、实际执行 35 项、附上人工复核和检查项后，才可形成实机验收报告并进入 P3 反馈技能实验。
