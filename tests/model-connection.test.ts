import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelConnection, validateConnection } from '../src/models/connection';

const config = { provider: 'fixture', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'vision-fixture', apiKey: 'test-secret-old', configPath: 'fixture.json' };
const input = { ...config, supportsImages: true };
const reply = (text = 'OK') => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { headers: { 'Content-Type': 'application/json' } });
test('reading config makes no model requests; test sends a bounded request and never returns the key', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const connection = new ModelConnection(async () => config, (async (url, options) => { calls.push({ url: String(url), options: options! }); return reply(); }) as typeof fetch);
  assert.equal((await connection.info()).status, 'untested'); await connection.summary(); assert.equal(calls.length, 0);
  const result = await connection.test(); assert.equal(result.status, 'connected'); assert.ok(!JSON.stringify(result).includes(config.apiKey));
  assert.equal(calls[0].url, `${config.baseUrl}/chat/completions`);
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, `Bearer ${config.apiKey}`);
  const body = JSON.parse(calls[0].options.body as string); assert.equal(body.stream, false); assert.equal(body.model, config.modelId);
  assert.equal(body.tools, undefined); assert.equal(body.messages[0].content[1].type, 'image_url');
});
test('session settings override Runtime without rewriting fallback; blank key only retains at the same endpoint', async () => {
  const connection = new ModelConnection(async () => config);
  await connection.save({ ...input, modelId: 'new-model', apiKey: undefined });
  assert.equal((await connection.runtimeConfig()).apiKey, config.apiKey);
  assert.equal(config.modelId, 'vision-fixture');
  await assert.rejects(connection.save({ ...input, baseUrl: 'https://other.example/v1', apiKey: undefined }), /API Key/);
  assert.equal((await connection.info()).modelId, 'new-model');
  await connection.save({ ...input, apiKey: 'test-secret-new', supportsImages: false });
  await assert.rejects(connection.runtimeConfig(), /图片输入/);
  const publicInfo = await connection.info(); assert.ok(!JSON.stringify(publicInfo).includes('test-secret-new'));
  await connection.reset(); assert.equal((await connection.runtimeConfig()).apiKey, config.apiKey);
});
test('invalid URL, embedded credentials, protocol path, headers and flags are rejected', () => {
  for (const baseUrl of ['http://remote.example/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=unsafe', 'https://example.com/v1#unsafe', 'https://example.com/v1/chat/completions']) {
    assert.throws(() => validateConnection({ ...input, baseUrl }));
  }
  assert.throws(() => validateConnection({ ...input, apiKey: 'secret\nheader' }));
  assert.throws(() => validateConnection({ ...input, supportsImages: undefined as any }));
});
test('401 bodies, invalid JSON and empty text never leak credentials or claim connected', async () => {
  for (const response of [new Response(config.apiKey, { status: 401 }), new Response(config.apiKey), reply('')]) {
    const connection = new ModelConnection(async () => config, (async () => response) as typeof fetch);
    await assert.rejects(connection.test(), error => { assert.ok(!(error as Error).message.includes(config.apiKey)); return true; });
    const info = await connection.info(); assert.equal(info.status, 'error'); assert.ok(!JSON.stringify(info).includes(config.apiKey));
  }
});
test('stale test cannot label a replacement connection as connected', async () => {
  let finish!: (value: Response) => void, started!: () => void;
  const began = new Promise<void>(r => started = r);
  const connection = new ModelConnection(async () => config, (async () => { started(); return new Promise<Response>(r => finish = r); }) as typeof fetch);
  const pending = connection.test(); await began;
  await connection.save({ ...input, modelId: 'replacement', apiKey: 'replacement-secret' }); finish(reply());
  await assert.rejects(pending, /配置已改变/);
  assert.equal((await connection.info()).status, 'untested'); assert.equal((await connection.info()).modelId, 'replacement');
});
test('timeout aborts the request and publishes a bounded actionable error', async () => {
  const connection = new ModelConnection(async () => config, ((_url, options) => new Promise<Response>((_r, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
  })) as typeof fetch);
  // Keep the node test alive while AbortSignal's unreferenced timer is running.
  const timer = setTimeout(() => {}, 1000);
  try { await assert.rejects(connection.complete('', 'test', { timeoutMs: 20 }), /超时/); } finally { clearTimeout(timer); }
  assert.equal((await connection.info()).status, 'error');
});
