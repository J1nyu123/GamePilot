# P2-C：视觉工具调度

更新：2026-10-13。用户确认 P2-C 基本实机链路成功；本模式维持未经验证的输入链路语义。P2-D 已新增独立目标验证模式，见 [post-action-verification.md](post-action-verification.md)。联合取消样例与重复统计仍待补充。

## 实机确认记录

2026-10-13 用户确认短移动验证成功，并再次确认向前移动任务执行成功。本地记录核实：

- `runs/bf04db85-2f80-4e50-ab14-cfd20c480869`：Cemu 窗口新帧 43，豆包模型调用 `move_for(left, 200ms)`，`control_passed`、`simulated=false`、一次工具、零工具错误、最终释放确认 `neutral=true`。
- `runs/12e154bf-9c9c-4fa2-a628-dd2eadd099aa`：Cemu 窗口新帧 673，同一模型调用 `move_for(forward, 1500ms)`，同样为 `control_passed`、真实输入、一次工具、零工具错误、最终释放确认。

模型为 `doubao-seed-2-1-turbo-260628`，实际游戏移动效果由用户确认。以上记录均保留 `gameOutcome=unverified`，未自动判断移动距离、奔跑状态或任务目标。没有把人工确认改写成 Verifier 的成功结果，也不宣称本阶段联合 F8 取消或重复成功率已获得统计证据。下一阶段为 P2-D。

## 范围

本阶段只接入一个真实 `move_for`，不实现 Verifier 或连续视觉闭环。P1 默认模拟路径、图片调试和 P2-B 手动调试保留。Pi 源码与冻结的 UI-TARS 原型未修改，没有新增依赖。

右侧“模型工具”有两个选项，默认模拟：

- 模拟工具：允许导入图片；结果 `protocol_passed`、`simulated=true`。
- 真实虚拟 Xbox：必须使用有效窗口预览，先连接 P2-B 的真实设备；结果 `control_passed`、`simulated=false`。

两种结果均为 `gameOutcome=unverified`。`control_passed` 只表示工具执行/释放回执及后续公开模型回复完整，不表示角色真的移动或游戏任务完成。

## 实机启动与验收

先关闭旧 GamePilot 窗口，在原终端 Ctrl+C 后重启 Main/preload：

```powershell
cd D:\work\GamePilot
.\start.ps1
```

本阶段需要模型 API，不能只使用 `-CaptureOnly`。密钥仍仅在启动会话/Main 中持有，不写入文件。

1. Cemu 进入可操作游戏场景，选择窗口并开始预览。菜单/不明确场景不适合作为移动验收；模型被要求不在这些场景移动。
2. 手柄调试区连接“真实虚拟 Xbox”。继续使用已人工验证的 Cemu 设备映射；程序不改游戏配置。
3. 在右侧“模型工具”选择“真实虚拟 Xbox”。仅连接手柄并不会自动把右侧从模拟切换为真实。
4. 输入：“观察当前游戏画面；若处于可操作场景，调用一次 move_for 向左移动 200 毫秒。总结输入回执，不要声称游戏目标已完成。”
5. 点击“运行一次”，在 3 秒内切换到真正的 Cemu 窗口，不是点击预览图。保持前台直到任务结束；等待模型期间也有焦点保护。
6. 返回调试台，核对观察帧、公开模型文本、工具参数、真实 receipt 与 `neutral=true`、后续模型总结，以及“真实输入链路通过 / 游戏效果未经验证”。展开工具结果可见 Python 实测时长、runId 与 generation；总工具耗时和动作时长是不同测量。
7. 另测试等待模型时 F8、取消按钮或“停止并归零”；确认任务取消且迟到的模型响应不能触发输入。长动作期间按 F8 验证实际停止。若中途切回 GamePilot，失焦保护会取消整个真实任务。

F8 被占用时真实服务连接失败；先正常关闭旧 GamePilot/原型后重试，不要同时启动多个真实设备实例。模型未调用工具时显示“链路未完成”，没有虚构成功动作。失败样例与已有记录均保留。

## 数据流和安全边界

