import type { ImportedImage } from '../../contracts/debug';
import type { CaptureState } from '../../contracts/capture';
export default function InputPreview({ image, busy, onImport, used, live, purpose }: { image: ImportedImage | null; busy: boolean; used: boolean; onImport(): void; live?: CaptureState; purpose?: 'evidence' }) {
  const frame = live?.status === 'streaming' ? live.frame : undefined;
  const displayUrl = live ? frame?.dataUrl : image?.dataUrl;
  const evidence = live ? frame : image?.evidence;
  return <section className="preview-pane" aria-label="模型输入图片">
    <div className="pane-bar"><div><span className="eyebrow">OBSERVATION</span><h2>{live ? '实时游戏画面' : purpose ? '运行关键帧 / 验证证据' : '本次模型输入'}</h2></div>
      <button className="button secondary" onClick={onImport} disabled={busy}>{image ? '替换图片' : '导入图片'} <span>↗</span></button></div>
    <div className={`image-stage ${displayUrl ? 'has-image' : ''}`}>
      {displayUrl ? <><img src={displayUrl} alt={live ? '游戏窗口实时画面' : '实际发送给模型的游戏截图'} /><span className="image-badge">{live ? '只读预览 · 未发送模型' : purpose ? '关键帧 · 验证证据' : busy ? '本次输入已锁定' : used ? '本次运行使用的图片' : image?.evidence ? '窗口新帧 · 待运行' : '手动导入 · 待运行'}</span></>
        : live ? <div className="import-empty"><div className="image-symbol">▣</div><h3>{live.status === 'error' ? '窗口画面不可用' : '等待窗口画面'}</h3><p>{live.message}</p><small>无法确认新帧时，不沿用旧预览</small></div>
        : <div className="import-empty"><div className="image-symbol">▧</div><span className="eyebrow">START WITH AN OBSERVATION</span>
          <h3>让 Agent 看见游戏</h3><p>导入一张游戏截图，观察模型反馈<br />与模拟技能的完整调用过程。</p>
          <button className="button primary" onClick={onImport}>＋ 选择 PNG / JPEG</button><small>最大 10 MiB · 点击运行后才发送图片</small></div>}
    </div>
    <div className="image-meta">
      <div><span>输入来源</span><strong>{live ? live.window?.title || '尚未选择' : image?.name || '尚未导入'}</strong></div>
      <div><span>图像尺寸</span><strong className="mono">{live ? frame ? `${frame.width} × ${frame.height}` : '—' : image ? `${image.width} × ${image.height}` : '—'}</strong></div>
      <div><span>源采集时间</span><strong>{evidence?.capturedAt ? new Date(evidence.capturedAt).toLocaleTimeString() : evidence ? '接口未提供 · 使用源帧时钟' : '未知 · 本地图片'}</strong></div>
      <div><span>{evidence ? '源帧序号 / 时钟' : '导入时间'}</span><strong className="mono">{evidence ? `#${evidence.frameSequence} / ${evidence.sourceMediaTime.toFixed(3)}s` : image ? new Date(image.importedAt).toLocaleTimeString() : '—'}</strong></div>
    </div>
    <div className="input-reference" title={image?.path}><span className="status-dot" /><span>{live ? `CAPTURE ${live.generation} · ${live.status}` : image ? `INPUT ${image.id.slice(0, 8)}` : '等待输入'}</span><span className="ml-auto">{live ? '源帧屏障后' : image ? `${(image.size / 1024).toFixed(0)} KB` : 'PNG / JPEG'}</span></div>
  </section>;
}
