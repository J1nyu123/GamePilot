import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelConfig, resolveKey, redact } from '../src/main/model-config';
const config = { providers: { volcengine: { baseUrl: 'https://example.com/v1', api: 'openai-completions', apiKey: '${ARK_API_KEY}', models: [{ id: 'vision-test', input: ['text', 'image'] }] } } };
test('existing Pi config template resolves only in Main', () => {
  const result = parseModelConfig(config, 'models.json', { ARK_API_KEY: 'test-secret' });
  assert.equal(result.apiKey, 'test-secret'); assert.equal(result.modelId, 'vision-test');
  assert.throws(() => parseModelConfig(config, 'models.json', {}), /ARK_API_KEY/);
});
test('reject shell references and unsafe endpoints', () => {
  assert.throws(() => resolveKey('!echo unsafe', {}), /命令型/);
  assert.throws(() => parseModelConfig(config, 'config', { ARK_API_KEY: 'secret', GAMEPILOT_BASE_URL: 'http://remote.example/v1' }), /HTTPS/);
  assert.throws(() => parseModelConfig(config, 'config', { ARK_API_KEY: 'secret', GAMEPILOT_BASE_URL: 'https://example.com/v1?api_key=secret' }), /凭据/);
});
test('credential never survives serialized events and summaries', () => {
  const output = redact({ error: 'Echo test-secret and Bearer xyz.abc', nested: { text: 'test-secret' } }, ['test-secret']);
  assert.ok(!JSON.stringify(output).includes('test-secret')); assert.ok(!JSON.stringify(output).includes('xyz.abc'));
});
