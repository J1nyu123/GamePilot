import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ConfigSummary } from '../contracts/debug';
export interface ModelConfig { baseUrl: string; apiKey: string; modelId: string; provider: string; configPath: string }
export function resolveKey(value: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('API Key 未配置');
  if (value.startsWith('!')) throw new Error('不支持命令型密钥引用，请使用环境变量');
  const resolved = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a: string, b: string) => {
    const name = a || b;
    if (!env[name]?.trim()) throw new Error(`缺少环境变量 ${name}；请在启动应用的终端中设置`);
    return env[name]!;
  });
  if (!resolved.trim() || /[\r\n]/.test(resolved)) throw new Error('API Key 格式无效');
  return resolved.trim();
}
export function parseModelConfig(raw: unknown, configPath: string, env: NodeJS.ProcessEnv): ModelConfig {
  const data = raw as { providers?: Record<string, { baseUrl?: string; apiKey?: string; api?: string; models?: { id: string; api?: string; input?: string[] }[] }> };
  const provider = env.GAMEPILOT_PROVIDER || 'volcengine';
  const settings = data?.providers?.[provider];
  if (!settings) throw new Error(`配置中找不到 provider: ${provider}`);
  const model = settings.models?.find(m => m.id === env.GAMEPILOT_MODEL) || (!env.GAMEPILOT_MODEL ? settings.models?.[0] : undefined);
  if (!model?.id) throw new Error('配置中找不到选定模型');
  if ((model.api || settings.api) !== 'openai-completions') throw new Error('当前调试 Runtime 仅支持 openai-completions');
  if (!model.input?.includes('image')) throw new Error('模型配置未声明 image 输入');
  const baseUrl = env.GAMEPILOT_BASE_URL || settings.baseUrl;
  if (!baseUrl) throw new Error('缺少模型端点');
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('模型端点不能包含凭据、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('远程模型端点必须使用 HTTPS');
  return { provider, baseUrl, modelId: model.id, apiKey: resolveKey(env.GAMEPILOT_API_KEY || settings.apiKey, env), configPath };
}
export function redact<T>(value: T, secrets: string[]): T {
  let serialized = JSON.stringify(value);
  for (const key of secrets.filter(Boolean)) serialized = serialized.split(key).join('[REDACTED]');
  serialized = serialized.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
  return JSON.parse(serialized) as T;
}
export async function loadModelConfig(root: string, env = process.env): Promise<ModelConfig> {
  const path = resolve(env.GAMEPILOT_CONFIG || resolve(root, '../pi/.pi-agent/models.json'));
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error(`无法读取有效 JSON 配置：${path}`); }
  return parseModelConfig(raw, path, env);
}
export async function configSummary(root: string): Promise<ConfigSummary> {
  const configPath = resolve(process.env.GAMEPILOT_CONFIG || resolve(root, '../pi/.pi-agent/models.json'));
  try {
    const config = await loadModelConfig(root);
    return { status: 'ready', modelId: config.modelId, provider: config.provider, configPath,
      endpoint: new URL(config.baseUrl).origin, message: '配置已就绪 · 鉴权将在运行时验证' };
  } catch (error) {
    // Parsing exceptions never include raw configuration or credential values.
    return { status: 'missing', modelId: '', provider: process.env.GAMEPILOT_PROVIDER || 'volcengine', configPath, message: error instanceof Error ? error.message : '配置无效' };
  }
}