1. Main 验证显式模式、模型配置、窗口身份/采集 generation、手柄连接及 F8 注册，预留 session。
2. 同一个 `ManualInputController` 独占现有 `PythonGamepad`；3 秒准备期间不发送动作，申请新的控制租约。
3. 准备完成、前台检查通过后重新获取源屏障之后的新帧；替换本次 `input.jpg`、manifest 和内存快照。预览帧不能代替本次模型输入。
4. Pi 依据截图自主选择工具；TypeBox 与既有技能映射双重校验，方向四选一，20–1500ms，固定力度 0.5。不向模型暴露任意按钮、Python 操作或原始协议。
5. 每次任务最多一次真实移动，防止凭同一张截图继续多步盲控。第二次调用拒绝并标记预算耗尽。模拟路径保留原有 4 次预算。
6. Python 返回 `executed + ok=true + neutral=true` 后才记录工具正常完成；取消或释放未确认不能算工具成功。等待模型期间继续持有任务所有权，手动输入和切换窗口不可并发。
7. 结束前等待最终 reset ACK，再发布任务摘要。取消、F8、失焦、服务故障、日志失败、断开、关闭应用均阻止后续动作；总超时包含准备期。退出/断开请求共享同一清理，避免两个调用者竞争复位。

事件包括 `user_message`、`input_preparing`、`observation_start`、`observation`、模型流、工具开始/结束、`input_interrupted`、`input_released` 和最终摘要。UI 与 JSONL 使用同一序列，公开文本与结果可保留；不展示私有推理，不伪造时长、输入成功或目标成功。

没有自动聚焦 Cemu；前台状态由现有只读 Win32 服务判断。没有动作后截图/Verifier，这由 P2-D 完成。恢复和用户接管的完整任务语义也不在此阶段实现。

## 文件与复用

- `../GamePilot-p1/src/runtime.mjs`：保留默认模拟实现，新增宿主注入的真实 movement、单次预算与真实结果语义；未复制或重写 Pi Loop。
- `src/agent/validation-runtime.ts`、`src/contracts/debug.ts`：真实工具适配契约、执行模式、运行快照。
- `src/input/manual-controller.ts`：共用设备的 Agent 独占期、焦点保护、取消与最终释放。
- `src/main/ipc.ts`、`src/main/session.ts`：窗口绑定、准备后新帧、真实任务调度和记录；结束落盘期间取消竞态处理。
- `src/preload/index.ts`：运行能力查询，旧 Main/preload 下禁用真实工具并提示重启，避免仅 Renderer 热更新造成模式误判。
- `src/renderer/App.tsx`、AgentComposer、AgentTranscript、ToolCallItem、InputDebugPanel、styles.css：模式选择与真实反馈。
- `tests/agent-input.test.ts`、`tests/agent-ui-entry.ts`、`tests/agent-input-smoke.mjs`：受控 Pi/Python/Electron 联测；会话及输入回归新增边界测试。

## 自动验证与证据

```powershell
npm run typecheck
npm test
npm run test:agent-input
npm run test:python
npm run build
npm run test:ui
npm run test:input-ui
npm run test:capture
npm run test:agent-ui
```

另在 `D:\work\GamePilot-p1` 运行 `npm test`，保留 11 项模拟回归。

新增 10 项 Pi/输入集成测试使用真实 Pi Core/pi-ai、本地模型 SSE 和真实 Python dry-run 进程，覆盖成功回执、越界/未知参数、重复调用预算、准备期取消、模型等待取消、动作中取消、焦点失效、超时和最终 reset ACK 失败。基础测试新增准备后输入冻结、总超时、取消竞态与并发断开。

桌面联测使用真实 Windows 测试窗口与捕获流，但手柄后端为注入的 dry-run、焦点为可控测试依赖、快捷键为独立的 Ctrl+Shift+F12。Windows 不保证程序请求聚焦能置前，测试不因此关闭正式程序的焦点保护。正式入口不传测试依赖，始终使用实际设备、Win32 前台判断和 F8；Renderer 不能开启这些测试替换。

联测运行数据使用独立临时目录；证据 `artifacts/p2c-agent-ui-check.json` 明确 `testOnly=true`、`physicalInputVerified=false`，截图为 `artifacts/p2c-agent-input.png`。这些自动测试没有发送真实游戏动作，也不使用远程模型额度。P2-A 和 P2-B 分别成功并不能代替本阶段联合实机验收。
