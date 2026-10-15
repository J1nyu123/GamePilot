# GamePilot

Electron + React 工作区：选择 Windows 窗口或导入图片，通过 Pi Agent Core 请求视觉模型、调用模拟手柄 MCP 工具，实时显示 Trace 并保存运行记录。

支持三种执行模式：模拟 MCP 手柄用于调试；真实键盘通过 Windows SendInput 操作所选窗口；真实手柄通过 Python vgamepad + ViGEmBus 创建 Xbox 360 XInput 设备。两种真实模式均在动作释放后截取新帧回传模型。目标是否达成由模型描述，结构化 gameOutcome 仍为 unverified，不将链路通过等同于游戏成功。

## 聊天与意图识别

在“任务控制台”直接聊天，无需导入截图或启动预览。系统先以纯文本请求识别意图，并保留最近 12 条对话消息（应用重启后清空）：

- chat：普通聊天、游戏知识咨询，直接回复，不发送图片、不注册游戏工具。
- observe：查看已载入图片或当前游戏画面（包括“你能看到我放入的图片吗”），按需发送图片，只读回答，不注册动作工具。已导入图片时优先分析该图片。
- act：明确操作指令，按当前选择的模拟手柄、真实键盘或真实手柄模式执行游戏闭环。
- clarify：意图或指代不清、模型输出无效、任务置信度不足，先询问，不执行。

例如“怎么走到柱子那里”属于咨询，“帮我走到柱子处”属于操作，“看看前面有什么”属于观察。实际分类依赖所配置模型，不能保证零误判；模型自报置信度不是经过校准的准确率。聊天回复与分类共用一次模型请求，游戏任务才追加视觉请求。

聊天模型同时收到当前模式的工具清单（名称、参数、用途、预算和后端限制），可直接询问“你能使用哪些工具和 MCP”。清单复用实际工具定义；查询清单不会执行工具，也不代表已连接独立 MCP 服务。

Trace 显示“消息意图识别”。缺少游戏画面时，仅游戏任务提示补充输入，正常聊天仍可用。“追踪 Trace”中的“运行一次”保留为显式游戏任务调试入口，不经过聊天分流。

检查：`npm run test:conversation`、`npm run test:runtime`；本地脚本模型验证路由与权限隔离，不衡量真实模型的分类准确率。

## 真实虚拟手柄

本机已检测到健康的 Nefarius Virtual Gamepad Emulation Bus，项目 `.venv` 已安装 vgamepad 0.1.0。新机器可运行 `npm run setup:gamepad` 安装 Python 桥接依赖；需单独安装驱动。桥接默认使用 `.venv/Scripts/python.exe`，可通过 GAMEPILOT_PYTHON 指定其他 Python 可执行文件的完整路径。

1. 构建后启动，选择“真实手柄（Xbox 360 / ViGEm）”。
2. 首次配置游戏时点击“连接 / 检查真实手柄”，提前创建可被游戏识别的 Xbox 360 设备。执行真实手柄任务也会自动连接；成功任务后保持设备连接，避免每步重建。
3. 在游戏或模拟器中选择 XInput / Xbox 360 控制器。例如 Cemu 的 Input settings 需添加 XInput 控制器并绑定按键。
4. 选择游戏窗口、开始预览，再发出操作指令。模型工具为 capture_game 和 gamepad_action，支持左右摇杆、扳机及同时最多 4 个按键。
5. 每步 20–1000 ms，最多 4 步。按键/轴每步自动归零；取消、失焦、窗口最小化和程序退出都会释放输入。取消后可能移除设备，下次任务会重新连接。

真实手柄通过 Pi 宿主桥接调用；“MCP 诊断”面板和独立 MCP 服务仍是内存模拟。驱动连接失败会报错，不回退成模拟成功。游戏目标完成情况仍需模型观察判断。

验证命令：`npm run test:virtual-gamepad` 通过独立 Windows XInputGetState 检查真实报告与归零；`npm run test:gamepad-loop` 验证本地脚本模型、真实窗口截图、真实手柄动作、反馈和落盘。结果分别在 artifacts/virtual-gamepad-check.json 与 artifacts/gamepad-loop-check.json。未验证具体游戏任务成功率。

