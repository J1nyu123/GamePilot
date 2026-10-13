import { useEffect, useRef, useState } from 'react';
import type { InputDebugState, InputMode, ManualSkill, XboxButton } from '../../contracts/input';
import { buttons } from '../../input/skills';
export default function InputDebugPanel({ state, modelBusy, onConnect, onDisconnect, onExecute, onStop }: {
  state: InputDebugState; modelBusy: boolean; onConnect(mode: InputMode): void; onDisconnect(): void; onExecute(skill: ManualSkill): void; onStop(): void;
}) {
  const [mode, setMode] = useState<InputMode>('dry-run'), [skill, setSkill] = useState('move_for');
  const [direction, setDirection] = useState<'left' | 'right' | 'forward' | 'backward'>('left'), [button, setButton] = useState<XboxButton>('A');
  const [duration, setDuration] = useState(200), [strength, setStrength] = useState(.5);
  const panel = useRef<HTMLDetailsElement>(null);
  // Prioritize the transcript when a model task starts; users may reopen this panel.
  useEffect(() => { if (modelBusy && panel.current) panel.current.open = false; }, [modelBusy]);
  const connected = state.status !== 'disconnected' && state.status !== 'connecting';
  const busy = ['connecting', 'preparing', 'executing', 'resetting'].includes(state.status);
  const command = (): ManualSkill => skill === 'move_for' ? { skill: 'move_for', direction, strength, durationMs: duration } : { skill: 'press_button', button, durationMs: duration };
  return <details className="input-debug-panel" ref={panel}><summary><span>◈ 手柄输入调试 <span className="muted">/ P2-B</span></span><span className="input-summary">{state.message}</span><span className={state.neutral === true ? 'success-color' : 'muted'}>{state.neutral === true ? '服务确认已归零' : state.neutral === false ? '输入执行中' : '归零状态未知'}</span></summary>
    <div className="input-controls">
      <select aria-label="手柄服务模式" value={mode} disabled={connected || busy} onChange={e => setMode(e.target.value as InputMode)}><option value="dry-run">模拟服务 · 无设备</option><option value="virtual-xbox">真实虚拟 Xbox</option></select>
      {!connected ? <button className="button secondary" disabled={busy || modelBusy} onClick={() => onConnect(mode)}>连接手柄服务</button>
        : <button className="button secondary" onClick={onDisconnect}>断开手柄服务</button>}
      <select aria-label="手柄调试技能" value={skill} disabled={busy} onChange={e => setSkill(e.target.value)}><option value="move_for">move_for</option><option value="press_button">press_button</option></select>
      {skill === 'move_for' ? <><select aria-label="移动方向" value={direction} disabled={busy} onChange={e => setDirection(e.target.value as typeof direction)}><option value="left">向左</option><option value="right">向右</option><option value="forward">向前</option><option value="backward">向后</option></select>
        <label>力度 <input aria-label="摇杆力度" type="number" min="0.1" max="1" step="0.1" value={strength} disabled={busy} onChange={e => setStrength(Number(e.target.value))} /></label></>
        : <select aria-label="Xbox 按钮" value={button} disabled={busy} onChange={e => setButton(e.target.value as XboxButton)}>{buttons.map(b => <option key={b}>{b}</option>)}</select>}
      <label>时长 <input aria-label="手柄动作时长" type="number" min="20" max="1500" step="10" value={duration} disabled={busy} onChange={e => setDuration(Number(e.target.value))} /> ms</label>
      <button className="button secondary" disabled={modelBusy || state.status !== 'ready'} onClick={() => onExecute(command())}>{state.mode === 'virtual-xbox' ? '执行（3秒准备）' : '执行调试动作'}</button>
      <button className="button danger" disabled={!connected || state.status === 'resetting'} onClick={onStop}>停止并归零</button>
    </div>
    <div className="input-debug-note"><span>{state.mode === 'virtual-xbox' && connected ? '真实输入：执行前 3 秒切换到选定游戏；失焦自动停止；F8 停止并归零。' : '模拟服务验证 Python 协议、时序和取消，不连接虚拟设备。'} 右侧模型工具默认模拟，需单独选择真实模式。</span>
      {typeof state.cancelAckMs === 'number' && <span className="mono">reset ACK {state.cancelAckMs.toFixed(1)} ms</span>}</div>
    {state.lastResult && <div className="input-result" role="status">{state.lastResult.status === 'executed' ? '输入执行完成' : state.lastResult.status === 'cancelled' ? '输入已取消' : '输入异常'} · 游戏效果未经验证
      <details><summary>输入协议与结果</summary><pre className="json-block">{JSON.stringify({ command: state.lastCommand, lastResult: state.lastResult, history: state.history }, null, 2)}</pre></details></div>}
  </details>;
}
