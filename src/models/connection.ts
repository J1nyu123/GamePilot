import type { ModelConnectionInfo, ModelConnectionInput } from '../contracts/model-connection';
import type { ConfigSummary } from '../contracts/debug';
import type { ModelConfig } from '../main/model-config';

export function validateConnection(input: ModelConnectionInput, existingKey = ''): ModelConfig & { supportsImages: boolean } {
  if (!input || typeof input !== 'object') throw new Error('无效的模型配置');
  for (const field of ['provider', 'baseUrl', 'modelId'] as const) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 512 || /[\r\n\u0000]/.test(input[field])) throw new Error(`请填写有效的 ${field}`);
  }
  let url: URL; try { url = new URL(input.baseUrl.trim()); } catch { throw new Error('API 地址格式无效'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('远程 API 地址必须使用 HTTPS；本机服务可使用 HTTP');
  if (/\/chat\/completions\/?$/.test(url.pathname)) throw new Error('请填写 Base URL，不要包含 /chat/completions');
  if (typeof input.supportsImages !== 'boolean') throw new Error('请声明模型是否支持图片输入');
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 格式无效');
  const apiKey = input.apiKey?.trim() || existingKey;
  if (!apiKey || apiKey.length > 8192 || /[\r\n\u0000]/.test(apiKey) || apiKey.startsWith('!')) throw new Error('请填写有效的 API Key');
  return { provider: input.provider.trim(), baseUrl: url.href.replace(/\/$/, ''), modelId: input.modelId.trim(), apiKey,
    supportsImages: input.supportsImages, configPath: '会话内 API 配置（关闭后清除）' };
}

/** Host-owned credentials. Only public metadata crosses IPC/HTTP. */
export class ModelConnection {
  private override?: ModelConfig & { supportsImages: boolean };
  private generation = 0;
  private checkedIdentity = '';
  private state: ModelConnectionInfo['status'] = 'untested';
  private message = '配置已就绪 · 尚未测试连接';
  constructor(private fallback: () => Promise<ModelConfig>, private request: typeof fetch = fetch) {}
  private async resolve() { return this.override ?? { ...await this.fallback(), supportsImages: true }; }
  private identity(config: ModelConfig) { return JSON.stringify([config.baseUrl, config.modelId, config.provider, config.apiKey]); }
  async info(): Promise<ModelConnectionInfo> {
    try {
      const config = await this.resolve();
      const checked = this.checkedIdentity === this.identity(config);
      return { provider: config.provider, baseUrl: config.baseUrl, modelId: config.modelId, supportsImages: config.supportsImages,
        hasApiKey: true, status: checked ? this.state : 'untested', message: checked ? this.message : '配置已就绪 · 尚未测试连接', source: this.override ? 'session' : 'environment' };
    } catch (error) {
      return { provider: 'custom', baseUrl: '', modelId: '', supportsImages: true, hasApiKey: false, status: 'unconfigured',
        message: error instanceof Error ? error.message : '模型 API 尚未配置', source: 'environment' };
    }
  }
  async save(input: ModelConnectionInput) {
    let current: Awaited<ReturnType<ModelConnection['resolve']>> | undefined;
    try { current = await this.resolve(); } catch { /* A new key can configure an empty connection. */ }
    const sameEndpoint = current && input?.baseUrl?.trim().replace(/\/$/, '') === current.baseUrl.replace(/\/$/, '');
    this.override = validateConnection(input, sameEndpoint ? current!.apiKey : '');
    this.generation++; this.checkedIdentity = ''; this.state = 'untested'; this.message = '配置已就绪 · 尚未测试连接';
    return this.info();
  }
  async reset() { this.override = undefined; this.generation++; this.checkedIdentity = ''; return this.info(); }
  async runtimeConfig(requireVision = true): Promise<ModelConfig> {
    const config = await this.resolve();
    if (requireVision && !config.supportsImages) throw new Error('视觉任务需要支持图片输入的模型');
    return { baseUrl: config.baseUrl, apiKey: config.apiKey, provider: config.provider, modelId: config.modelId, configPath: config.configPath };
  }
  async summary(): Promise<ConfigSummary> {
    const info = await this.info();
    return { status: info.hasApiKey ? 'ready' : 'missing', provider: info.provider, modelId: info.modelId,
      configPath: this.override?.configPath ?? (await this.fallback().catch(() => undefined))?.configPath ?? '环境 / 配置文件',
      endpoint: info.baseUrl || undefined, message: info.message, connectionStatus: info.status, supportsImages: info.supportsImages };
  }
  async complete(system: string, prompt: string, options: { testImage?: boolean; timeoutMs?: number; maxTokens?: number } = {}) {
    const config = await this.resolve(), generation = this.generation;
    const identity = this.identity(config);
    try {
      const content = options.testImage ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR4nO3NMQ0AAAwDoEqv9KrYsQQMkB6LQCAQCAQCgUAg+BIMLd4AW+JNPdoAAAAASUVORK5CYII=' } }] : prompt;
      const response = await this.request(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.modelId, stream: false, max_tokens: options.maxTokens ?? 2048,
          ...(/^ark\.[a-z0-9-]+\.volces\.com$/.test(new URL(config.baseUrl).hostname) && config.modelId.startsWith('doubao-seed-') ? { thinking: { type: 'disabled' } } : {}),
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }] }),
      });
      if (!response.ok) throw new Error(`API 请求失败（HTTP ${response.status}）${response.status === 401 || response.status === 403 ? '，请检查 Key 和权限' : response.status === 404 ? '，请检查 Base URL 和模型 ID' : response.status === 429 ? '，请检查额度或稍后重试' : ''}`);
      const body = await response.text();
      if (body.length > 1024 * 1024) throw new Error('模型响应过大');
      let data: any; try { data = JSON.parse(body); } catch { throw new Error('API 返回了无效 JSON，请检查兼容协议'); }
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('模型没有返回有效文本，请检查模型与 OpenAI 兼容协议');
      if (generation !== this.generation) throw new Error('请求期间配置已改变，请重试');
      this.checkedIdentity = identity; this.state = 'connected'; this.message = 'API 调用成功 · 游戏任务能力以实际执行为准';
      return text.split(config.apiKey).join('[REDACTED]');
    } catch (error) {
      const message = error instanceof Error && /^(API |模型|请求期间)/.test(error.message) ? error.message : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'API 请求超时，请检查端点或稍后重试' : 'API 连接失败，请检查网络、地址或兼容协议';
      if (generation === this.generation) { this.checkedIdentity = identity; this.state = 'error'; this.message = message; }
      throw new Error(message);
    }
  }
  async test() {
    const config = await this.resolve();
    await this.complete('', 'Reply with OK.', { testImage: config.supportsImages, maxTokens: 32 });
    return this.info();
  }
}
