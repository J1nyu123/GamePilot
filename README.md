# GamePilot 视觉任务、P4 验收与 P3 反馈实验

已合入 GamePilot-dev 的 UI、2.5D 沙盒、任务控制台及 MCP 工具。默认 `npm run dev` / `npm start` 仍启动 Electron，保留真实窗口采集、手柄、P3/P4 与日志审计。右侧“追踪 Trace”配置任务，“MCP 诊断”连接和调试手柄。

Web 沙盒：`npm run dev:web` 后打开 http://127.0.0.1:3000；生产运行先 `npm run build:web`，再 `npm run start:web`。Web 构建仅写入 `dist/web`，不会覆盖 `dist/main`、`dist/preload`、`dist/renderer`。可选 `GEMINI_API_KEY` 和 `GEMINI_MODEL` 用于云端文本规划；未配置或请求失败时使用本地规则与预设回复。

Electron 中点击“沙盒试验场”也可离线体验画布模拟，切回“画面捕获”使用实机。沙盒和实机使用独立接口；沙盒坐标是画布像素、结果始终 `simulated=true / gameOutcome=unverified`，不计入实机验收。独立 MCP 服务 `npm run mcp:gamepad` 当前仅提供内存模拟；真实输入继续通过 Electron 的租约、焦点守卫、F8 及归零 ACK 服务执行。详见 [合并记录](docs/gamepilot-dev-integration.md)。

P3 已新增独立的 `approach_target` 反馈技能、目标框/有效期估计、逐段纠偏和证据审计。右侧选择“P3 目标接近实验”，填写目标、屏幕区域/占比及成功条件。默认仍为模拟；P3 与 P4 实机验收均未完成。详见 [P3 使用与边界](docs/p3-approach-target.md)。

P4 开发新增固定批次验收、35 项预登记、人工复核/报告，以及目标验证任务的暂停、恢复和安全接管。游戏已指定为《塞尔达传说：旷野之息》初始存档；具体场景/地标尚待填写，**尚未通过 P4 实机验收**。入口与命令见 [P4 验收说明](docs/p4-acceptance.md)，配置从 `benchmarks/botw-initial.template.json` 复制。

P1-UI、P2-A 已由用户确认真实 Cemu/模型链路成功。P2-B 的 Python 输入服务、原子技能、租约、安全取消和独立输入调试区已实现，用户确认实机手动输入/停止验证成功。独立工程位于 `D:\work\GamePilot`。

P2-A 实机证据：runs/eb01bce7-a618-4a24-949c-95aca95ee281，真实 Cemu 新帧与豆包模拟工具闭环通过。P2-B 自动控制测试使用 dry-run；另有实机 A、左移、前移执行/归零日志及用户确认，详见 [输入验证说明](docs/input-runtime.md)。20 次实机取消统计尚未收集。

P2-C 已接入右侧真实 move_for，默认仍为模拟，需显式选择真实模式。2026-10-13 用户确认真实模型/Cemu/手柄基本链路成功，日志核实左移 200ms 和前移 1500ms；联合取消与重复统计仍待补充。步骤与证据见 [视觉工具调度说明](docs/visual-tool-runtime.md)。

P2-D 已实现“真实工具 + 目标验证”、独立 Verifier、释放后新帧、有限纠正/只读等待和关键帧 Trace。自动测试完成；2026-10-13 用户确认真实 Cemu/豆包只读生命值图标验证成功，运行 f7703e7c-3fa7-4f1e-b443-147abee917f1 为 succeeded/gameOutcome=passed、零移动。移动后验证、负例、联合取消与重复样例仍待补齐。操作与边界见 [P2-D 验证说明](docs/post-action-verification.md)。

## 启动

下一步验收入口：右侧“真实工具 + 目标验证”模式下展开“P2-D 验收指令”，只填入草稿，不自动执行。已核实墙壁任务的真实前移后 inconclusive/blocked（没有误报成功）；负例、F8 与移动正例仍需补齐。只读日志检查命令 `npm run audit:run -- --run <运行UUID> [--case negative]`，详见 [实机补充验收](docs/p2d-acceptance.md)。

依赖已安装。推荐在 PowerShell 执行：

```powershell
cd D:\work\GamePilot
.\start.ps1
```

脚本在当前终端没有 ARK_API_KEY / GAMEPILOT_API_KEY 时，通过隐藏输入读取实际 API Key，只用于这次运行。它不会写入配置文件。窗口关闭后脚本恢复原来的 GAMEPILOT_API_KEY。

如果当前终端已经设置 ARK_API_KEY，可直接：

