import ApproachSetup from './ApproachSetup';
import type { ApproachSpec } from '../../contracts/approach';
import type { ExecutionMode } from '../../contracts/debug';
import type { ExecutionStrategy } from '../../contracts/run';
import AcceptancePresets from './AcceptancePresets';
export default function AgentComposer({ prompt, setPrompt, busy, canRun, canceling, onRun, onCancel, mode, setMode, successCondition, setSuccessCondition, approach, setApproach, executionStrategy, setExecutionStrategy }: {
  prompt: string; setPrompt(text: string): void; busy: boolean; canRun: boolean; canceling: boolean; onRun(): void; onCancel(): void;
  mode: ExecutionMode; setMode(mode: ExecutionMode): void;
  approach: Omit<ApproachSpec, 'targetId'>; setApproach(value: Omit<ApproachSpec, 'targetId'>): void;
  successCondition: string; setSuccessCondition(text: string): void;
  executionStrategy: ExecutionStrategy; setExecutionStrategy(value: ExecutionStrategy): void;
}) {
  return <div className="composer"><div className="composer-top"><span>❯ 任务指令</span><label>模型工具 <select aria-label="模型工具模式" disabled={busy} value={mode} onChange={e => setMode(e.target.value as ExecutionMode)}><option value="simulation">模拟工具</option><option value="virtual-xbox">真实虚拟 Xbox</option><option value="verified-xbox">真实工具 + 目标验证</option><option value="approach-xbox">P3 目标接近实验</option></select></label></div>
    {mode === 'verified-xbox' && <AcceptancePresets busy={busy} apply={(text, condition) => { setPrompt(text); setSuccessCondition(condition); }} />}
    {mode === 'approach-xbox' && <ApproachSetup value={approach} change={setApproach} busy={busy} />}
    {mode === 'approach-xbox' && <label>执行路径 <select aria-label="P3 执行路径" value={executionStrategy} disabled={busy} onChange={e => setExecutionStrategy(e.target.value as ExecutionStrategy)}><option value="agent">Agent 选择技能</option><option value="direct">直接执行技能</option></select></label>}
    <textarea aria-label="任务指令" value={prompt} disabled={busy} maxLength={8000} onChange={e => setPrompt(e.target.value)}
      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) { e.preventDefault(); onRun(); } }} placeholder="描述你希望模型观察和执行的任务…" />
    {(mode === 'verified-xbox' || mode === 'approach-xbox') && <label className="goal-condition">固定成功条件 · 只依据可见画面<textarea aria-label="成功条件" value={successCondition} disabled={busy} maxLength={2000} onChange={e => setSuccessCondition(e.target.value)} placeholder="例如：角色已接近画面中指定石柱。模糊或不可见条件会返回无法判断。" />{!successCondition.trim() && <span>填写可从截图判断的成功条件后才能运行。</span>}</label>}
    <div className="composer-actions"><span><span className="amber-dot" />{mode === 'simulation' ? '模拟 move_for · 不发送手柄输入' : '真实输入 · 3 秒切换到 Cemu · F8 停止'}</span>
      {busy ? <button className="button danger" onClick={onCancel} disabled={canceling}>{canceling ? '正在取消…' : '■ 取消运行'}</button>
        : <button className="button primary" onClick={onRun} disabled={!canRun}>运行一次 <span>↗</span></button>}</div>
  </div>;
}
