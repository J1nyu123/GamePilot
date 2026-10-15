# 当前核心结构

用户确认的保留范围：UI、Electron/Pi Runtime、Trace 展示、模型请求、真实窗口捕获、模拟手柄 MCP、实时事件与运行落盘。

## 活动依赖

Renderer → preload IPC → Main：
- 捕获请求 → CaptureController → WindowStream / NativeWindows。
- 模型配置 → ModelConnection / model-config。
- 运行请求 → DebugSession → SimulatedInputController.withRun → Pi Runtime。
- Pi 工具 → 统一 MCP dispatcher → ControllerBackend。
- 运行事件 → RunRecorder 队列与 Renderer Trace。
- 运行结束 → 模拟归零 → 事件写入完成 → summary 与结束状态。

只有 Pi 拥有模型/工具循环。Session 管理生命周期；Recorder 负责文件；MCP 后端负责内存输入。Renderer 不运行另一套任务循环。

## 保留组件

src/renderer/components/ 保留 8 个可从 App 到达的组件文件：InputPreview、AgentTranscript、AgentComposer、InputDebugPanel、ChatAgentConsole、ModelConnectionPanel，以及 Trace 引用的 ApproachProgress、VerificationItem。未引用的 AcceptancePresets、ApproachSetup、CaptureToolbar、ToolCallItem、ZeldaArenaCanvas 已删除，同时清理专属样式、ApproachSpec 和演示画布相关的聊天属性。contracts/approach.ts、verification.ts 仍保留 Trace 使用的展示类型和历史事件字段，没有实验或验证算法。

## 已移除范围

P3/P4 实验编排与技能、状态估计、独立目标验证、离线验收审计、冻结批次及模板、Web/2.5D 执行 Runtime、Gemini 专用后端、旧版 Xbox/Python 输入、对应命令与检查。原 runtime/p1 的活动 Pi 模块已迁到 src/agent 与 src/models，源码解析入口迁到 scripts/pi-source.mjs。当前真实键盘与 ViGEm 手柄为下述新闭环实现。

## 数据与兼容

runs、observations、input-debug、artifacts 中的历史数据保留。当前新运行使用 schemaVersion=5，simulated 根据执行模式设置，gameOutcome=unverified。旧显示字段仅用于保留的组件，不授权成功结果。

安装包分发不在本次清理范围内，构建仍依赖固定提交的同级 Pi 源码。用户原有 API 配置面板、密钥脱敏与源码改动已纳入本次清理前备份。

## 游戏闭环增量

真实键盘模式：DebugSession → gameLoopRegistry → Pi Runtime。模型先调用 capture_game，随后 keyboard_action → NativeWindows 聚焦并核对身份 → Windows SendInput 按下/释放 → 新源帧屏障截图 → 图片工具回执 → 同一模型上下文再次决策。

Session 将过程截图保存到本次 runs 目录并发布 observation_post；图片二进制不进入 JSONL。真实输入完成且模型给出后续公开反馈时为 control_passed；不会自动宣称游戏目标成功。

参考设计：Cradle 的 skill_execute.py 动作后捕获和 self_reflection.py 反馈思路；BetterGI 的窗口捕获/原生输入分层。此增量独立实现，没有复制参考项目代码。Lumine 是训练后的实时游戏策略，本实现使用通用视觉模型工具循环，不具备其训练数据或高频控制能力。

参考链接：https://www.lumine-ai.org/ 、https://github.com/babalae/better-genshin-impact 。

## 会话分流

任务控制台 → sendMessage → DebugSession（可无输入图片）→ runConversation。第一阶段无图片、无游戏工具，返回经 Zod 校验的 chat / observe / act / clarify。只有 observe/act 且满足阈值才调用宿主任务回调。observe 的执行器工具列表为空；act 使用现有 GameLoop 或模拟 MCP。缺少资源仅阻止游戏任务。

分类阶段与任务阶段共享 Session 的取消信号和总超时。聊天上下文由 Main 持有，保留 12 条文本消息；不携带历史工具权限或旧截图。无效结构回退到澄清。Trace 的显式 startRun 不经过分类，用于调试。

## 真实手柄后端

选择 gamepad 模式时使用 gamepadLoopRegistry，共享游戏闭环的预算、观察与截图反馈；动作改为 gamepad_action。Main 的 VirtualGamepad 通过 JSON-lines 与 Python 桥接通信，桥接持有 ViGEm Xbox360 设备。stdin 读取线程可中断动作；动作工作线程独占设备，检查窗口焦点/PID并在 finally 中归零。EOF 会释放设备。Node 超时会移除客户端进程及其设备，不假定输入成功。

连接按钮可提前创建设备供游戏配置；退出应用和断开按钮关闭桥接。内存模拟手柄及其 MCP 服务保持独立。
