import type { CaptureState, GameWindow } from '../../contracts/capture';
export default function CaptureToolbar({ windows, selected, setSelected, state, busy, onRefresh, onStart, onStop, onSnapshot }: {
  windows: GameWindow[]; selected: string; setSelected(value: string): void; state: CaptureState; busy: boolean;
  onRefresh(): void; onStart(): void; onStop(): void; onSnapshot(): void;
}) {
  const active = state.status === 'starting' || state.status === 'streaming';
  return <div className="capture-toolbar">
    <span className="capture-icon">▣</span><select aria-label="游戏窗口" value={selected} disabled={busy || active} onChange={e => setSelected(e.target.value)}>
      <option value="">选择 Cemu 或其他游戏窗口</option>{windows.map(w => <option value={w.id} key={w.id}>{w.title}{w.minimized ? ' [已最小化]' : ''}</option>)}</select>
    <button className="button secondary" title="刷新窗口列表" onClick={onRefresh} disabled={busy}>↻</button>
    {active ? <button className="button secondary" onClick={onStop}>停止预览</button> : <button className="button secondary" disabled={busy || !selected} onClick={onStart}>开始预览</button>}
    <button className="button secondary" disabled={busy || state.status !== 'streaming'} onClick={onSnapshot}>截取新帧</button>
    <span className={`capture-status ${state.status === 'error' ? 'error-color' : ''}`}><span className={state.status === 'starting' ? 'activity-dot' : state.status === 'streaming' ? 'status-dot ready' : 'status-dot'} />
      {state.message}{state.status === 'streaming' && state.window && !state.window.foreground ? ' · 窗口未置前' : ''}</span>
  </div>;
}
