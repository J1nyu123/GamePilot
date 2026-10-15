import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const secret = 'model-api-ui-secret-NEVER-PUBLIC';
const temp = await mkdtemp(join(tmpdir(), 'gamepilot-api-ui-'));
let requests = 0, scenario = 'normal', probeImage = '', lastModel = '';
const mock = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests++; lastModel = body.model;
  assert.equal(req.headers.authorization, `Bearer ${secret}`);
  if (scenario === 'stall') return;
  if (scenario === '401') { res.writeHead(401); res.end(JSON.stringify({ error: { message: secret } })); return; }
  if (body.stream === false) {
    let content = 'OK';
    else { probeImage = body.messages[0].content?.[1]?.image_url?.url || ''; assert.equal(body.tools, undefined); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] })); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'api-test', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (body.messages.some(m => m.role === 'tool')) { send({ content: '新配置模型已完成模拟工具调用。' }); send({}, 'stop'); }
  else { assert.ok(body.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'))); send({ tool_calls: [{ index: 0, id: 'api-tool', type: 'function', function: { name: 'gamepad_set_stick', arguments: '{"stick":"left","x":-0.5,"y":0,"duration_ms":100}' } }] }); send({}, 'tool_calls'); }
  res.end('data: [DONE]\n\n');
});
await new Promise(done => mock.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`;
const env = { ...process.env, GAMEPILOT_CONFIG: join(temp, 'missing.json') };
for (const key of Object.keys(env)) if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('GAMEPILOT_WEB_') || ['GAMEPILOT_API_KEY', 'GAMEPILOT_MODEL', 'GAMEPILOT_BASE_URL', 'GAMEPILOT_PROVIDER', 'GAMEPILOT_RENDERER_URL', 'GEMINI_API_KEY'].includes(key)) delete env[key];
let app;
const errors = [];
async function configure(page, model) {
  await page.getByRole('button', { name: '模型 API', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型 API 设置' }); await expect(dialog).toBeVisible();
  await dialog.getByLabel('API 服务名称').fill('fixture'); await dialog.getByLabel('API Base URL').fill(baseUrl);
  await dialog.getByLabel('API 模型 ID').fill(model); await dialog.getByLabel('API Key', { exact: true }).fill(secret);
  const before = requests; await dialog.getByRole('button', { name: '保存并使用' }).click();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue(''); assert.equal(requests, before);
  await dialog.getByRole('button', { name: '测试当前连接' }).click();
  await expect(dialog.getByRole('status')).toContainText('API 调用成功', { timeout: 20000 });
  assert.equal(lastModel, model); assert.ok(probeImage.startsWith('data:image/png;base64,'));
  const info = await page.evaluate(async () => (await window.gamepilot.getModelConnection()).value);
  assert.equal(info.status, 'connected'); assert.ok(!JSON.stringify(info).includes(secret)); assert.equal(info.apiKey, undefined);
  assert.ok(!(await dialog.innerText()).includes(secret)); return dialog;
}
try {
  await mkdir('artifacts', { recursive: true });
  app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  const dialog = await configure(page, 'desktop-api-fixture');
  assert.equal(await app.evaluate(({ nativeImage }, dataUrl) => nativeImage.createFromDataURL(dataUrl).isEmpty(), probeImage), false);
  await page.screenshot({ path: 'artifacts/model-api-settings-desktop.png' });
  await dialog.getByRole('button', { name: '关闭模型 API 设置' }).click();
  const fixture = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(640 * 360 * 4, 100), { width: 640, height: 360 }).toPNG().toString('base64'));
  const imagePath = join(temp, 'image.png'); await writeFile(imagePath, Buffer.from(fixture, 'base64'));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imagePath);
  await page.getByRole('button', { name: /选择 PNG/ }).click(); await page.getByRole('button', { name: /运行一次/ }).click();
  await expect(page.locator('.run-status')).toHaveText('模拟链路通过', { timeout: 15000 }); assert.equal(lastModel, 'desktop-api-fixture');
  const snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  for (const name of ['manifest.json', 'events.jsonl', 'summary.json']) assert.ok(!(await readFile(resolve('runs', snapshot.runId, name), 'utf8')).includes(secret));
  scenario = '401'; await page.getByRole('button', { name: /运行一次/ }).click();
  await expect(page.locator('.run-status')).toHaveText('运行失败');
  await expect(page.locator('.error-row').first()).toContainText('[REDACTED]'); assert.ok(!(await page.locator('body').innerText()).includes(secret));
  scenario = 'stall'; await page.getByRole('button', { name: /运行一次/ }).click();
  await expect(page.getByRole('button', { name: '模型 API', exact: true })).toBeDisabled();
  const blocked = await page.evaluate(input => window.gamepilot.saveModelConnection(input), { provider: 'other', baseUrl, modelId: 'other', apiKey: secret, supportsImages: true }); assert.equal(blocked.ok, false);
  await page.getByRole('button', { name: '■ 取消运行' }).click(); await expect(page.locator('.run-status')).toHaveText('已取消'); scenario = 'normal';
  await page.getByRole('button', { name: '模型 API', exact: true }).click();
  const textDialog = page.getByRole('dialog'); await textDialog.getByLabel('模型支持图片输入').uncheck();
  await textDialog.getByRole('button', { name: '保存并使用' }).click();
  await textDialog.getByRole('button', { name: '测试当前连接' }).click(); await expect(textDialog.getByRole('status')).toContainText('API 调用成功');
  assert.equal(probeImage, ''); await textDialog.getByRole('button', { name: '关闭模型 API 设置' }).click();
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  const noVision = await page.evaluate(imageId => window.gamepilot.startRun({ imageId, prompt: 'test', timeoutMs: 1000, executionMode: 'simulation' }), snapshot.imageId);
  assert.equal(noVision.ok, false); assert.ok(noVision.error.includes('图片输入'));
  assert.ok(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes(secret));
  await app.close(); app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  const resetPage = await app.firstWindow(); const restarted = await resetPage.evaluate(async () => (await window.gamepilot.getModelConnection()).value);
  assert.equal(restarted.hasApiKey, false); await app.close(); app = undefined;

  assert.deepEqual(errors, []);
  console.log('Model API UI passed: desktop save-test-use, valid image probe, Runtime SSE, busy guard, restart/reset, HTTP401, no key in public metadata/localStorage/run logs. ZERO physical controller actions.');
} finally {
  if (app) await app.close();
  mock.closeAllConnections(); await new Promise(done => mock.close(done)); await rm(temp, { recursive: true, force: true });
}
