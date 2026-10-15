# 模型 API

通过 npm run dev 或 npm start 启动 Electron，点击顶部“模型 API”，填写服务名称、OpenAI 兼容的 Base URL、模型 ID、API Key，并声明是否支持图片输入。

Base URL 不应包含 /chat/completions。远程地址使用 HTTPS，本机回环服务可以使用 HTTP。保存后点击“测试当前连接”：测试发送短文字及可选的示例图片，不发送当前窗口画面或手柄命令。

当前视觉任务需要图片、工具调用和流式响应。连接测试仅确认端点返回兼容文本；完整能力通过实际任务的 Trace 观察。纯文本连接可以进行连接测试，视觉任务运行按钮会被禁用。

会话配置和 Key 仅保存在 Electron Main 内存中，重启后清除。保存、读取配置不发请求。Key 不回传给 Renderer、不写入 localStorage 或运行日志；同端点留空 Key 可沿用已保存值，切换端点需填写新 Key。运行期间不能更改或测试配置。

“恢复环境配置”使用 GAMEPILOT_CONFIG、GAMEPILOT_PROVIDER、GAMEPILOT_MODEL、GAMEPILOT_BASE_URL、GAMEPILOT_API_KEY；默认读取同级 Pi 的 .pi-agent/models.json。环境变量引用支持 $VAR 和 ${VAR}，拒绝命令型引用。

错误明确区分 HTTP401/403、404、429、超时与格式问题。连接测试超时 15 秒；错误不展示接口的原始敏感正文。Runtime 请求失败会如实结束，不回退到预设模型回复。

任务按执行模式使用内存模拟手柄、真实键盘或 ViGEm Xbox360 虚拟手柄。模型回复与工具回执本身不能证明游戏目标达成。
