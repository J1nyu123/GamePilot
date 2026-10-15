export interface ModelConnectionInput {
  provider: string;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  supportsImages: boolean;
}
export const modelChannels = { get: 'model:get', save: 'model:save', test: 'model:test', reset: 'model:reset' } as const;
export type ConnectionStatus = 'unconfigured' | 'untested' | 'connected' | 'error';
export interface ModelConnectionInfo extends Omit<ModelConnectionInput, 'apiKey'> {
  hasApiKey: boolean;
  status: ConnectionStatus;
  message: string;
  source: 'session' | 'environment';
}
