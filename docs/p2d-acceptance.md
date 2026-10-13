# P2-D 实机补充验收

日期：2026-10-13。范围：补齐目标验证的实机样例，不启动 P3 反馈技能，不将一次成功算作 P4 验收。

## 当前证据

| 运行 | 实际结果 | 能证明什么 |
| --- | --- | --- |
| f7703e7c-3fa7-4f1e-b443-147abee917f1 | wait_for_state，零移动；succeeded / passed；用户确认 | 真实 Cemu/豆包只读条件判断，归零后新帧、独立验证和 Trace |
| 484cb508-41d5-4ecb-afbd-ae0c15b545d3 | 前移请求 1200ms，服务测量 1218ms；blocked / inconclusive；用户确认前移后停止 | 真实动作后取帧与独立无法判断；证据不足时拒绝继续移动，不证明已到墙前 |
| e82bbf83-e256-42bf-aa27-25b3a0cf7c75 | 只读文字负例；首次 VLM failed，第二次轮询等待到期；最终 blocked / inconclusive；用户确认测试成功 | 零移动、未误报成功、有界退出；不是最终明确 failed 的负例验收通过 |
| 0cf0c2f0-7ad5-4a19-8cd8-6d0c9cd217bf | 准备期间失焦，failed / unverified；无验证帧 | 保留的失焦中止记录；不能替代验证期间 F8 的 canceled 样例 |

墙壁样例初始帧 3652、后置帧 3668；releaseId=6f81f6db-1fe4-4a2c-bcda-68213c026064，执行及 neutral=true 已确认。Verifier 指出墙壁目标不明确、缺少可靠距离线索、静态截图不足以判断持续停止。Planner 第二轮请求再前移 1500ms，工具门禁返回“证据不足，禁止盲目移动”，没有第二次实际输入。summary 的 moves=1 与工具请求两次不是矛盾：后者含一次被拒绝的请求。

不要为得到绿色结果放宽此历史运行的条件或修改摘要。“停止在墙壁面前”同时含位置和时间状态，当前两张截图不一定可观测。手柄 neutral 只能证明输入释放，不能证明角色动画已静止或达到墙前。下一次先明确哪面墙/哪个可见地标及可从前后截图判断的相对变化；需要持续静止证据时，应另行设计多帧验证，不能用回执代替。

文字负例补充（用户于 2026-10-13 确认）：运行 e82bbf83-e256-42bf-aa27-25b3a0cf7c75，moves=0、waits=1、observations=3、verifierCalls=2。事件 157 的独立 VLM 明确判定目标文字不存在，verdict=failed；事件 161 因第二次验证未在剩余等待预算内完成，返回 evidence-check/inconclusive。最终 blocked/inconclusive，服务归零已确认。只读结构检查成立，但 `--case negative` 按预先固定的最终 VLM failed / blocked 标准返回退出码 1；不能将中途 failed 偷换为最终 failed，也不能将最后一轮测量约 3567ms 当作整个 10000ms 等待预算。此样例证明未误报成功与预算退出，严格负例仍需补齐；没有新增 F8 取消证据。

## UI 入口（不自动执行）

重新启动应用，选择真实 Cemu 窗口并预览，连接真实虚拟 Xbox，在右侧选择“真实工具 + 目标验证”。展开“P2-D 验收指令”，选择样例后点击“填入指令与条件”；只替换当前草稿，不请求模型、不发送输入、不自动运行。运行期间不能填入。移动样例的成功条件故意留空，必须按真实场景填写。

| 样例 ID | 前提与操作 | 预期 |
| --- | --- | --- |
| hud | 生命值 HUD 可见，零移动只读等待 | passed / succeeded，人工核对心形图标 |
| move | 无敌人/悬崖/菜单的安全场景；填写实际地标与明确可见判据；一次前移 500ms | 动作释放后独立验证；达标才 passed，否则保留受阻证据 |
| negative | 人工确认游戏画面没有完整文字 GAMEPILOT_TEST_TARGET_7F3A；不移动 | VLM failed / blocked，不误报通过 |
| unknown | 没有世界坐标/精确距离读数；要求截图证明恰好 3.000 米；不移动 | VLM inconclusive / blocked，不猜测距离 |
| cancel | 只读 HUD 条件；保持 Cemu 前台，独立验证进行中按 F8 | canceled / unverified，最终服务确认归零；若先结束则重测 |

先做 negative，再做验证期间 F8，随后补移动正例；unknown 的墙壁样例已经提供一种实际证据不足案例，但不替代固定任务集。提示词中的“只调用一次”不改变宿主既有最多两次移动/一次等待预算；核对实际请求和输入次数，违规追加应作为失败样例保留。

如果 10 秒等待预算先耗尽，保留 timed_out/inconclusive；不能当作 VLM 明确 failed 的负例通过。测试期间必须人工保持 Cemu 前台，失焦不是 F8 验收。动作期间取消、关闭窗口、迟到动作及重复统计仍需分别测试。

## 只读证据检查

```powershell
cd D:\work\GamePilot
npm run audit:run -- --run f7703e7c-3fa7-4f1e-b443-147abee917f1 --case hud
npm run audit:run -- --run 484cb508-41d5-4ecb-afbd-ae0c15b545d3
```

新运行使用右下角 RUN 的完整 UUID（或日志目录名），可加 `--case negative`、`--case unknown`、`--case cancel`、`--case move`。必须指定运行，避免误读“最新”的自动测试记录。无 `--case` 只核对结构，不要求目标成功；有 `--case` 则额外核对固定条件、调用与预期三态。旧墙壁样例不是新 500ms 移动正例，不应加 `--case move`。

工具只读 manifest/events/summary/关键帧和 input，不连接游戏、模型、Python，不改写记录。检查序号、最终摘要一致性、初始输入字节、关键帧路径/存在性、释放及新帧屏障、目标/验证引用和取消不误报通过。缺失或损坏记录失败；本地模型、模拟或明确测试标记不得作为实机样例通过。

输出 `technicalPassed=true` 仅代表所检查的技术条件成立；始终 `humanReview=required`、`physicalInputVerified=null`。它不能证明图像语义、日志真实性或实际游戏成功；也不能仅从 canceled 推断 F8 触发或计算取消 P95。退出码：0=检查通过，1=证据/样例不满足，2=命令参数错误。控制台不输出截图、原始模型内容或配置凭据。

## 剩余验收

记录负例明确 failed、验证期间 F8、移动正例及其他取消竞态；每次人工对照关键截图和真实反应。P4 在固定场景下按开发文档每类 5 次保存所有结果，停止时延不少于 20 次单独测量。当前不宣称重复验收或泛化完成。

自动回归：`npm run test:acceptance`（19 项只读审计/模板检查）、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:agent-ui`。Electron 测试使用本地模型、受控焦点和 Python dry-run，验证模板不启动任务、缺少移动条件禁用运行以及忙碌时禁用模板；不是实机任务证据。
