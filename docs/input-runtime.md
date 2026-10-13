# P2-B 输入服务与取消

日期：2026-10-12。状态：实现及自动验证完成；用户确认真实 Cemu 手动输入/停止验证成功。P2-C 已增加可选真实模型工具，详见 [visual-tool-runtime.md](visual-tool-runtime.md)。

## 实机确认记录

用户先确认 A 按键生效，随后确认移动/停止验证成功。input-debug/events.jsonl 已核实真实模式下以下结果：

- A：runId=06e926a5-e4c1-414d-ab1e-24ead20a0449，executed，neutral=true。
- 左移：runId=6f51cfab-561f-4bc8-a02a-da6826c742ce，executed，neutral=true。
- 前移：runId=52d2e17c-02b0-46fa-bc32-f9b596876038，executed，neutral=true。
- 失焦：runId=4cc8d654-1dbf-4e2f-b085-c411142f6356，cancelled，归零已确认；这是准备期取消，不是执行期间取消证据。

游戏画面反应及长动作/F8 停止按用户反馈记录；当前日志未找到长动作/F8 对应样例。不少于 20 次实机取消统计尚未收集，不能将本次基本验证宣称为性能或跨场景验收。之前 A 无反应的日志显示准备 3 秒后失焦、未进入 action_start；实际 Cemu 置前后按键成功。

Python 3.12.0 与 vgamepad 0.1.0 复用已有 `D:\work\GamePilot-input-test\.venv`。服务根据用户选择才创建虚拟 Xbox，启动仅归零；dry-run 不导入 vgamepad。新服务来自冻结原型的验证与输入封装，新增租约、失效队列、进度事件及独立输出线程，原型源码保持冻结。

## 界面验证

```powershell
cd D:\work\GamePilot
.\start.ps1 -CaptureOnly
```

关闭旧窗口并在原终端 Ctrl+C 后重启，才能加载新 Main/preload。无需模型 API 来测试输入服务。

展开“手柄输入调试 / P2-B”。默认“模拟服务 · 无设备”；连接后可执行 move_for 或 press_button，分别检查自然结束与 1500ms 动作中途“停止并归零”。归零状态只在 Python ACK 后显示。协议记录可展开，日志在 input-debug/events.jsonl。

真实输入验收：

1. 在 Cemu 中进入可操作场景，选择 Cemu 并开始预览。
2. 断开模拟服务，选择“真实虚拟 Xbox”，点击连接。必要时在 Cemu 输入设置选择新设备并检查左右摇杆映射；程序不修改配置。
3. 初次使用 move_for、力度 0.5、时长 200ms。点击“执行（3秒准备）”后，在 3 秒内切换到 Cemu。
4. 观察动作后停止，再返回调试台核对 executed 与 neutral=true；这只证明输入执行，游戏效果由人工核对。
5. 验证长动作时设置 1500ms，切换到游戏后在动作期间按 F8。核对 cancelled、归零确认及 reset ACK；不是仅在准备期取消。
6. 测试执行期间 Alt+Tab 失焦：系统中断并归零。分别验证自然结束、用户停止、失焦、断开和关闭应用。

F8 停止手柄服务，并取消拥有真实输入权限的模型任务；不会取消独立的模拟模型任务。注册被占用时真实模式连接失败，避免宣称已有紧急停止快捷键。右侧默认模拟；P2-C 中需单独选择真实模型工具模式。

## 协议与安全不变量

私有 stdin/stdout JSONL，protocol=2。runId 由 Main 创建，generation 由服务分配：

```text
ready(protocol=2, backend, neutral=true)
begin(runId) -> generation, neutral=true
execute_sequence(runId, generation, actions) -> queued/action_start/action_end -> executed/cancelled/error
reset -> generation++, neutral=true ACK
shutdown -> neutral ACK -> EOF/退出
```

- 动作整体校验后入队；最多 8 个动作，每个 20–1500ms，总时长 ≤4000ms。按钮最多 3 个，轴 [-1,1]，扳机 [0,1]；拒绝 NaN/Infinity、bool 时长、未知按钮及字段。
- 一个读取线程、一个执行线程、一个看门狗及一个输出线程。stdout 阻塞不持有设备锁；输出队列背压使服务停止输入。
- 唯一设备锁覆盖每次 apply/reset。reset 先使旧取消事件和 generation 失效，再调用 reset/update；ACK 之后，旧 worker 和队列不能写回非零输入。
- 同一进程持续执行有界动作，每动作归零；当前不实现跨动作持续按住。服务队列最多 16 个请求，UI/Main 同时只允许一个手动动作。
- Main 每 500ms ping；服务约 2 秒心跳丢失复位。EOF 正常清理；强制终止不能依赖 finally，但设备会断开，Main 不伪造 neutral ACK。
- 真实输入绑定预览中的窗口身份与 capture generation，准备后验证前台窗口；执行期间每 50ms 检查，失焦/关闭/最小化/会话失效发送 reset。迟到的旧焦点检查不能停止新任务。
- 模型任务与手动输入互斥执行。控制连接不会自动发送按键，取消不进入动作队列。
- reset ACK 仅表示服务成功调用驱动 reset/update；不能据此宣称游戏目标成功。复位失败或超时显示未知并拒绝成功结果。
- 关闭窗口先等待输入 reset/shutdown；通信失败则断开设备并保留“复位未确认”的区别。

## 文件

```text
python/gamepad_service.py          驱动、协议、worker、队列、看门狗
python/test_gamepad_service.py     可控竞态/复位失败测试
src/input/python-client.ts        进程、请求、心跳、ACK 与退出
src/input/manual-controller.ts    生命周期、停止、窗口保护
src/input/skills.ts               move_for / press_button 参数与映射
src/contracts/input.ts            协议和界面状态
src/renderer/components/InputDebugPanel.tsx
tests/input.test.ts               真实 Python 进程契约/故障测试（dry-run）
tests/input-ui-smoke.mjs           Electron 输入界面测试（dry-run）
```

## 已验证结果

- 21 项 Node/采集/输入测试、4 项 Python 单测通过；原 P1 11 项回归保留。
- 真实 Python 进程验证重复执行、长动作中断、排队取消、旧 generation 拒绝、新租约恢复、心跳丢失、EOF 及 Python 强制退出。
- 焦点失效与迟到检查通过注入 dry-run 设备验证；无真实移动。
- 20 次独立取消的 dry-run ACK P95 当前约 0.26ms，文件 artifacts/input-cancel-latency.json。此为本机私有管道/模拟后端测量，不是实际游戏或硬件停止 P95。
- 真实 vgamepad 驱动连接、初始归零、reset ACK、断开通过；实际 Electron 中真实模式连接、F8 注册/释放及归零通过。这些探测共发送 0 次移动/按键，Cemu 输入映射仍需人工验证。
- 输入 UI 已验证连接、两个技能、停止确认、JSON 结果、断开及执行中关闭窗口；TypeScript 和构建通过。

命令：`npm test`、`npm run test:python`、`npm run test:input-ui`。显式真实驱动归零探测：`npm run probe:driver` 或 `npm run probe:driver-ui`（无移动/按键）。

自动证据：artifacts/input-cancel-latency.json、input-driver-probe.json、input-driver-ui-probe.json、p2b-input-debug.png。实机输入日志与用户反馈见上方确认记录；20 次实机取消统计不在这些自动测试中，仍未完成。
