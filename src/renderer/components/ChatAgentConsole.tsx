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
  model: string;
  mode: string;
  provider: string;
  message: string;
}

export default function ChatAgentConsole({
  messages,
  onSendMessage,
  busy,
  activeTarget,
}: {
  messages: ChatMessage[];
  onSendMessage(text: string): void;
  busy: boolean;
  activeTarget?: 'red' | 'yellow' | 'blue' | null;
}) {
  const [input, setInput] = useState('');
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetch('/api/gemini/status')
      .then(res => res.json())
      .then(data => setApiStatus(data))
      .catch(() => {
        setApiStatus({
          ok: false,
          hasApiKey: false,
          model: 'gemini-3.8-flash',
          mode: 'sandbox-simulation',
          provider: '@google/genai',
          message: '本地仿真引擎运行中',
        });
      });
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const quickPrompts = [
    { label: '🤖 你是什么模型？', prompt: '你是什么模型？' },
    { label: '🔗 走到蓝色之后再走到红色', prompt: '走到蓝色目标位置之后再走到红色目标位置' },
    { label: '🔄 巡回路径: 黄 ➔ 蓝 ➔ 红', prompt: '先走到黄色目标，再走到蓝色目标，最后走到红色目标' },
    { label: '🔴 走到红色目标 (火之祭坛)', prompt: '走到红色目标位置 (火之祭坛)' },
    { label: '🟡 走到黄色目标 (雷之祭坛)', prompt: '走到黄色目标位置 (雷之祭坛)' },
    { label: '🔵 走到蓝色目标 (水之祭坛)', prompt: '走到蓝色目标位置 (水之祭坛)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Model & API Status Ribbon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 14px',
        background: '#0e131b',
        borderBottom: '1px solid #1e2634',
        fontSize: '11px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: apiStatus?.hasApiKey ? '#22c55e' : '#eab308',
            boxShadow: apiStatus?.hasApiKey ? '0 0 6px #22c55e' : '0 0 6px #eab308',
          }} />
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
            {apiStatus?.hasApiKey ? 'Google Gemini 3.8 Flash (云端直连)' : 'Gemini 3.8 Flash 架构 (沙盒闭环引擎)'}
          </span>
          <span style={{
            fontSize: '9px',
            padding: '2px 6px',
            borderRadius: '10px',
            background: apiStatus?.hasApiKey ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
            color: apiStatus?.hasApiKey ? '#4ade80' : '#fde047',
            border: `1px solid ${apiStatus?.hasApiKey ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
          }}>
            {apiStatus?.hasApiKey ? 'REAL_API_ACTIVE' : 'LOCAL_SIMULATOR'}
          </span>
        </div>
        <span style={{ color: '#64748b', fontSize: '10px' }}>
          SDK: @google/genai
        </span>
      </div>

      {/* Quick Action Suggestion Chips */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '8px 14px',
        borderBottom: '1px solid #242c38',
        background: '#131822',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
        {quickPrompts.map(q => (
          <button
            key={q.label}
            type="button"
            className="button secondary"
            disabled={busy}
            style={{
              fontSize: '11px',
              padding: '4px 9px',
              whiteSpace: 'nowrap',
              borderRadius: '14px',
              background: '#19202c',
              borderColor: '#334155',
            }}
            onClick={() => onSendMessage(q.prompt)}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Messages Timeline */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', margin: 'auto', color: '#64748b', fontSize: '12px', padding: '24px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎮</div>
            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#94a3b8' }}>向 AI Agent 发送手柄控制指令</p>
            <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.6, maxWidth: '360px' }}>
              支持复杂连贯多目标指令，例如：<br />
              <b>「走到蓝色目标位置之后再走到红色目标位置」</b><br />
              AI 规划中枢将自动拆解长序列阶段，逐级驱动林克前往各祭坛。
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: '4px',
              }}
            >
              <div style={{ fontSize: '9px', color: '#64748b' }}>
                {msg.role === 'user' ? '你 (Operator)' : 'GamePilot Visual Agent'} ·{' '}
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>

              <div
                style={{
                  maxWidth: '85%',
                  padding: '9px 13px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user'
                    ? '#2e2a56'
                    : msg.isMilestone
                    ? '#1e293b'
                    : '#1a222e',
                  border: msg.role === 'user'
                    ? '1px solid #4a437a'
                    : msg.isMilestone
                    ? '1px solid #38bdf8'
                    : '1px solid #2e3a4e',
                  color: msg.role === 'user' ? '#e9e5ff' : '#d1dced',
                  fontSize: '12px',
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.text}

                {msg.toolCallSummary && (
                  <div style={{
                    marginTop: '6px',
                    padding: '4px 8px',
                    background: '#121720',
                    borderLeft: '2px solid #2dd4bf',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#5eead4',
                  }}>
                    ⚙️ 工具调用: {msg.toolCallSummary}
                  </div>
                )}

                {msg.status === 'moving' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', color: '#facc15', fontSize: '11px' }}>
                    <span className="activity-dot" /> 正在通过手柄闭环移动中...
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '10px 14px',
          borderTop: '1px solid #242c38',
          background: '#131822',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          placeholder={busy ? 'AI 正在执行手柄任务中...' : '输入指令，如：走到蓝色目标位置之后再走到红色目标位置...'}
          style={{
            flex: 1,
            background: '#0d1117',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#f8fafc',
            padding: '8px 12px',
            fontSize: '12px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          className="button primary"
          disabled={busy || !input.trim()}
          style={{
            padding: '8px 14px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? '执行中' : '发送指令 ➔'}
        </button>
      </form>
    </div>
  );
}
