# GamePilot-dev 整合记录

本地原提交：`14fe72c9ee7827e1caa9ab32aa78cd51ba95f3d2`。
合入来源：`https://github.com/J1nyu123/GamePilot-dev.git`，提交 `078ec9aa5cc1acba7f9f3253977de0a8043e5108`。
两仓库提交历史独立，通过保留双方父提交的 merge 合并；本地既有 Runtime、Runner、Experiment、Verifier、主进程和 Python 输入协议继续保留。

## 启动

| 用途 | 命令 | 产物 / 服务 |
| --- | --- | --- |
| Electron 开发 | `npm run dev` 或 `./start.ps1` | 127.0.0.1:5174 + Electron |
| Electron 生产 | `npm run build`，`npm start` | dist/main、dist/preload、dist/renderer |
| Web 开发 | `npm run dev:web` | http://127.0.0.1:3000 |
| Web 生产 | `npm run build:web`，`npm run start:web` | dist/web + 本地 Express 服务 |
| MCP 模拟 | `npm run mcp:gamepad` | stdio、内存手柄状态 |

依赖统一用 npm 和 package-lock.json；没有保留 dev 的 bun.lock，避免两个锁文件互相漂移。
Vite/tsx 分别更新至兼容修复版 6.4.4/4.23.15，以修复 npm audit 在旧版本中检测到的问题；依赖审计为零漏洞。

## 兼容处理

- Electron 通过 preload 保留既有主进程接口；沙盒使用独立 Web adapter。切换执行环境仅限空闲状态，查看关键帧不会切换执行后端。
- 实机提交保留用户的成功条件、P3 参数与 P4 冻结分配；运行按钮继续检查模型、图像、采集、手柄和执行模式。
- Task Console 在 Electron 中发送当前模式的游戏任务。沙盒可解析导航或返回对话；离线回复是预设文本。它不是已经接入 Electron 的独立纯文本 Chat Runtime。
- 模型名称读取实际配置；模拟接口没有真实手柄能力，模拟通过只表示协议/沙盒运行完成。沙盒不创建独立视觉验证结论，不能成为 P3/P4 验收证据。
- MCP 原生桥接没有读取 Python begin 的租约 generation、执行 ACK 或心跳。当前禁用该未经验证的自动原生连接，并为所有模拟保持动作添加最长 10 秒自动释放。实机功能由既有 Electron 服务继续提供。
- 生产 Web 路由适配 Express 5 通配符；默认仅监听回环地址。保留本地 CSP。

## 验证边界

类型检查、桌面/Web 构建、核心与 P3/P4/MCP 测试、界面集成测试均使用本地模拟模型或 Python dry-run。界面测试覆盖桌面图片与工具请求、错误脱敏、取消、P4 配置入口、沙盒隔离、Web 多目标及取消。

本次不运行真实游戏输入，不将模拟结果记作新增实机验收。MCP 原生接入需先实现租约/ACK/心跳、焦点及取消一致性，再进行专项验证。
