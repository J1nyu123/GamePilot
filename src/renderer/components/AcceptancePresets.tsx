import { useState } from 'react';
import { acceptanceCases } from '../../contracts/acceptance';

export default function AcceptancePresets({ busy, apply }: {
  busy: boolean; apply(prompt: string, condition: string): void;
}) {
  const [selected, setSelected] = useState('');
  const preset = acceptanceCases.find(item => item.id === selected);
  return <details className="acceptance-presets">
    <summary>P2-D 验收指令 · 只填入，不自动执行</summary>
    <label>选择验收样例 <select aria-label="验收样例" disabled={busy} value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">请选择…</option>{acceptanceCases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {preset && <><p>{preset.note}</p><button type="button" className="button secondary" disabled={busy} onClick={event => {
      apply(preset.prompt, preset.condition); const details = event.currentTarget.closest('details'); if (details) details.open = false;
    }}>填入指令与条件</button></>}
    <small>填入会替换当前草稿；仍需点击“运行一次”。提示词不改变 Runtime 的最多两次移动预算，结束后检查实际调用次数。</small>
  </details>;
}
