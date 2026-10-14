import { normalizeApproach, type ApproachSpec } from '../contracts/approach';
import type { Assignment } from '../benchmarks/campaign';
import type { ExecutionStrategy } from '../contracts/run';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ConfigSummary, ImportedImage, RunStatus, ExecutionMode } from '../contracts/debug';
import InputPreview from './components/InputPreview';
import AgentTranscript, { statusLabel } from './components/AgentTranscript';
import AgentComposer from './components/AgentComposer';
import type { CaptureState, GameWindow } from '../contracts/capture';
import InputDebugPanel from './components/InputDebugPanel';
import type { InputDebugState, InputMode, ManualSkill } from '../contracts/input';
import type { KeyObservation } from '../contracts/verification';
import ZeldaArenaCanvas, { getArenaInstance } from './components/ZeldaArenaCanvas';
import ChatAgentConsole, { type ChatMessage } from './components/ChatAgentConsole';

export default function App() {
  const [approach, setApproach] = useState<Omit<ApproachSpec, 'targetId'>>({ description: '', region: [.35, .2, .3, .65], minArea: .06, requireInteraction: true });
  const [approachAvailable, setApproachAvailable] = useState(false);
  const [executionStrategy, setExecutionStrategy] = useState<ExecutionStrategy>('agent');
  let approachValid = false; try { normalizeApproach(approach); approachValid = true; } catch {}
  const [campaignId, setCampaignId] = useState(''), [assignment, setAssignment] = useState<Assignment | null>(null);
  const [config, setConfig] = useState<ConfigSummary | null>(null), [image, setImage] = useState<ImportedImage | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]), [status, setStatus] = useState<RunStatus>('idle');
  const [runId, setRunId] = useState(''), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState('走到红色目标位置 (火之祭坛)');
  const [ratio, setRatio] = useState(58), [timeout, setTimeoutValue] = useState(60);
  const [runImage, setRunImage] = useState<ImportedImage | null>(null), [showRunImage, setShowRunImage] = useState(false);
  const [windows, setWindows] = useState<GameWindow[]>([]), [sourceId, setSourceId] = useState('');
  const [capture, setCapture] = useState<CaptureState>({ status: 'stopped', generation: 0, message: '预览未启动' });
  const [showLive, setShowLive] = useState(false), [windowInput, setWindowInput] = useState(false), [snapshotting, setSnapshotting] = useState(false);
  const [inputState, setInputState] = useState<InputDebugState>({ status: 'ready', mode: 'dry-run', neutral: true, message: '虚拟手柄驱动已就绪', history: [] });
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('simulation');
  const [realRuntimeAvailable, setRealRuntimeAvailable] = useState(false);
  const [verifiedRuntimeAvailable, setVerifiedRuntimeAvailable] = useState(false), [successCondition, setSuccessCondition] = useState('到达目标判定区域');
  const [keyFrames, setKeyFrames] = useState<KeyObservation[]>([]), [viewObservationId, setViewObservationId] = useState('');

  // New Interactive Views
  const [leftView, setLeftView] = useState<'arena' | 'capture'>('arena');
  const [rightTab, setRightTab] = useState<'chat' | 'trace' | 'mcp'>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      role: 'assistant',
      text: '你好！我是塞尔达视觉智能体 GamePilot。左侧沙盒试验场已就绪，场内设有红（火）、黄（雷）、蓝（水）三处祭坛地标。你可以直接向我下达任务指令（如「走到红色目标位置」），我将调用零先验手柄工具控制林克闭环前往。',
      timestamp: Date.now(),
    },
  ]);

  const inputBusy = ['connecting', 'preparing', 'executing', 'resetting'].includes(inputState.status);
  const layout = useRef<HTMLDivElement>(null), activeRun = useRef('');
  const busy = starting || ['running', 'canceling', 'pausing', 'paused'].includes(status);

  const refreshConfig = useCallback(async () => {
    const result = await window.gamepilot.getConfig();
    if (result.ok) setConfig(result.value); else setError(result.error);
  }, []);

  const refreshWindows = useCallback(async () => {
    if (typeof window.gamepilot.listWindows !== 'function') { setError('窗口采集接口已更新'); return; }
    const result = await window.gamepilot.listWindows();
    if (result.ok) { setWindows(result.value); setSourceId(current => result.value.some(w => w.id === current) ? current : result.value.find(w => w.processName.toLowerCase().startsWith('cemu'))?.id || ''); }
    else setError(result.error);
  }, []);

  useEffect(() => {
    const unsubscribe = window.gamepilot.onEvent(event => {
      if (activeRun.current && event.runId !== activeRun.current) return;
      activeRun.current = event.runId; setRunId(event.runId);

      if (event.type === 'observation' || event.type === 'observation_post' || event.type === 'observation_resumed') void window.gamepilot.getSnapshot().then(result => {
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
        if (!last || last.role !== 'assistant') return prev;

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
          const isMilestone = event.text.includes('🎯 阶段') || event.text.includes('长任务序列拆解') || event.text.includes('🏆');
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
              text: event.text,
            },
          ];
        } else if (event.type === 'validation_end') {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              status: 'completed',
              text: (last.text && last.text !== '正在思考与分析意图中...') ? last.text : (event.summary?.finalText || '任务已完成，手柄输入安全归零。'),
            },
          ];
        }
        return prev;
      });

      if (event.type === 'task_paused') { setStatus('paused'); return; }
      if (event.type === 'task_pausing') { setStatus('pausing'); return; }
      if (event.type === 'task_resumed') { setStatus('running'); return; }
      if (event.type === 'validation_end') setStatus(event.summary?.status || event.status || 'failed');
      else setStatus(current => ['canceling', 'pausing', 'paused'].includes(current) ? current : 'running');
    });

    void refreshConfig();
    if (typeof window.gamepilot.getRuntimeCapabilities === 'function') void window.gamepilot.getRuntimeCapabilities().then(result => { setRealRuntimeAvailable(result.ok && result.value.realMovement); setVerifiedRuntimeAvailable(result.ok && result.value.goalVerification === true); setApproachAvailable(result.ok && result.value.targetApproach === true); }).catch(() => setRealRuntimeAvailable(false));
    void refreshWindows();

    const unsubscribeCapture = typeof window.gamepilot.onCapture === 'function' ? window.gamepilot.onCapture(setCapture) : () => {};
    const unsubscribeInput = typeof window.gamepilot.onInput === 'function' ? window.gamepilot.onInput(setInputState) : () => {};
    if (typeof window.gamepilot.getInputState === 'function') void window.gamepilot.getInputState().then(result => { if (result.ok) setInputState(result.value); });
    if (typeof window.gamepilot.getCaptureState === 'function') void window.gamepilot.getCaptureState().then(result => { if (result.ok) setCapture(result.value); });

    void window.gamepilot.getSnapshot().then(result => {
      if (result.ok && result.value && !activeRun.current) {
        const snapshot = result.value; activeRun.current = snapshot.runId;
        setRunId(snapshot.runId); setEvents(snapshot.events); setStatus(snapshot.status);
        if (snapshot.input) { setRunImage(snapshot.input); setShowRunImage(true); }
        setKeyFrames(snapshot.observations ?? []);
      }
    });

    return () => { unsubscribe(); unsubscribeCapture(); unsubscribeInput(); };
  }, [refreshConfig, refreshWindows]);

  const importImage = async () => {
    setError(''); const result = await window.gamepilot.importImage();
    if (result.ok) { if (result.value) { setImage(result.value); setShowRunImage(false); setShowLive(false); setWindowInput(false); setViewObservationId(''); } } else setError(result.error);
  };

  const startPreview = async () => {
    setError(''); setShowLive(true); setWindowInput(true);
    const result = await window.gamepilot.startPreview(sourceId); if (!result.ok) setError(result.error);
  };

  const stopPreview = async () => { const result = await window.gamepilot.stopPreview(); if (!result.ok) setError(result.error); };

  const snapshot = async () => {
    if (busy || snapshotting) return;
    setSnapshotting(true); setError('');
    try { const result = await window.gamepilot.captureFrame();
      if (result.ok) { setImage(result.value); setShowRunImage(false); setShowLive(false); setWindowInput(true); } else setError(result.error);
    } finally { setSnapshotting(false); }
  };

  const connectInput = async (mode: InputMode) => { setError(''); if (typeof window.gamepilot.connectInput !== 'function') { setError('手柄接口已更新'); return; }
    const result = await window.gamepilot.connectInput(mode); if (!result.ok) setError(result.error); };

  const disconnectInput = async () => { const result = await window.gamepilot.disconnectInput(); if (!result.ok) setError(result.error); };

  const executeInput = async (skill: ManualSkill) => { setError(''); const result = await window.gamepilot.executeInput(skill); if (!result.ok) setError(result.error); };

  const stopInput = async () => { const result = await window.gamepilot.stopInput(); if (!result.ok) setError(result.error); };

  // Dispatch AI Agent Run (used by both Composer and Chat)
  const executeRunTask = async (taskPrompt: string) => {
    if (busy || snapshotting) return;
    setStarting(true);
    setError('');
    try {
      let inputFrame = image;

      // In arena mode, take fresh real screenshot from canvas
      const arena = getArenaInstance();
      if (leftView === 'arena' && arena) {
        inputFrame = arena.captureFrame();
        setImage(inputFrame);
      } else if (windowInput) {
        const captured = await window.gamepilot.captureFrame();
        if (!captured.ok) { setError(captured.error); return; }
        inputFrame = captured.value; setImage(inputFrame);
      }

      if (!inputFrame) return;

      setEvents([]);
      setRunId('');
      activeRun.current = '';
      setStatus('running');
      setRunImage(executionMode !== 'simulation' ? null : inputFrame);
      setShowRunImage(true);
      setShowLive(executionMode !== 'simulation');
      setKeyFrames([]);
      setViewObservationId('');

      const result = await window.gamepilot.startRun({
        imageId: inputFrame.id,
        prompt: taskPrompt,
        timeoutMs: timeout * 1000,
        executionMode,
        successCondition: '到达指定目标判定区域',
        benchmark: assignment ?? undefined,
        approach: executionMode === 'approach-xbox' ? approach : undefined,
        executionStrategy: executionMode === 'approach-xbox' ? executionStrategy : undefined,
      });

      if (result.ok) {
        setAssignment(null);
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
    const result = await window.gamepilot.cancelRun(runId);
    if (!result.ok) { setError(result.error); const snap = await window.gamepilot.getSnapshot(); if (snap.ok && snap.value) setStatus(snap.value.status); }
  };

  // Conversational Chat Handler
  const handleSendChatMessage = async (text: string) => {
    const userMsgId = `user-${Date.now()}`;
    const asstMsgId = `asst-${Date.now()}`;

    setChatMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text, timestamp: Date.now() },
      { id: asstMsgId, role: 'assistant', text: '正在思考与分析意图中...', timestamp: Date.now() + 10, status: 'thinking' },
    ]);

    setPrompt(text);
    await executeRunTask(text);
  };

  const last = events.at(-1);
  const phase = status === 'paused' ? '已归零暂停；总超时继续计时，恢复将重新观察' : status === 'pausing' ? '等待当前调用中断和归零确认' : status === 'canceling' ? '等待取消及手柄归零确认' : last?.type === 'input_preparing' ? '3 秒准备：请切换到游戏'
    : last?.type === 'verification_start' || last?.type === 'verification_model_text' ? '独立验证：正在判断固定成功条件'
    : last?.type === 'observation_post_start' ? '输入已释放，正在获取验证新帧'
    : last?.type === 'observation_start' ? '正在截取游戏窗口新帧'
    : last?.type === 'simulation_start' || last?.type === 'tool_execution_start' ? '正在执行零先验手柄动作 (gamepad_set_stick)'
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
          <div className="tech-pill active">
            <span className="status-dot ready" />
            <span className="mono">{config?.modelId || 'gemini-3.8-flash'}</span>
          </div>
          <div className="tech-pill">
            <span className="activity-dot" />
            <span>{executionMode === 'simulation' ? '沙盒模拟模式' : '真实虚拟 Xbox'}</span>
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
            ↻ 刷新
          </button>
        </div>
      </header>

      {error && (
        <div className="app-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5' }}>✕ 关闭</button>
        </div>
      )}

      <main className="workspace" ref={layout} style={{ '--left-width': `${ratio}%` } as React.CSSProperties}>
        {/* Left Column: Interactive Zelda Arena / Preview with Floating HUD Overlay */}
        <div className="preview-column">
          {/* Floating Canvas HUD Overlay */}
          <div className="floating-hud-overlay">
            {/* Top Bar: View Switcher Tabs + Keyframes + Compact Window Capture Toolbar */}
            <div className="hud-top-bar">
              <div className="hud-pill-group">
                <div className="tech-tabs">
                  <button
                    type="button"
                    className={`tech-tab-button ${leftView === 'arena' ? 'selected' : ''}`}
                    onClick={() => setLeftView('arena')}
                  >
                    🎮 沙盒试验场
                  </button>
                  <button
                    type="button"
                    className={`tech-tab-button ${leftView === 'capture' ? 'selected' : ''}`}
                    onClick={() => setLeftView('capture')}
                  >
                    📷 画面捕获
                  </button>
                </div>

                {keyFrames.length > 0 && (
                  <select
                    aria-label="关键截图"
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
                      setLeftView('capture');
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
              </div>
            </div>

            {/* Bottom Bar: Telemetry Info + Safe Gamepad Watchdog */}
            <div className="hud-bottom-bar">
              <div className="hud-telemetry-card">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="status-dot ready" />
                  <span className="mono" style={{ color: '#38bdf8', fontWeight: 600 }}>ZELDA BOTW ARENA</span>
                </span>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#94a3b8' }}>
                  {leftView === 'arena' ? '2.5D 物理闭环沙盒' : '实时游戏采集画面'}
                </span>
              </div>

              <div className="hud-telemetry-card">
                <span style={{ color: '#64748b' }}>MCP 看门狗:</span>
                <button
                  type="button"
                  className="button danger"
                  style={{ padding: '2px 8px', fontSize: '10px' }}
                  title="强制归零虚拟手柄所有摇杆与按键"
                  disabled={!['connecting', 'preparing', 'executing', 'resetting'].includes(inputState.status) && !busy}
                  onClick={stopInput}
                >
                  🛑 强制归零
                </button>
              </div>
            </div>
          </div>

          {/* Underneath Canvas or Live View */}
          <div
            className="preview-pane"
            style={{
              position: 'relative',
              overflow: 'hidden',
              display: leftView === 'arena' ? 'block' : 'none',
              height: '100%',
              border: 'none',
              background: '#080c14',
            }}
          >
            <ZeldaArenaCanvas />
          </div>

          <div
            style={{
              display: leftView === 'capture' ? 'block' : 'none',
              height: '100%',
              background: '#080c14',
            }}
          >
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
                {rightTab === 'chat' ? '智能任务控制台 (Claude Code TUI)' : rightTab === 'trace' ? '实时执行追踪 (Tree Stream Trace)' : '手柄物理输入诊断 (MCP Tools)'}
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
              />
            </div>
          ) : rightTab === 'trace' ? (
            <>
              <AgentTranscript events={events} status={status} phase={phase} />
              {busy && ['verified-xbox', 'approach-xbox'].includes(executionMode) && (
                <div className="agent-footer">
                  {executionMode === 'verified-xbox' && (
                    <button
                      type="button"
                      disabled={!['running', 'paused'].includes(status)}
                      onClick={async () => {
                        const result = await (status === 'paused' ? window.gamepilot.resumeRun(runId) : window.gamepilot.pauseRun(runId));
                        if (!result.ok) setError(result.error);
                      }}
                    >
                      {status === 'paused' ? '恢复任务' : '暂停任务'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={status === 'canceling'}
                    onClick={async () => {
                      const result = await window.gamepilot.takeoverRun(runId);
                      if (!result.ok) setError(result.error);
                    }}
                  >
                    接管游戏
                  </button>
                </div>
              )}
              <AgentComposer
                executionStrategy={executionStrategy}
                setExecutionStrategy={setExecutionStrategy}
                approach={approach}
                setApproach={setApproach}
                prompt={prompt}
                setPrompt={setPrompt}
                busy={busy}
                mode={executionMode}
                successCondition={successCondition}
                setSuccessCondition={setSuccessCondition}
                setMode={mode => {
                  setExecutionMode(mode);
                  if (mode !== 'verified-xbox') setAssignment(null);
                  if (mode === 'approach-xbox') setPrompt('接近固定可见目标。根据新帧和独立验证反馈，在运行总预算内执行；验证通过或证据无法确认时停止。');
                  if (mode !== 'simulation' && (!realRuntimeAvailable || (mode === 'verified-xbox' && !verifiedRuntimeAvailable) || (mode === 'approach-xbox' && !approachAvailable))) setError('真实模型工具/验证的 Main/preload 未就绪');
                }}
                canceling={status === 'canceling' || starting}
                canRun={!busy && !inputBusy && !snapshotting && Boolean(prompt.trim())}
                onRun={start}
                onCancel={cancel}
              />
            </>
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px', background: '#090d15' }}>
              <div style={{ marginBottom: '10px', fontSize: '11px', color: '#94a3b8' }}>
                🎮 <b>零先验物理输入诊断</b>：可在此直接测试虚拟手柄摇杆偏转、按键触发与 MCP 客户端协议。
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
                <option value={60}>60 秒</option>
                <option value={120}>120 秒</option>
              </select>
            </label>
            <button
              type="button"
              disabled={!runId}
              onClick={async () => {
                const result = await window.gamepilot.openLogs(runId);
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
          <span>本地闭环 · 2.5D 塞尔达沙盒 · 零先验手柄 MCP</span>
        </span>
        <span style={{ color: '#475569' }}>
          {executionMode === 'simulation' ? '模型动作经由模拟手柄工具闭环驱动沙盒林克' : '真实虚拟 Xbox 设备 · F8 紧急归零'}
        </span>
        <span className="mono" style={{ color: '#64748b' }}>
          {runId ? `RUN ${runId.slice(0, 8)}` : 'SYSTEM STANDBY'}
        </span>
      </footer>
    </div>
  );
}
