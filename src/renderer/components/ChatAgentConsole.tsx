import { useState, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  status?: 'thinking' | 'moving' | 'completed' | 'error';
  targetColor?: 'red' | 'yellow' | 'blue';
  toolCallSummary?: string;
  isMilestone?: boolean;
}

interface ApiStatus {
  ok: boolean;
  hasApiKey: boolean;
  isOperational?: boolean;
  model: string;
  mode: string;
  provider: string;
  message: string;
}

export default function ChatAgentConsole({
  messages,
  onSendMessage,
  busy,
  activeTarget: _activeTarget,
  onCancel,
  sandbox,
  modelId,
  canSend,
}: {
  messages: ChatMessage[];
  onSendMessage(text: string): void;
  busy: boolean;
  activeTarget?: 'red' | 'yellow' | 'blue' | null;
  onCancel?(): void;
  sandbox: boolean;
  modelId?: string;
  canSend: boolean;
}) {
  const [input, setInput] = useState('');
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!sandbox) { setApiStatus(null); return; }
    fetch('/api/gemini/status')
      .then(res => res.json())
      .then(data => setApiStatus(data))
      .catch(() => {
        setApiStatus({
          ok: false,
          hasApiKey: false,
          model: 'local-sandbox-planner',
          mode: 'sandbox-simulation',
          provider: '@google/genai',
          message: '本地仿真引擎运行中',
        });
      });
  }, [sandbox]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy || !canSend) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const quickPrompts = [
    { label: '你是什么模型？', prompt: '你是什么模型？' },
    { label: '走到蓝色目标位置之后再走到红色目标位置', prompt: '走到蓝色目标位置之后再走到红色目标位置' },
    { label: '巡回: 黄 ➔ 蓝 ➔ 红', prompt: '先走到黄色目标，再走到蓝色目标，最后走到红色目标' },
    { label: '走到红色目标位置 (火之祭坛)', prompt: '走到红色目标位置 (火之祭坛)' },
    { label: '走到黄色目标位置 (雷之祭坛)', prompt: '走到黄色目标位置 (雷之祭坛)' },
    { label: '走到蓝色目标位置 (水之祭坛)', prompt: '走到蓝色目标位置 (水之祭坛)' },
  ];

  return (
    <div className="tui-console-container">
      {/* TUI Status Bar */}
      <div className="tui-status-bar">
        <div className="tui-status-left">
          <span className="tui-spark-symbol">✢</span>
          <span className="tui-brand-text">
            {sandbox ? apiStatus?.isOperational ? apiStatus.model : 'local-sandbox-planner' : modelId || '模型配置待就绪'}
          </span>
          <span className="tui-dim-sep">·</span>
          <span className={`tui-status-indicator ${apiStatus?.isOperational ? 'online' : 'sim'}`}>
            {sandbox ? apiStatus?.isOperational ? 'cloud planning · simulated control' : 'sandbox simulation' : 'Electron task runtime'}
          </span>
        </div>
        <div className="tui-status-right">
          <span className="tui-dim-label">protocol:</span>
          <span className="tui-code-highlight">gamepad_zero_prior</span>
        </div>
      </div>

      {/* CLI Quick Action Macros */}
      <div className="tui-macros-bar">
        <span className="tui-macros-title">$ quick:</span>
        <div className="tui-macros-list">
          {quickPrompts.map(q => (
            <button
              key={q.label}
              type="button"
              className="tui-macro-btn"
              disabled={busy}
              onClick={() => setInput(q.prompt)}
              title={q.prompt}
            >
              ❯ {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pure CLI Stream Viewport (Strictly NO Cards/Boxes, Pure Terminal Layout) */}
      <div className="tui-stream-viewport">
        {messages.length === 0 ? (
          <div className="tui-empty-terminal">
            <div className="tui-empty-brand">
              <span className="tui-prompt-symbol">❯_</span>
              <span className="tui-empty-title">GAMEPILOT TUI COPILOT</span>
            </div>
            <div className="tui-empty-desc">
              系统处于就绪状态。输入自然语言指令驱动视觉-控制闭环。
            </div>
            <div className="tui-empty-examples">
              <div className="tui-example-line">
                <span className="tui-prompt-symbol">❯</span>
                <span className="tui-example-cmd">你是什么模型？</span>
              </div>
              <div className="tui-example-line">
                <span className="tui-prompt-symbol">❯</span>
                <span className="tui-example-cmd">走到蓝色目标位置之后再走到红色目标位置</span>
              </div>
            </div>
          </div>
        ) : (
          messages.map(msg => {
            const isUser = msg.role === 'user';
            const isMilestone = msg.isMilestone;
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            if (isUser) {
              return (
                <div key={msg.id} className="tui-stream-entry tui-entry-user">
                  <div className="tui-entry-content">
                    <span className="tui-prompt-glyph">❯</span>
                    <span className="tui-cmd-text">{msg.text}</span>
                  </div>
                  <span className="tui-time-stamp">{timeStr}</span>
                </div>
              );
            }

            if (isMilestone) {
              return (
                <div key={msg.id} className="tui-stream-entry tui-entry-milestone">
                  <div className="tui-entry-content">
                    <span className="tui-glyph-check">✔</span>
                    <span className="tui-milestone-badge">MILESTONE</span>
                    <span className="tui-milestone-text">{msg.text}</span>
                  </div>
                  <span className="tui-time-stamp">{timeStr}</span>
                </div>
              );
            }

            // Assistant Response
            return (
              <div key={msg.id} className="tui-stream-entry tui-entry-assistant">
                <div className="tui-assistant-header">
                  <span className="tui-spark-glyph">✢</span>
                  <span className="tui-assistant-name">GamePilot</span>
                  {msg.status === 'thinking' && (
                    <span className="tui-live-status status-thinking">
                      <span className="activity-dot" /> 思考中...
                    </span>
                  )}
                  {msg.status === 'moving' && (
                    <span className="tui-live-status status-moving">
                      <span className="activity-dot dot-amber" /> 手柄移动中...
                    </span>
                  )}
                  <span className="tui-time-stamp">{timeStr}</span>
                </div>

                {/* Unboxed pure streaming text */}
                <div className="tui-assistant-text">
                  {msg.text}
                </div>

                {/* Claude Code Style Tree Branch for Tool Call / Action Telemetry */}
                {msg.toolCallSummary && (
                  <div className="tui-tree-group">
                    <div className="tui-tree-node">
                      <span className="tui-tool-dot">⏺</span>
                      <span className="tui-tool-label">Tool:</span>
                      <span className="tui-tool-desc">{msg.toolCallSummary}</span>
                    </div>
                    <div className="tui-tree-leaf">
                      <span className="tui-tree-joint">⎿</span>
                      <span className="tui-leaf-text">{sandbox ? '画布模拟调用 · 实机未验证' : '执行状态与独立验证见 Trace'}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Terminal Command Line Input Bar */}
      <form onSubmit={handleSubmit} className="tui-cli-bar">
        <span className="tui-cli-chevron">❯</span>
        <input
          type="text"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault(); }}
          placeholder={busy ? 'Agent 正在执行决策回路... (请稍候)' : '输入指令，如：走到蓝色目标位置之后再走到红色目标位置...'}
          className="tui-cli-input"
          autoComplete="off"
          spellCheck={false}
        />
        {busy && onCancel ? (
          <button
            type="button"
            className="tui-cli-btn danger"
            onClick={onCancel}
          >
            ⏹ 终止
          </button>
        ) : (
          <button
            type="submit"
            className="tui-cli-btn submit"
            disabled={busy || !canSend || !input.trim()}
          >
            {busy ? '执行中' : '执行 ⏎'}
          </button>
        )}
      </form>
    </div>
  );
}