```powershell
cd D:\work\GamePilot
npm run dev
```

仅检查窗口采集，无需 API Key：`./start.ps1 -CaptureOnly`。界面中模型配置缺失不会阻止窗口选择、预览和截图。

构建后启动：`npm run build`，然后 `npm start`；或 `./start.ps1 -Production`（需要已有 dist）。开发时 Renderer 支持热更新；Main / preload 更改后需重新启动。

Windows 开发启动使用可见的 Electron 进程。若终端停留在 `node scripts/dev.mjs` 且窗口不出现，旧版本的 `windowsHide: true` 曾导致主窗口被隐藏，现已修正。先在原终端按 Ctrl+C 退出，再重新启动；不要同时启动两个开发服务占用 5174 端口。当前脚本会显示构建、开发服务地址及 Electron PID。

默认读取 `D:\work\pi\.pi-agent\models.json` 中的 volcengine provider 和第一个模型。支持 `${ARK_API_KEY}` / `$ARK_API_KEY` 环境变量引用，拒绝命令型引用；不发送未解析的占位字符串。

可选环境变量：GAMEPILOT_CONFIG（配置文件路径）、GAMEPILOT_PROVIDER、GAMEPILOT_MODEL、GAMEPILOT_BASE_URL、GAMEPILOT_API_KEY。密钥由 Main 持有，配置摘要仅显示状态、模型和文件位置。

## 使用

### Cemu 窗口输入

1. 启动 Cemu，进入游戏，保持窗口未最小化。
2. 刷新“游戏窗口”列表并选择 Cemu；Cemu 进程优先显示，其他窗口可用于捕获排障。
3. 点击“开始预览”，核对显示的确实是所选窗口。“窗口未置前”只表示失焦，当前只读采集可继续。
4. 点击“截取新帧”。截图及证据自动保存在 observations，切换“实时画面 / 待运行图片 / 记录对应的输入”核对。
5. 点击“运行一次”会重新截取一张新帧并固定为模型输入；模型请求期间预览继续，预览不会覆盖已发送图片。
6. 最小化、关闭或源帧停更时显示异常，清除实时画面，不回退到旧帧；恢复后重新开始预览。

默认模拟模式不调用真实手柄。预览、截图、窗口异常不产生模型请求；只有运行任务才上传固定图片。P2-C 真实工具模式在准备 3 秒后重新截取窗口新帧作为模型输入。

### 本地图片输入

1. 点击“导入图片”，选择 PNG/JPEG，最大 10 MiB。
2. 检查左侧图片、尺寸和输入编号；导入时间不代表截图采集时间。
3. 输入任务，点击“运行一次”或 Ctrl+Enter。当前任务允许最多 4 轮模型决策、4 次通过校验的工具请求。
4. 在右侧查看模型文本与参数流、展开工具 JSON、检查工具结果。正在运行时可以取消。
5. 点击“打开日志目录”查看本次 manifest、events、输入图及 summary。结束不会清空记录。

工具目前是模拟 move_for；“模拟链路通过”表示调用协议完成，游戏效果始终标记为未经验证。选择图片不会上传，点击运行才向配置的端点发送图片与任务。

### 手柄输入调试（P2-B）

展开“手柄输入调试”，默认“模拟服务 · 无设备”。连接后可执行 move_for / press_button，检查正常结束、停止 ACK、取消与归零。

真实模式：先选择 Cemu 并预览，再连接“真实虚拟 Xbox”。执行前有 3 秒准备时间切换到 Cemu；执行中失焦自动停止，F8 归零。默认动作 200ms / 力度 0.5，单动作上限 1500ms。模型工具需要在右侧另行选择真实模式。Cemu 设备映射、长动作中途取消与实际画面效果请按 [input-runtime.md](docs/input-runtime.md) 验证。

### 模型真实手柄工具（P2-C）

连接已验证的真实虚拟 Xbox 后，在右侧“模型工具”选择“真实虚拟 Xbox”，输入短移动任务并运行，3 秒内切换到实际 Cemu 窗口。准备后重新截图，模型选择一次 move_for，执行/释放回执和模型总结实时展示。每任务最多一次，固定力度 0.5、20–1500ms；F8、失焦或取消会停止整个真实任务。只接受窗口输入，不接受本地导入图片。详情见 [visual-tool-runtime.md](docs/visual-tool-runtime.md)。

“真实输入链路通过”不等于游戏目标成功；这个 P2-C 模式仍不自动验证目标。需要验证时选择下一节的 P2-D 模式。

### 真实工具 + 目标验证（P2-D）

