export default function AgentComposer({ prompt, setPrompt, busy, canRun, canceling, onRun, onCancel }: {
  prompt: string; setPrompt(text: string): void; busy: boolean; canRun: boolean; canceling: boolean;
  onRun(): void; onCancel(): void;
}) {
  return <div className="composer">
    <div className="composer-top"><span>❯ 任务指令</span><span>视觉动作闭环</span></div>
    <textarea aria-label="任务指令" value={prompt} disabled={busy} maxLength={8000} onChange={e => setPrompt(e.target.value)}
      onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) { e.preventDefault(); onRun(); } }}
      placeholder="例如：走到前面柱子处，观察并确认结果…" />
    <div className="composer-actions"><span><span className="amber-dot" />输入方式由执行模式决定</span>
      {busy ? <button className="button danger" onClick={onCancel} disabled={canceling}>{canceling ? '正在取消…' : '■ 取消运行'}</button>
        : <button className="button primary" onClick={onRun} disabled={!canRun}>运行一次 <span>↗</span></button>}
    </div>
  </div>;
}
