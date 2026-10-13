export function visionModel(baseUrl, modelId) {
  return { id: modelId, name: modelId, api: 'openai-completions', provider: 'gamepilot-p1', baseUrl,
    reasoning: false, input: ['text', 'image'], contextWindow: 32768, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      supportsUsageInStreaming: false, supportsStrictMode: false, maxTokensField: 'max_tokens' } };
}
export function shouldDisableThinking(baseUrl, modelId, thinkingMode) {
  return thinkingMode === 'disabled' || (thinkingMode === undefined && /^ark\.[a-z0-9-]+\.volces\.com$/.test(new URL(baseUrl).hostname) && modelId.startsWith('doubao-seed-'));
}
