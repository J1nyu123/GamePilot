import { useEffect, useState } from 'react';
import type { ApproachSpec } from '../../contracts/approach';
export default function ApproachSetup({ value, change, busy }: { value: Omit<ApproachSpec, 'targetId'>; change(value: Omit<ApproachSpec, 'targetId'>): void; busy: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  return <details className="approach-setup" open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>P3 可见目标接近 · 实验配置</summary>
    <p>受控镜头、无遮挡简单路径。每段 200ms，最多 8 段；目标丢失或状态过期即停止。</p>
    <label>唯一可见目标<input aria-label="P3 目标描述" value={value.description} disabled={busy} maxLength={500} onChange={e => change({ ...value, description: e.target.value })} placeholder="例如：画面中央、石阶左侧唯一的石柱" /></label>
    <div className="approach-region">到达区域（0–1）：{['x', 'y', '宽', '高'].map((label, index) => <label key={label}>{label}<input aria-label={`P3 区域${label}`} type="number" min="0" max="1" step="0.05" disabled={busy} value={Number.isFinite(value.region[index]) ? value.region[index] : ''} onChange={e => { const region = [...value.region] as ApproachSpec['region']; region[index] = e.target.value === '' ? NaN : Number(e.target.value); change({ ...value, region }); }} /></label>)}</div>
    <label>最小目标面积占比<input aria-label="P3 最小面积" type="number" min="0.01" max="0.4" step="0.01" value={Number.isFinite(value.minArea) ? value.minArea : ''} disabled={busy} onChange={e => change({ ...value, minArea: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
    <label><input type="checkbox" aria-label="P3 要求交互提示" checked={Boolean(value.requireInteraction)} disabled={busy} onChange={e => change({ ...value, requireInteraction: e.target.checked })} />到达时必须出现该目标的交互按键和文字提示</label>
    <p>开启后，面积达标但提示明确未出现时继续有限短移；提示无法确认则停止。不会执行交互。</p>
    <p>目标中心在区域内且面积达标，连续两帧保持后再独立验证。仅表示屏幕视觉条件；P4 实机验收尚未完成。</p>
  </details>;
}