右侧选择“真实工具 + 目标验证”，填写任务及固定的可见成功条件。准备后截图，move_for 释放确认后重新观察，独立 Verifier 给出 passed/failed/inconclusive，Pi 根据新图与结论有界继续。最多两次移动和一次 wait_for_state；每轮只能一个游戏工具，禁止批量盲控。目标验证通过且证据/释放/落盘检查通过后才显示“目标验证通过”，否则明确受阻、取消或失败。

左侧“关键截图”可查看初始/动作后证据；运行目录内保存 schemaVersion=2 的 manifest、events、observations 与 summary。Planner 与 Verifier 使用同一 VLM，职责独立不意味着不会共同误判。详见 [post-action-verification.md](docs/post-action-verification.md)。

### 新帧证据

采集复用原型的隐藏 Electron 窗口和持续 media stream。每次截图先丢弃一个回调作为源时钟水位，再等待 mediaTime 与 presentedFrames 更大的帧；存在 captureTime 时同时要求采集时间不早于请求屏障。事件/截图 JSON 保存窗口身份、会话 generation、源帧序号、源时钟、屏障及采集/接收时间。

capturedAt 仅由接口提供的 captureTime 转换；没有该字段就保存 null，不用 Date.now 填造。源帧时钟有效不等于具备绝对采集时间。后续 P2-D 的严格动作后验证，在时间证据不足时必须返回 inconclusive；输入释放屏障联测仍属于 P2-B/P2-D。

Main 使用单调时钟限制模型提交截图的年龄为 3 秒，过期或窗口身份/会话改变时拒绝提交；窗口模式的运行按钮会自动重取新帧。静止画面的像素不变不是故障，判断依据是源帧进度而不是图片哈希。

窗口状态通过隐藏的 PowerShell/.NET Win32 查询服务读取，不引入 nut-js 或新的原生 npm 框架；服务仅提供窗口枚举与状态查询，关闭应用时释放媒体流和服务进程。

左右面板可拖动调整；窄窗口切为上下布局。手动上滚后不会抢滚动位置，点击“有新事件”回到最新内容。替换图片后可切换“记录对应的输入”，核对上一任务实际看到的图片。

## 依赖与构建

Node 24.20.0；Electron 44.7.0；React 19.0.0；Vite 6.1.0；TypeScript 5.7.3；Tailwind 4.1.3；esbuild 0.28.2。确切依赖保存在 package-lock.json。

构建复用：

- `D:\work\GamePilot-p1\src\runtime.mjs`，现有已测试的 P1 Agent 实现。
- `D:\work\pi` 固定提交 `4270522473e677ddba7b093caa0064a3df51d459`，Pi Core/pi-ai 1.1.0 及该仓库已安装的依赖。

esbuild 在本工程构建时解析本地 Pi 源码并打包 Main；Electron 运行 dist 中的 JavaScript，不依赖 Node 的 TypeScript 源码解析钩子。构建不会修改 Pi 仓库，也不启动 coding-agent CLI。当前是源码联调工程，安装包分发尚未实现。

