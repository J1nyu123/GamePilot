import { useEffect, useState } from 'react';
import type { DebugApi } from '../../contracts/debug';
import type { ModelConnectionInfo } from '../../contracts/model-connection';

export default function ModelConnectionPanel({ api, onChanged, onClose }: { api: DebugApi; onChanged(): Promise<void>; onClose(): void }) {
  const [info, setInfo] = useState<ModelConnectionInfo | null>(null);
  const [provider, setProvider] = useState('custom'), [baseUrl, setBaseUrl] = useState(''), [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState(''), [supportsImages, setSupportsImages] = useState(true);
  const [pending, setPending] = useState(true), [message, setMessage] = useState('正在读取配置…'), [error, setError] = useState(false);
  const load = (value: ModelConnectionInfo) => {
    setInfo(value); setProvider(value.provider); setBaseUrl(value.baseUrl); setModelId(value.modelId);
    setSupportsImages(value.supportsImages); setApiKey(''); setMessage(value.message); setError(value.status === 'error');
  };
  useEffect(() => {
    let active = true;
    if (typeof api.getModelConnection !== 'function') { setMessage('模型 API 接口已更新，请关闭应用并重新运行 npm run dev'); setError(true); setPending(false); return; }
    void api.getModelConnection().then(result => { if (!active) return; if (result.ok) load(result.value); else { setMessage(result.error); setError(true); } })
      .catch(() => { if (active) { setMessage('无法读取模型配置，请重启项目'); setError(true); } })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [api]);
  const action = async (kind: 'save' | 'test' | 'reset') => {
    if (pending) return;
    setPending(true); setError(false); setMessage(kind === 'test' ? '正在测试 API（只发送测试文字 / 示例图，不调用手柄）…' : '正在更新配置…');
    try {
      const result = kind === 'save' ? await api.saveModelConnection({ provider, baseUrl, modelId, apiKey: apiKey || undefined, supportsImages })
        : kind === 'test' ? await api.testModelConnection() : await api.resetModelConnection();
      if (result.ok) load(result.value); else { setMessage(result.error); setError(true); }
      await onChanged();
    } catch { setMessage('模型配置服务不可用，请重启项目'); setError(true); }
    finally { setPending(false); }
  };
  const dirty = Boolean(apiKey) || provider !== info?.provider || baseUrl !== info?.baseUrl || modelId !== info?.modelId || supportsImages !== info?.supportsImages;
  return <div className="model-settings-backdrop">
    <section className="model-settings" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
      <div className="model-settings-heading"><h2 id="model-settings-title">模型 API 设置</h2><button type="button" disabled={pending} onClick={onClose} aria-label="关闭模型 API 设置">✕</button></div>
      <p>支持 OpenAI 兼容的 Chat Completions 协议。API Key 由主进程或本地服务持有；仅用于本次应用 / 服务进程，重启后清除。</p>
      <label>服务名称<input aria-label="API 服务名称" value={provider} disabled={pending} maxLength={128} onChange={e => setProvider(e.target.value)} autoComplete="off" /></label>
      <label>API Base URL<input aria-label="API Base URL" value={baseUrl} disabled={pending} maxLength={512} onChange={e => setBaseUrl(e.target.value)} placeholder="https://服务地址/v1" autoComplete="off" /></label>
      <small>填写到版本路径，不包含 /chat/completions。远程地址使用 HTTPS。</small>
      <label>模型 ID<input aria-label="API 模型 ID" value={modelId} disabled={pending} maxLength={512} onChange={e => setModelId(e.target.value)} placeholder="服务商提供的模型 ID" autoComplete="off" /></label>
      <label>API Key<input aria-label="API Key" type="password" value={apiKey} disabled={pending} maxLength={8192} onChange={e => setApiKey(e.target.value)} placeholder={info?.hasApiKey ? '已配置；留空保留，换地址需重新填写' : '输入 API Key'} autoComplete="new-password" /></label>
      <label className="model-image-option"><input type="checkbox" aria-label="模型支持图片输入" checked={supportsImages} disabled={pending} onChange={e => setSupportsImages(e.target.checked)} />模型支持图片输入（游戏视觉任务需要）</label>
      <p className={`model-connection-message ${error ? 'error' : ''}`} role="status">{message}</p>
      <div className="model-settings-actions">
        <button type="button" className="button secondary" disabled={pending} onClick={() => void action('reset')}>恢复环境配置</button>
        <button type="button" className="button secondary" disabled={pending || dirty || !info?.hasApiKey} onClick={() => void action('test')}>测试当前连接</button>
        <button type="button" className="button primary" disabled={pending || !baseUrl.trim() || !modelId.trim() || !provider.trim()} onClick={() => void action('save')}>保存并使用</button>
      </div>
      {dirty && <small>先保存设置，再测试当前连接。测试成功不代表已通过实机游戏验收。</small>}
    </section>
  </div>;
}
