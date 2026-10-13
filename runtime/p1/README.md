# GamePilot P1 独立验证程序

目的：验证 **截图 → pi-ai 视觉模型请求 → Pi Core 工具调度 → 模拟工具结果 → 下一轮模型回复**。
不依赖 UI-TARS，不启动 Electron、不捕获窗口、不连接 Python 或虚拟手柄，不改动冻结原型。
本工程使用 Node 原生 ESM，无额外 npm 依赖；通过 Pi 自带 source resolver 加载本地 TypeScript 源码。
这是 P1 集成验证器，不是完整 GamePilot，也不是 Pi coding-agent 的交互终端。

## 环境与版本

- 验证环境：Windows / Node 24.20.0。
- Pi 源码默认目录：`D:\work\pi`（与本工程同级）；可用 `PI_SOURCE_DIR` 修改。
- 固定提交：`4270522473e677ddba7b093caa0064a3df51d459`，启动时检查 HEAD。
- `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`：1.1.0。
- Pi package-lock.json SHA256：`2E348EF81A4F3A8781437FB856316A29C8BBFA248D2C04A71DB9DB1045364E31`。
- 依赖复用 Pi 已安装的 node_modules。重新部署时在 Pi 目录执行 `npm ci --ignore-scripts`。
- 不调用上游构建，不改变上游源码。HEAD 检查不意味着工作区未修改；复现实验时另检查 Pi 的 `git status --short` 和上述锁文件哈希。

## 1. 离线验证（无需密钥，不联网访问模型）

```powershell
cd D:\work\GamePilot-p1
npm test
```

测试启动仅监听 127.0.0.1 的临时 OpenAI-compatible SSE 接口；使用真实 Pi Core 和 pi-ai 发请求。
覆盖图片序列化、工具调用/参数验证、工具结果回传、模型文本事件、执行异常、取消、请求超时、鉴权异常、缺少工具调用和循环预算。
模拟响应不是视觉理解证据。测试内嵌 1×1 图片只用于检查传输协议。

## 2. 真实视觉模型验证

关闭或保留已启动的 Pi 交互终端均可，本程序在另一个 PowerShell 运行。
先选择可同时处理图片与工具调用的模型，设置其 OpenAI Chat Completions 兼容端点：

```powershell
cd D:\work\GamePilot-p1
$env:GAMEPILOT_BASE_URL = 'https://你的模型服务/API根路径'
$env:GAMEPILOT_MODEL = '你的模型或部署ID'
$secret = Read-Host '输入 API Key（不要粘贴到聊天）' -AsSecureString
$env:GAMEPILOT_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
npm start -- --image 'D:\screenshots\cemu.png' --prompt '描述截图中可见的游戏状态，然后调用 move_for 模拟向左移动 200 毫秒。'
Remove-Item Env:GAMEPILOT_API_KEY
```

端点填写 API 根路径，不包含 `/chat/completions`；程序会通过 pi-ai 添加请求路径。
使用你已有服务的准确端点，不要直接照抄占位符。远程端点必须为 HTTPS。
运行会把指定截图和任务发送到该端点。默认没有任何远程地址，也不会读取 UI-TARS 或 Pi CLI 中保存的密钥。
本版仅支持 OpenAI Chat Completions 兼容接口，不保证所有供应商或推理模型兼容；模型上下文与输出上限是测试配置，费用统计未启用。

截图支持 PNG/JPEG，最大 10 MiB。推荐使用只含游戏画面的截图，并检查敏感信息。
默认总超时 30 秒，可添加 `--timeout-ms 60000`。Ctrl+C 取消模型请求或模拟动作。
最多 4 个决策轮次 / 4 个通过参数校验的工具请求，避免持续循环。

## 结果与实时过程

终端实时输出 JSONL：轮次、模型可展示文本、工具参数增量、工具开始、工具结束、最终状态。
不输出模型私有推理内容，不把 `agent_end` 当作成功。

每次运行保存到 `runs/<taskId>/`：

- `manifest.json`：版本、模型、任务与输入信息（不保存密钥）。
- `input.png` 或 `input.jpg`：实际发送的输入截图。
- `events.jsonl`：有序实时事件。
- `summary.json`：验证结果。

记录包含任务和截图，应作为本地敏感实验数据管理；`runs/` 已加入忽略规则。
`protocol_passed` 仅表示模拟工具完成且模型随后返回最终文本，退出码为 0。
`failed`、`canceled`、`timed_out`、`budget_exceeded`、`incomplete` 均返回非零退出码。
所有结果明确标记 `simulated: true` 和 `gameOutcome: unverified`，不宣称真实游戏目标成功。
工具的 durationMs 参数是请求时长；若上游没有提供测得耗时，事件不捏造耗时。

## P1 验收边界

离线测试通过后，还需人工执行真实模型测试，核对：

1. 模型能描述截图中实际可见的内容，不能只看工具调用成功。
2. 自主选择正确方向和时长，并显示实时反馈。
3. 工具返回后明确知道这是模拟结果，不能宣称真实游戏已移动。
4. 不同截图和自然语言任务下重复测试，保存运行记录。

真实游戏捕获、手柄复位 ACK、动作后新鲜截图、Verifier 判断均属于后续 P2，不在这里伪造。

## 文件结构

```text
GamePilot-p1/
  package.json                 启动与测试入口
  scripts/pi-source.mjs        固定 Pi 提交，加载本地源码
  src/runtime.mjs              Agent、模拟 move_for、事件与取消
  src/cli.mjs                  截图/配置输入和本地日志
  test/runtime.test.mjs        本地 SSE 模型协议测试
  runs/                       每次真实验证的输出（忽略）
```