换机器时保留上述同级目录关系，先在 Pi 中执行 `npm ci --ignore-scripts`，再在本工程执行：

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run build
```

## 检查与测试

```powershell
npm run typecheck
npm test
npm run build
npm run test:ui
npm run test:dev
npm run test:capture
npm run test:python
npm run test:input-ui
npm run test:agent-input
npm run test:agent-ui
npm run test:verified-runtime
npm run test:capture-requests
npm run test:p4
npm run test:p3
npm run test:p3-agent
npm run test:p3-ui
```

另执行 `npm test --prefix runtime/p1`，当前 11 项回归（原 8 项，加空回复、仅推理回复和显式思考开关）。

Electron UI 测试使用仅监听 127.0.0.1 的模拟模型端点和真实 Pi Runtime；不调用你的远程 API。默认生成测试图片，也可以用 GAMEPILOT_TEST_IMAGE 指定本地图片。截图输出到 artifacts，运行记录输出到 runs，均已忽略。

自动检查覆盖 TypeScript、构建、67 项基础/证据/监督/Runner/实验测试、10 项 Pi/手柄集成、10 项 Pi/Verifier 集成、4 项 Python 单测、11 项 P1 回归，以及 Electron 模型/输入 UI、P2-C/P2-D 联测与原生捕获取消。自动输入均为 dry-run，焦点联测用可控依赖，零真实动作；证据明确标为测试数据。空回复会显示具体原因及响应诊断。

原生窗口捕获集成测试覆盖枚举、实时画面、源帧屏障、截图冻结、模型收到同一图片、模拟工具闭环、缩放/标题、最小化/恢复/关闭、零预览上传。截图见 artifacts/p2a-capture-desktop.png；该测试窗口明确标为“非游戏”。

真实 VLM 的 CLI 验证此前通过；Electron 自动界面测试使用模拟端点。2026-10-12 对用户空回复运行进行排查后，在已运行的 Electron Main 内复用其凭据实测更新后的 Runtime，得到两轮响应、一次模拟工具、零工具错误和 protocol_passed，证据见 artifacts/provider-runtime-check.json。密钥没有返回或写入诊断记录。更新版本需重启 Main，之后仍需人工核对真实截图描述。

对于官方 Ark 端点上的 doubao-seed 模型，P1 调试默认显式发送 thinking.type=disabled。宿主的 thinkingLevel=off 或模型配置 reasoning=false 本身不会保证服务端关闭思考。当前响应诊断只记录内容类型、文本/推理字符数、工具调用数，以及接口实际提供的 token 统计；不保存推理正文。没有公开回复或工具调用时仍判定 incomplete，不自动重试或伪造成功。

## 文件结构

```text
src/main/         Electron、受限 IPC、配置与运行记录
src/preload/      类型化桥接
src/contracts/    输入、事件与状态契约
src/agent/        现有 P1 Runtime 的复用边界
src/capture/      Win32 状态、持续窗口流、新帧屏障和 Observation
src/input/        Python 通信、租约、原子技能与手动调试控制
src/runtime/      Runner、跨技能预算、真实执行服务、安全与完成检查
src/experiments/  冻结任务配置、起点、重复试次、基线标签与统计
src/skills/       有界反馈技能，只返回执行与到达候选
src/state/        独立目标定位与状态有效期
src/verification/ 新帧证据检查与独立视觉 Verifier
python/           输入服务、看门狗与测试
src/renderer/     图片、Transcript、工具与任务输入
scripts/          本地 Pi 打包、开发启动
tests/            配置/会话测试、Electron UI 测试
runs/             本地运行数据
observations/     手动/运行时截取的关键帧及证据
input-debug/      手动输入状态、停止确认及协议结果
```

P2-B、P2-C 基本实机链路及 P2-D 首个只读目标验证已由用户确认；另有真实移动后无法判断及拒绝盲移样例。P2-D 移动目标正例、实机明确负例、联合取消与重复样例待补齐。之后进行 P4 基础 MVP 任务集验收。目标验证模式现已支持暂停/恢复、接管；P3 已实现首个目标接近反馈实验；真实定位精度、5 次重复接近和基线对照仍待验收。

实现参考：[Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)、[视频帧回调元数据](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)。


## 从 GitHub 首次安装

仓库已包含 `runtime/p1` 验证运行时，不再需要单独的 GamePilot-p1 目录。Pi 上游源码仍固定在指定提交，作为 GamePilot 的同级目录（或设置 PI_SOURCE_DIR）。Windows、Node >=24.20.0；真实手柄还需要 Python/vgamepad 与 ViGEmBus，见输入运行说明。

```powershell
# 在 GamePilot 的父目录执行；已有 pi 目录时先检查版本，不覆盖本地改动
 git clone https://github.com/earendil-works/pi.git pi
 git -C pi checkout 4270522473e677ddba7b093caa0064a3df51d459
 npm --prefix pi ci --ignore-scripts
 cd GamePilot
 npm ci
 Copy-Item config/models.example.json config/models.local.json
 # 编辑 models.local.json 中的模型 ID 和服务商端点
 $env:GAMEPILOT_CONFIG = "$PWD/config/models.local.json"
 npm run build
 .\start.ps1 -Production
```

启动脚本会隐藏读取 API Key；密钥不应写入 Git。运行日志、截图、配置 local.json、node_modules 与 dist 均不提交。

当前里程碑：P3/P4 功能已实现，P3 已有出现“A 调查”提示的实机续程成功样例；固定起点重复实验与 P4 正式实机验收仍待完成。自动测试和模拟联测不代表完整实机验收。

## 架构演进计划

[模块职责与解耦实施方案](docs/module-boundaries-and-refactor.md)的七步软件迁移已完成。P3 可在“执行路径”中选择直接技能或 Agent，两者使用相同的 Runner、独立逐项 Verifier 和跨调用总预算。技能到达候选不会直接产生任务成功；运行状态、任务结论及停止原因分别保存和展示。新 P3 记录使用 schemaVersion=3，旧记录仍可审计。详见 [实施与验证记录](docs/module-refactor-report.md)，P3/P4 正式实机验收仍待完成。