驱动与库参考：[vgamepad](https://github.com/yannbouteiller/vgamepad)、[ViGEmBus](https://github.com/nefarius/ViGEmBus)。ViGEmBus 已停止维护，本机复用已有驱动，不自动替换系统驱动。

## 游戏 Agent 验收

1. `npm run build` 后 `npm start`，配置支持图片、工具调用和流式响应的模型。
2. 选择游戏窗口并启动预览，将顶部“执行模式”改为“真实键盘（实时窗口闭环）”。游戏需采用键盘控制；模拟器需将 WASD 等按键映射到游戏输入。
3. 输入“走到前面柱子处”，选择 60 或 120 秒并运行。系统会聚焦所选窗口。
4. Trace 应依次出现 capture_game、模型动作计划、keyboard_action、动作后截图、下一轮模型反馈。关键截图下拉框可查看过程图片。
5. 完成一次动作并收到模型反馈后显示“真实输入链路通过”；若模型只观察或目标不可见，则仅显示“回复完成”。

每步 20–1000 ms，最多 4 次动作、12 次工具调用、10 轮模型决策。按键自动释放，取消和窗口失焦会中断输入。Windows 权限不匹配或游戏拒绝合成输入时会报错或无法产生游戏变化。

自动验收：`npm run test:game-loop`。使用独立 Electron 测试窗口、真实窗口截图、真实 Windows 按键和本地脚本模型，检查完整闭环；结果在 `artifacts/keyboard-loop-check.json`。这证明工程链路，不代表真实视觉模型的游戏能力。

## 启动

需要 Node >=24.20.0，以及同级 Pi 源码目录（或 PI_SOURCE_DIR）固定在提交 4270522473e677ddba7b093caa0064a3df51d459。Pi Core/pi-ai 通过本地源码解析器用于检查，通过 esbuild 打包进入 Electron Main。

- 开发：npm run dev 或 ./start.ps1。
- 构建：npm run build；启动构建产物：npm start。
- 仅查看捕获：./start.ps1 -CaptureOnly。
- 独立模拟 MCP 服务：npm run mcp:gamepad。

模型连接可在顶部“模型 API”配置。也可使用 GAMEPILOT_CONFIG、GAMEPILOT_PROVIDER、GAMEPILOT_MODEL、GAMEPILOT_BASE_URL、GAMEPILOT_API_KEY；默认读取同级 Pi 的 .pi-agent/models.json。配置需要 OpenAI 兼容的图片、工具调用及流式响应。参见 [模型 API](docs/model-api.md)。

## 使用

1. 在“画面捕获”选择窗口并开始预览，或导入 PNG/JPEG。
2. 在“追踪 Trace”输入任务并运行。窗口模式在运行前重新捕获新帧；导入图片的采集时间未知。
3. 观察模型请求、公开文本、工具参数与回执。模拟模式最多四轮模型决策、四次工具请求；真实键盘模式最多十轮、十二次工具请求；总超时可选 30/60/120 秒。
4. 在“MCP 诊断”手动连接并操作模拟手柄；六种 MCP 工具、左右摇杆、按键和扳机均走同一实现。
5. 取消任务、总超时、断开手柄、停止预览或关闭应用会中断运行并归零模拟输入。任务期间禁止手动输入及修改模型配置。

任务控制台自动识别意图，Trace 保留显式任务入口，两者共用 Session 生命周期与 Pi 执行器。模型可只描述画面而不调用工具，此时显示“回复完成”；有模拟工具调用并获得后续回复时显示“模拟链路通过”。均不代表真实游戏目标完成。

## 结构

- src/main、src/preload：Electron 启动、IPC 和宿主能力。
- src/runtime/session.ts：单次任务生命周期、超时、取消、结果发布。
- src/agent：Pi 装配与模型/工具事件；不拥有另一个实验循环。
- src/models：模型配置连接与 Pi 模型适配。
- src/capture：窗口身份、实时预览和源帧屏障。
- src/input/simulated-controller.ts：任务与手动诊断共用的模拟控制权。
- src/mcp：六种控制器工具、统一参数验证、内存后端和 stdio 服务。
- src/trace/recorder.ts：输入图片、manifest、顺序 JSONL 事件和 summary。
- src/renderer：活动 UI、Trace 和模型配置面板；未引用的旧组件已清理。
- tests、scripts：保留功能的检查与构建入口。

P3/P4、Experiment、验收批次、离线实验审计、Web 沙盒 Runtime、旧版 Xbox/Python 输入和独立目标验证入口已移除；当前真实手柄使用新 ViGEm 桥接。仅保留 Trace 仍引用的历史进度和验证展示组件及类型。更详细的职责见 [核心结构](docs/core-structure.md)。

## 当前能力与执行问题

功能范围、验证边界及 Cemu 中错过交互提示的现场记录见 [当前能力与已知问题](docs/current-capabilities-and-known-issues.md)。当前动作完成后先释放输入，再截图和请求模型；模型思考期间不会保持上一动作，但游戏世界不会暂停。动作期间的视觉事件监测和条件停止尚未实现。

## 运行记录

每次新运行在 runs/<runId>/ 保存 manifest.json、events.jsonl、input.png/input.jpg、summary.json。schemaVersion=5 标记当前运行及真实/模拟输入后端；旧运行目录保持原样。

事件 sequence 由会话唯一分配。UI 与磁盘使用相同的脱敏事件；图片 Base64 不进入事件日志。采集图片和来源信息同时保存于 observations/，预览帧不逐帧落盘。模型配置、读取或选图不会请求模型，只有显式连接测试或运行任务才发送请求。

## 检查

npm run typecheck、npm run build、npm test、npm run test:runtime。
桌面检查：npm run test:ui、npm run test:model-api-ui、npm run test:capture、npm run test:capture-requests、npm run test:dev。原有检查使用本地模型接口和模拟控制器；test:game-loop 使用本地模型接口和真实键盘输入。
