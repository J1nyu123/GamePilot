import { normalizeApproach, type ApproachSpec } from '../contracts/approach';
import type { Assignment } from '../benchmarks/campaign';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, ConfigSummary, ImportedImage, RunStatus, ExecutionMode } from '../contracts/debug';
import InputPreview from './components/InputPreview';
import AgentTranscript, { statusLabel } from './components/AgentTranscript';
import AgentComposer from './components/AgentComposer';
import CaptureToolbar from './components/CaptureToolbar';
import type { CaptureState, GameWindow } from '../contracts/capture';
import InputDebugPanel from './components/InputDebugPanel';
import type { InputDebugState, InputMode, ManualSkill } from '../contracts/input';
import type { KeyObservation } from '../contracts/verification';

export default function App() {
  const [approach, setApproach] = useState<Omit<ApproachSpec, 'targetId'>>({ description: '', region: [.35, .2, .3, .65], minArea: .06, requireInteraction: true });
  const [approachAvailable, setApproachAvailable] = useState(false);
  let approachValid = false; try { normalizeApproach(approach); approachValid = true; } catch {}
  const [campaignId, setCampaignId] = useState(''), [assignment, setAssignment] = useState<Assignment | null>(null);
  const [config, setConfig] = useState<ConfigSummary | null>(null), [image, setImage] = useState<ImportedImage | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]), [status, setStatus] = useState<RunStatus>('idle');
  const [runId, setRunId] = useState(''), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState('先简要描述截图中的游戏状态，再调用 move_for 模拟向左移动 200 毫秒，最后说明执行结果。');
  const [ratio, setRatio] = useState(60), [timeout, setTimeoutValue] = useState(60);
  const [runImage, setRunImage] = useState<ImportedImage | null>(null), [showRunImage, setShowRunImage] = useState(false);
  const [windows, setWindows] = useState<GameWindow[]>([]), [sourceId, setSourceId] = useState('');
  const [capture, setCapture] = useState<CaptureState>({ status: 'stopped', generation: 0, message: '预览未启动' });
  const [showLive, setShowLive] = useState(false), [windowInput, setWindowInput] = useState(false), [snapshotting, setSnapshotting] = useState(false);
  const [inputState, setInputState] = useState<InputDebugState>({ status: 'disconnected', mode: 'dry-run', neutral: null, message: '手柄服务未连接', history: [] });
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('simulation');
  const [realRuntimeAvailable, setRealRuntimeAvailable] = useState(false);
  const [verifiedRuntimeAvailable, setVerifiedRuntimeAvailable] = useState(false), [successCondition, setSuccessCondition] = useState('');
  const [keyFrames, setKeyFrames] = useState<KeyObservation[]>([]), [viewObservationId, setViewObservationId] = useState('');
  const inputBusy = ['connecting', 'preparing', 'executing', 'resetting'].includes(inputState.status);
  const layout = useRef<HTMLDivElement>(null), activeRun = useRef('');
  const busy = starting || ['running', 'canceling', 'pausing', 'paused'].includes(status);
  const refreshConfig = useCallback(async () => {
    const result = await window.gamepilot.getConfig();
    if (result.ok) setConfig(result.value); else setError(result.error);
  }, []);
  const refreshWindows = useCallback(async () => {
    if (typeof window.gamepilot.listWindows !== 'function') { setError('窗口采集接口已更新，请关闭应用并重新执行 start.ps1'); return; }
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
  const connectInput = async (mode: InputMode) => { setError(''); if (typeof window.gamepilot.connectInput !== 'function') { setError('手柄接口已更新，请关闭应用并重新执行 start.ps1'); return; }
    const result = await window.gamepilot.connectInput(mode); if (!result.ok) setError(result.error); };
  const disconnectInput = async () => { const result = await window.gamepilot.disconnectInput(); if (!result.ok) setError(result.error); };
  const executeInput = async (skill: ManualSkill) => { setError(''); const result = await window.gamepilot.executeInput(skill); if (!result.ok) setError(result.error); };
  const stopInput = async () => { const result = await window.gamepilot.stopInput(); if (!result.ok) setError(result.error); };
  const start = async () => {
    if (busy || snapshotting || (!image && !windowInput)) return;
    setStarting(true); setError('');
    try {
      let input = image;
      if (windowInput) {
        const captured = await window.gamepilot.captureFrame();
        if (!captured.ok) { setError(captured.error); return; }
        input = captured.value; setImage(input);
      }
      if (!input) return;
      setEvents([]); setRunId(''); activeRun.current = ''; setStatus('running'); setRunImage(executionMode !== 'simulation' ? null : input); setShowRunImage(true); setShowLive(executionMode !== 'simulation'); setKeyFrames([]); setViewObservationId('');
      const result = await window.gamepilot.startRun({ imageId: input.id, prompt, timeoutMs: timeout * 1000, executionMode, successCondition: ['verified-xbox', 'approach-xbox'].includes(executionMode) ? successCondition : undefined, benchmark: assignment ?? undefined, approach: executionMode === 'approach-xbox' ? approach : undefined });
      if (result.ok) { setAssignment(null); activeRun.current = result.value.runId; setRunId(result.value.runId); }
      else { setError(result.error); setStatus('idle'); void refreshConfig(); }
    } catch { setError('无法启动 Runtime'); setStatus('failed'); }
    finally { setStarting(false); }
  };
  const cancel = async () => {
    if (!runId) return; setStatus('canceling');
    const result = await window.gamepilot.cancelRun(runId);
    if (!result.ok) { setError(result.error); const snap = await window.gamepilot.getSnapshot(); if (snap.ok && snap.value) setStatus(snap.value.status); }
  };
  const last = events.at(-1);
  const phase = status === 'paused' ? '已归零暂停；总超时继续计时，恢复将重新观察' : status === 'pausing' ? '等待当前调用中断和归零确认' : status === 'canceling' ? '等待取消及手柄归零确认' : last?.type === 'input_preparing' ? '3 秒准备：请切换到 Cemu'
    : last?.type === 'verification_start' || last?.type === 'verification_model_text' ? '独立验证：正在判断固定成功条件'
    : last?.type === 'observation_post_start' ? '输入已释放，正在获取验证新帧'
    : last?.type === 'observation_start' ? '正在截取游戏窗口新帧'
    : last?.type === 'simulation_start' || last?.type === 'tool_execution_start' ? (executionMode === 'simulation' ? '正在执行模拟技能' : '正在执行真实手柄技能')
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
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-icon">G<span>↗</span></div><div><h1>GamePilot</h1><span>VISUAL AGENT LAB</span></div></div>
      <div className="header-description">视觉闭环与目标验证 <span>/ P3 实验 · P4 验收</span></div><span className="mode-badge"><span className="amber-dot" />{executionMode === 'simulation' ? '模拟工具模式' : executionMode === 'approach-xbox' ? 'P3 反馈技能实验' : executionMode === 'verified-xbox' ? '真实工具 + 独立验证' : '真实虚拟 Xbox 工具'}</span></header>
    <div className="config-strip"><div className="config-model"><span className={`status-dot ${config?.status === 'ready' ? 'ready' : ''}`} /><span className="mono">{config?.modelId || '模型配置待就绪'}</span></div>
      <span className="config-message" title={config?.configPath}>{config?.message || '正在读取模型配置…'}</span><button disabled={busy} onClick={refreshConfig} title="重新读取模型配置">↻ 刷新配置</button></div>
    {error && <div className="app-error" role="alert"><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}
    <CaptureToolbar windows={windows} selected={sourceId} setSelected={setSourceId} state={capture} busy={busy || snapshotting || inputBusy} onRefresh={refreshWindows} onStart={startPreview} onStop={stopPreview} onSnapshot={snapshot} />
    <InputDebugPanel state={inputState} modelBusy={busy} onConnect={connectInput} onDisconnect={disconnectInput} onExecute={executeInput} onStop={stopInput} />
    <main className="workspace" ref={layout} style={{ '--left-width': `${ratio}%` } as React.CSSProperties}>
      <div className="preview-column">
        {(capture.window || runImage) && <div className="input-tabs">
          {capture.window && <button className={showLive ? 'selected' : ''} onClick={() => setShowLive(true)}>实时画面</button>}
          <button className={!showLive && !showRunImage ? 'selected' : ''} onClick={() => { setShowRunImage(false); setShowLive(false); setViewObservationId(''); }}>待运行图片</button>
          {runImage && <button className={!showLive && showRunImage && !viewObservationId ? 'selected' : ''} onClick={() => { setShowRunImage(true); setShowLive(false); setViewObservationId(''); }}>记录对应的输入</button>}
        </div>}
        {keyFrames.length > 0 && <label className="evidence-selector">关键截图 <select aria-label="运行关键截图" value={viewObservationId} onChange={e => { setViewObservationId(e.target.value); setShowLive(false); setShowRunImage(true); }}><option value="">模型初始输入</option>{keyFrames.map(frame => <option key={frame.image.id} value={frame.image.id}>{frame.phase === 'before' ? '初始' : '动作后'} · 帧 #{frame.image.evidence?.frameSequence} · {frame.image.id.slice(0, 8)}</option>)}</select></label>}
        <InputPreview image={viewObservationId ? keyFrames.find(frame => frame.image.id === viewObservationId)?.image ?? null : showRunImage ? runImage : image} purpose={viewObservationId ? 'evidence' : undefined} used={Boolean(runImage && (showRunImage || image?.id === runImage.id))} busy={busy || snapshotting} onImport={importImage} live={showLive ? capture : undefined} />
      </div>
      <div className="splitter" role="separator" aria-label="调整左右宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={resize}
        onKeyDown={e => { if (e.key === 'ArrowLeft') setRatio(x => Math.max(35, x - 2)); if (e.key === 'ArrowRight') setRatio(x => Math.min(65, x + 2)); }}><span /></div>
      <section className="agent-pane"><div className="agent-bar"><div><span className="eyebrow">AGENT TRANSCRIPT</span><h2>执行记录</h2></div>
        <span className={`run-status ${busy ? 'is-active' : ''}`}><span className={busy ? 'activity-dot' : 'status-dot'} />{statusLabel[status]}</span></div>
        <AgentTranscript events={events} status={status} phase={phase} />
        {busy && ['verified-xbox', 'approach-xbox'].includes(executionMode) && <div className="agent-footer">
          {executionMode === 'verified-xbox' && <button disabled={!['running', 'paused'].includes(status)} onClick={async () => { const result = await (status === 'paused' ? window.gamepilot.resumeRun(runId) : window.gamepilot.pauseRun(runId)); if (!result.ok) setError(result.error); }}>{status === 'paused' ? '恢复任务' : '暂停任务'}</button>}
          <button disabled={status === 'canceling'} onClick={async () => { const result = await window.gamepilot.takeoverRun(runId); if (!result.ok) setError(result.error); }}>接管游戏</button>
        </div>}
        {executionMode !== 'approach-xbox' && <details className="p4-presets"><summary>P4 固定任务验收</summary>
          <label>冻结批次 ID <input aria-label="P4 批次 ID" disabled={busy} value={campaignId} onChange={e => { setCampaignId(e.target.value); setAssignment(null); }} /></label>
          <button disabled={busy || !campaignId.trim()} onClick={async () => {
            const result = await window.gamepilot.getP4Assignment(campaignId.trim());
            if (!result.ok) { setError(result.error); return; }
            if (!result.value) { setAssignment(null); setError('35 项均已预约，请生成报告并保留失败记录'); return; }
            setAssignment(result.value); setTimeoutValue(result.value.timeoutMs / 1000); setPrompt(result.value.prompt); setSuccessCondition(result.value.successCondition); setExecutionMode('verified-xbox'); setWindowInput(true);
          }}>载入下一项</button>
          {assignment && <p>{assignment.group} · 第 {assignment.trial} 次。先手工恢复冻结场景，再运行。取消组需在指定阶段按 F8。<button disabled={busy} onClick={() => setAssignment(null)}>退出本次验收</button></p>}
        </details>}
        <AgentComposer approach={approach} setApproach={setApproach} prompt={prompt} setPrompt={setPrompt} busy={busy} mode={executionMode} successCondition={successCondition} setSuccessCondition={setSuccessCondition} setMode={mode => {
          setExecutionMode(mode); if (mode !== 'verified-xbox') setAssignment(null);
          if (mode === 'approach-xbox') setPrompt('观察固定可见目标，在清晰可操作场景调用一次 approach_target。根据技能内部反馈停止，按独立验证报告屏幕视觉条件是否达到。');
          if (mode !== 'simulation' && (!realRuntimeAvailable || (mode === 'verified-xbox' && !verifiedRuntimeAvailable) || (mode === 'approach-xbox' && !approachAvailable))) setError('真实模型工具/验证的 Main/preload 未就绪，请关闭应用并重新执行 start.ps1');
          if (mode !== 'simulation') { setWindowInput(true); if (prompt.includes('move_for 模拟向左移动')) setPrompt(mode === 'verified-xbox' ? '观察游戏画面，围绕固定成功条件选择短移动或只读等待。根据动作后验证决定是否继续，条件通过后停止。' : '观察当前游戏画面；若处于可操作场景，调用一次 move_for 向左移动 200 毫秒。总结输入回执，不要声称游戏目标已完成。'); }
        }} canceling={status === 'canceling' || starting} canRun={!busy && !inputBusy && !snapshotting && (windowInput ? capture.status === 'streaming' : Boolean(image)) && config?.status === 'ready' && Boolean(prompt.trim()) && (executionMode === 'simulation' || (realRuntimeAvailable && windowInput && capture.status === 'streaming' && inputState.mode === 'virtual-xbox' && inputState.status === 'ready')) && (executionMode !== 'verified-xbox' || (verifiedRuntimeAvailable && Boolean(successCondition.trim()))) && (executionMode !== 'approach-xbox' || (approachAvailable && approachValid && Boolean(successCondition.trim())))} onRun={start} onCancel={cancel} />
        <div className="agent-footer"><label>总超时 <select aria-label="总超时" disabled={busy} value={timeout} onChange={e => setTimeoutValue(Number(e.target.value))}><option value={30}>30 秒</option>{![30, 60, 120].includes(timeout) && <option value={timeout}>{timeout} 秒（冻结配置）</option>}<option value={60}>60 秒</option><option value={120}>120 秒</option></select></label>
          <button disabled={!runId} onClick={async () => { const result = await window.gamepilot.openLogs(runId); if (!result.ok) setError(result.error); }}>打开日志目录 ↗</button></div>
      </section>
    </main>
    <footer className="app-footer"><span><span className="status-dot ready" />本地调试 · P4 验收</span><span>{executionMode === 'simulation' ? '模型工具为模拟 · 不发送手柄输入' : executionMode === 'approach-xbox' ? 'P3 实验 · 最多 8 段 × 200ms · 新帧纠偏 · F8 停止' : executionMode === 'verified-xbox' ? '最多 2 次移动 + 1 次等待 · 独立 VLM 验证 · F8 停止' : '真实 move_for · 每任务最多一次 · F8 停止 · 游戏目标未经验证'}</span><span className="mono">{runId ? `RUN ${runId.slice(0, 8)}` : 'READY WHEN YOU ARE'}</span></footer>
  </div>;
}
