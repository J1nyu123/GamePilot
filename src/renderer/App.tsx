import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ConfigSummary, ImportedImage, RunStatus } from '../contracts/debug';
import InputPreview from './components/InputPreview';
import AgentTranscript, { statusLabel } from './components/AgentTranscript';
import AgentComposer from './components/AgentComposer';
import type { CaptureState, GameWindow } from '../contracts/capture';
import InputDebugPanel from './components/InputDebugPanel';
import type { InputDebugState, InputMode, InputCommand } from '../contracts/input';
import type { KeyObservation } from '../contracts/verification';
import ChatAgentConsole, { type ChatMessage } from './components/ChatAgentConsole';
import { desktopApi } from './runtime-api';
import ModelConnectionPanel from './components/ModelConnectionPanel';

export default function App() {
  const api = desktopApi;
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [config, setConfig] = useState<ConfigSummary | null>(null), [image, setImage] = useState<ImportedImage | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]), [status, setStatus] = useState<RunStatus>('idle');
  const [runId, setRunId] = useState(''), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState('走到前面柱子处。先观察画面，再短步移动，并确认结果。');
  const [gamepadNotice, setGamepadNotice] = useState('首次使用请先连接，并在游戏设置中选择该手柄');
  const [executionMode, setExecutionMode] = useState<'simulation' | 'keyboard' | 'gamepad'>('simulation');
  const [ratio, setRatio] = useState(58), [timeout, setTimeoutValue] = useState(60);
  const [runImage, setRunImage] = useState<ImportedImage | null>(null), [showRunImage, setShowRunImage] = useState(false);
  const [windows, setWindows] = useState<GameWindow[]>([]), [sourceId, setSourceId] = useState('');
  const [capture, setCapture] = useState<CaptureState>({ status: 'stopped', generation: 0, message: '预览未启动' });
  const [showLive, setShowLive] = useState(false), [windowInput, setWindowInput] = useState(false), [snapshotting, setSnapshotting] = useState(false);
  const [inputState, setInputState] = useState<InputDebugState>({ status: 'disconnected', mode: 'dry-run', neutral: null, message: '手柄服务未连接', history: [] });
  const [keyFrames, setKeyFrames] = useState<KeyObservation[]>([]), [viewObservationId, setViewObservationId] = useState('');

  // New Interactive Views
  const [rightTab, setRightTab] = useState<'chat' | 'trace' | 'mcp'>('trace');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      role: 'assistant',
      text: 'GamePilot 已就绪。配置模型后即可聊天。游戏观察或操作指令会自动进入对应流程；真实键盘模式可执行游戏动作并回传新截图。',
      timestamp: Date.now(),
    },
  ]);

  const inputBusy = ['connecting', 'preparing', 'executing', 'resetting'].includes(inputState.status);
  const layout = useRef<HTMLDivElement>(null), activeRun = useRef('');
  const busy = starting || ['running', 'canceling', 'pausing', 'paused'].includes(status);
  const readyToRun = !busy && !inputBusy && !snapshotting && (windowInput ? capture.status === 'streaming' : Boolean(image))
    && config?.status === 'ready' && config.supportsImages !== false;
  const canChat = !busy && !inputBusy && !snapshotting && config?.status === 'ready';
  const canRun = readyToRun && Boolean(prompt.trim());

  const refreshConfig = useCallback(async () => {
    const result = await api.getConfig();
    if (result.ok) setConfig(result.value); else setError(result.error);
  }, [api]);

  const refreshWindows = useCallback(async () => {
    if (typeof api.listWindows !== 'function') { setError('窗口采集接口已更新'); return; }
    const result = await api.listWindows();
    if (result.ok) { setWindows(result.value); setSourceId(current => result.value.some(w => w.id === current) ? current : result.value.find(w => w.processName.toLowerCase().startsWith('cemu'))?.id || ''); }
    else setError(result.error);
  }, [api]);

  useEffect(() => {
    const unsubscribe = api.onEvent(event => {
      if (activeRun.current && event.runId !== activeRun.current) return;
      activeRun.current = event.runId; setRunId(event.runId);
      if (event.type === 'model_warning' && event.text) setError(event.text);

      if (event.type === 'observation' || event.type === 'observation_post' || event.type === 'observation_resumed') void api.getSnapshot().then(result => {
        if (result.ok && result.value?.runId === activeRun.current && result.value.input) {
          setKeyFrames(result.value.observations ?? []);
          if (event.type === 'observation_resumed') { setViewObservationId(event.observationId ?? ''); setShowLive(false); setShowRunImage(true); }
          if (event.type === 'observation') {
            setRunImage(result.value.input); setImage(result.value.input);
            if (event.simulated === false || result.value.events.some(e => e.type === 'input_preparing')) { setShowRunImage(true); setShowLive(false); }
          }
        }
      });

      setEvents(current => current.some(e => e.runId === event.runId && e.sequence === event.sequence) ? current
        : [...current.filter(e => e.runId === event.runId), event].sort((a, b) => a.sequence - b.sequence));

      // Synchronize Chat Assistant Response Bubble
      setChatMessages(prev => {
        const last = prev.at(-1);
        if (!last || last.role !== 'assistant' || !last.id.startsWith('asst-')) return prev;

        if (event.type === 'tool_execution_start') {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              status: 'moving',
              toolCallSummary: `${event.toolName}(${JSON.stringify(event.args || {})})`,
            },
          ];
        } else if (event.type === 'model_text' && event.text) {
          const isMilestone = event.text.startsWith('🎯 阶段') || event.text.startsWith('🏆');
          if (isMilestone && last.text && last.text !== event.text) {
            return [
              ...prev.slice(0, -1),
              { ...last, status: 'completed' },
              {
                id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: 'assistant',
                text: event.text,
                timestamp: Date.now(),
                status: event.text.includes('🏆') ? 'completed' : 'moving',
                isMilestone: true,
              },
            ];
          }
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              text: last.status === 'thinking' ? event.text : last.text + event.text,
              status: 'moving',
            },
          ];
        } else if (event.type === 'validation_end') {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              status: ['completed', 'protocol_passed', 'control_passed', 'succeeded'].includes(event.summary?.status || '') ? 'completed' : 'error',
              text: event.summary?.finalText || event.summary?.error || event.error || '任务已结束，结果见 Trace。',
            },
          ];
        }
        return prev;
      });

      if (event.type === 'task_paused') { setStatus('paused'); return; }
      if (event.type === 'task_pausing') { setStatus('pausing'); return; }
      if (event.type === 'task_resumed') { setStatus('running'); return; }
      if (event.type === 'validation_end') { setStatus(event.summary?.status || event.status || 'failed'); void refreshConfig(); }
      else setStatus(current => ['canceling', 'pausing', 'paused'].includes(current) ? current : 'running');
    });

    void refreshConfig();
    void refreshWindows();

    const unsubscribeCapture = typeof api.onCapture === 'function' ? api.onCapture(setCapture) : () => {};
    const unsubscribeInput = typeof api.onInput === 'function' ? api.onInput(setInputState) : () => {};
    if (typeof api.getInputState === 'function') void api.getInputState().then(result => { if (result.ok) setInputState(result.value); });
    if (typeof api.getCaptureState === 'function') void api.getCaptureState().then(result => { if (result.ok) setCapture(result.value); });

    void api.getSnapshot().then(result => {
      if (result.ok && result.value && !activeRun.current) {
        const snapshot = result.value; activeRun.current = snapshot.runId;
        setRunId(snapshot.runId); setEvents(snapshot.events); setStatus(snapshot.status);
        if (snapshot.input) { setRunImage(snapshot.input); setShowRunImage(true); }
        setKeyFrames(snapshot.observations ?? []);
      }
    });

    return () => { unsubscribe(); unsubscribeCapture(); unsubscribeInput(); };
  }, [api, refreshConfig, refreshWindows]);

  const importImage = async () => {
    setError(''); const result = await api.importImage();
    if (result.ok) { if (result.value) { setImage(result.value); setShowRunImage(false); setShowLive(false); setWindowInput(false); setViewObservationId(''); } } else setError(result.error);
  };

  const startPreview = async () => {
    setError(''); setShowLive(true); setWindowInput(true);
    const result = await api.startPreview(sourceId); if (!result.ok) setError(result.error);
  };

  const stopPreview = async () => { const result = await api.stopPreview(); if (!result.ok) setError(result.error); };

  const snapshot = async () => {
    if (busy || snapshotting) return;
    setSnapshotting(true); setError('');
    try { const result = await api.captureFrame();
      if (result.ok) { setImage(result.value); setShowRunImage(false); setShowLive(false); setWindowInput(true); } else setError(result.error);
    } finally { setSnapshotting(false); }
  };

  const connectInput = async (mode: InputMode) => { setError(''); if (typeof api.connectInput !== 'function') { setError('手柄接口已更新'); return; }
    const result = await api.connectInput(mode); if (!result.ok) setError(result.error); };

  const disconnectInput = async () => { const result = await api.disconnectInput(); if (!result.ok) setError(result.error); };

  const executeInput = async (skill: InputCommand) => { setError(''); const result = await api.executeInput(skill); if (!result.ok) setError(result.error); };

  const stopInput = async () => { const result = await api.stopInput(); if (!result.ok) setError(result.error); };

  // Explicit task dispatch from the Trace composer
  const executeRunTask = async (taskPrompt: string) => {
    if (busy || inputBusy || snapshotting) return;
    if (!taskPrompt.trim() || !readyToRun) {
      setError('请先配置模型与任务输入；窗口输入需要启动预览。');
      return;
    }
    setStarting(true);
    setError('');
    try {
      let inputFrame = image;

      if (windowInput) {
        const captured = await api.captureFrame();
        if (!captured.ok) { setError(captured.error); return; }
        inputFrame = captured.value; setImage(inputFrame);
      }

      if (!inputFrame) { setError('请先选择任务输入图片'); return; }

      setEvents([]);
      setRunId('');
      activeRun.current = '';
      setStatus('running');
      setRunImage(inputFrame);
      setShowRunImage(true);
      setShowLive(false);
      setKeyFrames([]);
      setViewObservationId('');

      const result = await api.startRun({
        imageId: inputFrame.id,
        prompt: taskPrompt,
        timeoutMs: timeout * 1000,
        executionMode,
      });

      if (result.ok) {
        activeRun.current = result.value.runId;
        setRunId(result.value.runId);
      } else {
        setError(result.error);
        setStatus('idle');
        void refreshConfig();
      }
    } catch {
      setError('无法启动 Agent Runtime');
      setStatus('failed');
    } finally {
      setStarting(false);
    }
  };

  const start = async () => {
    await executeRunTask(prompt);
  };

  const cancel = async () => {
    if (!runId) return; setStatus('canceling');
    const result = await api.cancelRun(runId);
    if (!result.ok) { setError(result.error); const snap = await api.getSnapshot(); if (snap.ok && snap.value) setStatus(snap.value.status); }
  };

  // Conversational Chat Handler
  const handleSendChatMessage = async (text: string) => {
    if (!canChat) { setError('请先配置模型，并等待当前任务结束。'); return; }
    const userMsgId = `user-${Date.now()}`;
    const asstMsgId = `asst-${Date.now()}`;

    setChatMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text, timestamp: Date.now() },
      { id: asstMsgId, role: 'assistant', text: '正在等待模型公开回复…', timestamp: Date.now() + 10, status: 'thinking' },
    ]);

    setPrompt(text);
    setStarting(true); setError(''); setEvents([]); activeRun.current = ''; setRunId(''); setStatus('running');
    setKeyFrames([]); setRunImage(null); setViewObservationId(''); setShowRunImage(false);
    try {
      const result = await api.sendMessage({ prompt: text, timeoutMs: timeout * 1000, executionMode });
      if (result.ok) { activeRun.current = result.value.runId; setRunId(result.value.runId); }
      else {
        setError(result.error); setStatus('idle');
        setChatMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, text: result.error, status: 'error' } : m));
      }
    } catch { setError('消息发送失败'); setStatus('failed'); }
    finally { setStarting(false); }
  };

  const last = events.at(-1);
  const phase = status === 'paused' ? '已归零暂停；总超时继续计时，恢复将重新观察' : status === 'pausing' ? '等待当前调用中断和归零确认' : status === 'canceling' ? '等待取消及手柄归零确认' : last?.type === 'input_preparing' ? '3 秒准备：请切换到游戏'
    : last?.type === 'observation_post_start' ? '输入已释放，正在获取验证新帧'
    : last?.type === 'observation_start' ? '正在截取游戏窗口新帧'
    : last?.type === 'simulation_start' || last?.type === 'tool_execution_start' ? '正在执行工具并获取画面反馈'
    : last?.type === 'intent_resolved' ? last.text || '意图识别完成'
    : last?.type === 'model_text' ? '正在接收模型反馈' : last?.type === 'tool_arguments_delta' ? '正在接收工具参数' : '等待模型返回';

  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const box = layout.current!.getBoundingClientRect();
      const min = 360 / box.width * 100;
      setRatio(Math.max(min, Math.min(100 - min, (event.clientX - box.left) / box.width * 100)));
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up, { once: true });
  };

  return (
    <div className="app-shell">
      {showModelSettings && <ModelConnectionPanel api={api} onChanged={refreshConfig} onClose={() => setShowModelSettings(false)} />}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">G<span>↗</span></div>
          <div>
            <h1>
              GamePilot <span className="sub-badge">VISION AGENT SLATE</span>
            </h1>
          </div>
        </div>

        <div className="header-status-group">
          <button type="button" className="button secondary" disabled={busy || inputBusy} onClick={() => setShowModelSettings(true)}>模型 API</button>
          <div className="tech-pill active">
            <span className="status-dot" style={{ background: config?.connectionStatus === 'connected' ? '#22c55e' : config?.connectionStatus === 'error' ? '#f87171' : config?.status === 'ready' ? '#eab308' : '#64748b' }} />
            <span className="mono">{config?.modelId || '正在读取配置'}</span>
          </div>
          <div className="tech-pill">
            <span className="activity-dot" />
            <span>{executionMode === 'gamepad' ? 'Electron · 真实 Xbox 手柄' : executionMode === 'keyboard' ? 'Electron · 真实键盘闭环' : 'Electron · 模拟 MCP 手柄'}</span>
          </div>
          <div className="tech-pill">
            <span className="status-dot" style={{ background: busy ? '#38bdf8' : '#22c55e' }} />
            <span>{statusLabel[status]}</span>
          </div>
          <button
            type="button"
            className="button secondary"
            style={{ padding: '3px 8px', fontSize: '10px' }}
            disabled={busy}
            onClick={refreshConfig}
            title={config?.configPath || '重新读取模型配置'}
          >
            ↻ 刷新配置
          </button>
        </div>
      </header>
      <label className="execution-mode">执行模式：<select aria-label="执行模式" disabled={busy} value={executionMode} onChange={e => setExecutionMode(e.target.value as 'simulation' | 'keyboard' | 'gamepad')}>
        <option value="simulation">模拟手柄（不操作游戏）</option><option value="keyboard">真实键盘（实时窗口闭环）</option><option value="gamepad">真实手柄（Xbox 360 / ViGEm）</option>
      </select>{executionMode !== 'simulation' && ' 每步最多 1 秒、最多 4 步；运行会聚焦所选游戏窗口。'}</label>
      {executionMode === 'gamepad' && <div className="execution-mode"><button className="button secondary" disabled={busy} onClick={async () => { const r = await api.connectGamepad(); setError(r.ok ? '' : r.error); if (r.ok) setGamepadNotice('Xbox 360 虚拟设备已连接，可在游戏中选择 XInput 手柄'); }}>连接 / 检查真实手柄</button><button className="button secondary" disabled={busy} onClick={async () => { const r = await api.disconnectGamepad(); if (!r.ok) setError(r.error); else setGamepadNotice('真实手柄已断开'); }}>断开真实手柄</button><span>{gamepadNotice}</span></div>}
      <div className="config-message" title={config?.configPath}>{config?.message || '正在读取模型配置…'}</div>

      {error && (
        <div className="app-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5' }}>✕ 关闭</button>
        </div>
      )}

      <main className="workspace" ref={layout} style={{ '--left-width': `${ratio}%` } as React.CSSProperties}>
        {/* Window / image preview with capture controls */}
        <div className="preview-column">
          {/* Floating Canvas HUD Overlay */}
          <div className="floating-hud-overlay">
            {/* Top Bar: View Switcher Tabs + Keyframes + Compact Window Capture Toolbar */}
            <div className="hud-top-bar">
              <div className="hud-pill-group">
                <div className="tech-tabs"><span className="tech-tab-button selected">📷 画面捕获</span></div>

                {keyFrames.length > 0 && (
                  <select
                    aria-label="运行关键截图"
                    value={viewObservationId}
                    style={{
                      background: '#090d14',
                      color: '#38bdf8',
                      border: '1px solid #1e293b',
                      borderRadius: '4px',
                      fontSize: '10px',
                      padding: '2px 6px',
                    }}
                    onChange={e => {
                      setViewObservationId(e.target.value);
                      setShowLive(false);
                      setShowRunImage(true);
                    }}
                  >
                    <option value="">初始输入</option>
                    {keyFrames.map(frame => (
                      <option key={frame.image.id} value={frame.image.id}>
                        {frame.phase === 'before' ? '前' : '后'} · #{frame.image.evidence?.frameSequence}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Compact Window Capture Toolbar Pill */}
              <div className="hud-pill-group">
                <select
                  aria-label="游戏窗口"
                  value={sourceId}
                  disabled={busy || capture.status === 'streaming'}
                  onChange={e => setSourceId(e.target.value)}
                  style={{
                    background: '#090d14',
                    color: '#cbd5e1',
                    border: '1px solid #1e293b',
                    borderRadius: '4px',
                    fontSize: '10px',
                    padding: '3px 6px',
                    maxWidth: '170px',
                  }}
                >
                  <option value="">选择游戏窗口 (Cemu / 游戏)</option>
                  {windows.map(w => (
                    <option value={w.id} key={w.id}>
                      {w.title.slice(0, 24)}{w.minimized ? ' [已最小化]' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button secondary"
                  style={{ padding: '2px 6px', fontSize: '10px' }}
                  title="刷新窗口列表"
                  onClick={refreshWindows}
                  disabled={busy}
                >
                  ↻
                </button>
                {capture.status === 'streaming' ? (
                  <button
                    type="button"
                    className="button secondary"
                    style={{ padding: '2px 8px', fontSize: '10px' }}
                    onClick={stopPreview}
                  >
                    停止预览
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    style={{ padding: '2px 8px', fontSize: '10px' }}
                    disabled={busy || !sourceId}
                    onClick={startPreview}
                  >
                    开始预览
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  style={{ padding: '2px 8px', fontSize: '10px' }}
                  disabled={busy || capture.status !== 'streaming'}
                  onClick={snapshot}
                >
                  📷 快照
                </button>
                <span className={`capture-status ${capture.status}`} role="status">{capture.message}</span>
              </div>
            </div>

            {/* Bottom Bar: Telemetry Info + Safe Gamepad Watchdog */}
            <div className="hud-bottom-bar">
              <div className="hud-telemetry-card">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="status-dot ready" />
                  <span className="mono" style={{ color: '#38bdf8', fontWeight: 600 }}>CAPTURE PREVIEW</span>
                </span>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#94a3b8' }}>
                  {'窗口捕获 / 导入图片'}
                </span>
              </div>

              <div className="hud-telemetry-card">
                <span style={{ color: '#64748b' }}>MCP 看门狗:</span>
                <button
                  type="button"
                  className="button danger"
                  style={{ padding: '2px 8px', fontSize: '10px' }}
                  title="强制归零虚拟手柄所有摇杆与按键"
                  disabled={inputState.status === 'disconnected' && !busy}
                  onClick={async () => { if (busy && runId) await cancel(); await stopInput(); }}
                >
                  🛑 强制归零
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              paddingTop: '88px',
              paddingBottom: '48px',
              height: '100%',
              background: '#080c14',
            }}
          >
            {(capture.window || runImage) && <div className="input-tabs">
              {capture.window && <button className={showLive ? 'selected' : ''} onClick={() => setShowLive(true)}>实时画面</button>}
              <button className={!showLive && !showRunImage ? 'selected' : ''} onClick={() => { setShowRunImage(false); setShowLive(false); setViewObservationId(''); }}>待运行图片</button>
              {runImage && <button className={!showLive && showRunImage && !viewObservationId ? 'selected' : ''} onClick={() => { setShowRunImage(true); setShowLive(false); setViewObservationId(''); }}>记录对应的输入</button>}
            </div>}
            <InputPreview
              image={viewObservationId ? keyFrames.find(frame => frame.image.id === viewObservationId)?.image ?? null : showRunImage ? runImage : image}
              purpose={viewObservationId ? 'evidence' : undefined}
              used={Boolean(runImage && (showRunImage || image?.id === runImage.id))}
              busy={busy || snapshotting}
              onImport={importImage}
              live={showLive ? capture : undefined}
            />
          </div>
        </div>

        {/* Workspace Splitter */}
        <div
          className="splitter"
          role="separator"
          aria-label="调整左右宽度"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={resize}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') setRatio(x => Math.max(35, x - 2));
            if (e.key === 'ArrowRight') setRatio(x => Math.min(65, x + 2));
          }}
        >
          <span />
        </div>

        {/* Right Column: AI Agent Unified Cockpit (Console Stream / Trace / MCP Diagnostics) */}
        <section className="agent-pane">
          <div className="agent-bar">
            <div>
              <span style={{ fontSize: '9px', color: '#64748b', letterSpacing: '1px', fontFamily: 'monospace' }}>
                AI COPILOT COCKPIT
              </span>
              <h2 style={{ fontSize: '13px', margin: '2px 0 0', fontWeight: 600, color: '#f8fafc' }}>
                {rightTab === 'chat' ? '智能任务控制台 (Claude Code TUI)' : rightTab === 'trace' ? '实时执行追踪 (Tree Stream Trace)' : '模拟手柄诊断 (MCP Tools)'}
              </h2>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div className="tech-tabs">
                <button
                  type="button"
                  className={`tech-tab-button ${rightTab === 'chat' ? 'selected' : ''}`}
                  onClick={() => setRightTab('chat')}
                >
                  💬 任务控制台
                </button>
                <button
                  type="button"
                  className={`tech-tab-button ${rightTab === 'trace' ? 'selected' : ''}`}
                  onClick={() => setRightTab('trace')}
                >
                  ⚡ 追踪 Trace
                </button>
                <button
                  type="button"
                  className={`tech-tab-button ${rightTab === 'mcp' ? 'selected' : ''}`}
                  onClick={() => setRightTab('mcp')}
                >
                  🛠️ MCP 诊断
                </button>
              </div>
              <span className={`run-status ${busy ? 'is-active' : ''}`}>
                <span className={busy ? 'activity-dot' : 'status-dot'} />
                {statusLabel[status]}
              </span>
            </div>
          </div>

          {rightTab === 'chat' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <ChatAgentConsole
                messages={chatMessages}
                onSendMessage={handleSendChatMessage}
                busy={busy}
                onCancel={cancel}
                modelId={config?.modelId}
                connectionStatus={config?.connectionStatus}
                canSend={canChat}
              />
            </div>
          ) : rightTab === 'trace' ? (
            <>
              <AgentTranscript events={events} status={status} phase={phase} />
              <AgentComposer prompt={prompt} setPrompt={setPrompt} busy={busy}
                canceling={status === 'canceling' || starting} canRun={canRun} onRun={start} onCancel={cancel} />
            </>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px', background: '#090d15' }}>
              <div style={{ marginBottom: '10px', fontSize: '11px', color: '#94a3b8' }}>
                🎮 <b>模拟输入诊断</b>：可在此查看模拟手柄状态，调用摇杆、按键与扳机工具。
              </div>
              <InputDebugPanel
                state={inputState}
                modelBusy={busy}
                onConnect={connectInput}
                onDisconnect={disconnectInput}
                onExecute={executeInput}
                onStop={stopInput}
              />
            </div>
          )}

          <div className="agent-footer">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              总超时
              <select
                aria-label="总超时"
                disabled={busy}
                value={timeout}
                onChange={e => setTimeoutValue(Number(e.target.value))}
              >
                <option value={30}>30 秒</option>
                {![30, 60, 120].includes(timeout) && <option value={timeout}>{timeout} 秒（冻结配置）</option>}
                <option value={60}>60 秒</option>
                <option value={120}>120 秒</option>
              </select>
            </label>
            <button
              type="button"
              disabled={!runId}
              onClick={async () => {
                const result = await api.openLogs(runId);
                if (!result.ok) setError(result.error);
              }}
            >
              打开日志目录 ↗
            </button>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="status-dot ready" />
          <span>{'Electron · Pi Runtime'}</span>
        </span>
        <span style={{ color: '#475569' }}>
          {executionMode === 'gamepad' ? '真实 Xbox 手柄 · 动作后截图反馈' : executionMode === 'keyboard' ? '真实键盘 · 动作后截图反馈 · 目标由模型判断' : '模拟 MCP 手柄 · 游戏效果未经验证'}
        </span>
        <span className="mono" style={{ color: '#64748b' }}>
          {runId ? `RUN ${runId.slice(0, 8)}` : 'SYSTEM STANDBY'}
        </span>
      </footer>
    </div>
  );
}
