import { _electron as electron, chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const temp = await mkdtemp(join(tmpdir(), 'gamepilot-merge-ui-'));
let requests = 0, scenario = 'normal';
const mock = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); requests++;
  if (scenario === 'stall') return;
  if (scenario === '401') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'denied: merge-test-secret' } })); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'merge-test', object: 'chat.completion.chunk', model: 'mock-merge', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (input.messages.some(m => m.role === 'tool')) { send({ content: '模拟动作完成，游戏目标未验证。' }); send({}, 'stop'); }
  else {
    assert.ok(input.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
    send({ content: '读取截图，调用模拟工具。' });
    send({ tool_calls: [{ index: 0, id: 'merge-call', type: 'function', function: { name: 'move_for', arguments: '{"direction":"left","durationMs":100}' } }] }); send({}, 'tool_calls');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(done => mock.listen(0, '127.0.0.1', done));
await writeFile(join(temp, 'models.json'), JSON.stringify({ providers: { volcengine: { api: 'openai-completions', apiKey: 'merge-test-secret', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: [{ id: 'mock-merge', input: ['text', 'image'] }] } } }));
const env = { ...process.env, GAMEPILOT_CONFIG: join(temp, 'models.json') };
for (const key of ['ELECTRON_RUN_AS_NODE', 'GAMEPILOT_API_KEY', 'GAMEPILOT_MODEL', 'GAMEPILOT_BASE_URL', 'GAMEPILOT_RENDERER_URL', 'GEMINI_API_KEY']) delete env[key];
let app, browser, web;
const errors = [];
try {
  app = await electron.launch({ args: ['.'], cwd: resolve('.'), env });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await expect(page.getByText('mock-merge', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const fixture = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(640 * 360 * 4, 100), { width: 640, height: 360 }).toPNG().toString('base64'));
  const imagePath = join(temp, 'fixture.png'); await writeFile(imagePath, Buffer.from(fixture, 'base64'));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imagePath);
  await page.getByRole('button', { name: /选择 PNG/ }).click();
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeEnabled(); assert.equal(requests, 0);
  await page.getByRole('button', { name: /运行一次/ }).click();
  await expect(page.locator('.run-status')).toHaveText('模拟链路通过', { timeout: 15000 });
  let snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(snapshot.summary.gameOutcome, 'unverified'); assert.equal(snapshot.summary.completedTools, 1);
  await expect(page.locator('.model-text').last()).toContainText('游戏目标未验证');
  await page.getByRole('button', { name: /展开全部/ }).click();
  await expect(page.locator('.tui-raw-json-block').filter({ hasText: 'durationMs' }).first()).toBeVisible();
  scenario = '401'; await page.getByRole('button', { name: /运行一次/ }).click();
  await expect(page.locator('.run-status')).toHaveText('运行失败');
  await expect(page.locator('.error-row').first()).toContainText('[REDACTED]');
  assert.ok(!(await page.locator('body').innerText()).includes('merge-test-secret'));
  scenario = 'stall'; await page.getByRole('button', { name: /运行一次/ }).click();
  await page.getByRole('button', { name: '■ 取消运行' }).click();
  await expect(page.locator('.run-status')).toHaveText('已取消');
  await expect(page.locator('.p4-presets')).toBeVisible();
  await page.getByRole('button', { name: /沙盒试验场/ }).click();
  await page.getByRole('button', { name: /任务控制台/ }).click();
  const beforeSandbox = requests;
  await page.getByRole('button', { name: /你是什么模型/ }).click();
  await expect(page.locator('.tui-cli-input')).toHaveValue('你是什么模型？'); assert.equal(requests, beforeSandbox);
  await page.locator('.tui-cli-btn.submit').click();
  await expect(page.locator('.run-status')).toHaveText('模拟链路通过', { timeout: 10000 });
  await expect(page.locator('.tui-assistant-text').last()).toContainText('没有调用云端模型'); assert.equal(requests, beforeSandbox);
  await page.getByRole('button', { name: /追踪 Trace/ }).click();
  await page.getByRole('combobox', { name: '模型工具模式' }).selectOption('virtual-xbox');
  await expect(page.getByRole('combobox', { name: '模型工具模式' })).toHaveValue('simulation');
  await page.getByRole('button', { name: /画面捕获/ }).click();
  await expect(page.getByText('mock-merge', { exact: true })).toBeVisible();
  assert.equal(requests, beforeSandbox);
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/merged-electron-ui.png' });
  await app.close(); app = undefined;

  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done)); const port = probe.address().port; await new Promise(done => probe.close(done));
  web = spawn(process.execPath, ['--import', 'tsx', 'server.ts', '--production'], { cwd: resolve('.'), env: { ...env, PORT: String(port) }, windowsHide: true, stdio: 'pipe' });
  let serverOutput = ''; web.stdout.on('data', x => serverOutput += x); web.stderr.on('data', x => serverOutput += x);
  const base = `http://127.0.0.1:${port}`;
  await expect.poll(async () => { try { return (await fetch(`${base}/api/gemini/status`)).ok; } catch { return false; } }, { timeout: 20000 }).toBe(true);
  assert.equal((await (await fetch(`${base}/api/gemini/status`)).json()).isOperational, false);
  browser = await chromium.launch({ channel: 'msedge', headless: true }); const wp = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  wp.on('pageerror', e => errors.push(e.message)); await wp.goto(base);
  const caps = await wp.evaluate(async () => (await window.gamepilot.getRuntimeCapabilities()).value); assert.equal(caps.realMovement, false);
  const denied = await wp.evaluate(() => window.gamepilot.startRun({ imageId: 'fake', prompt: 'move', timeoutMs: 1000, executionMode: 'virtual-xbox' })); assert.equal(denied.ok, false);
  await wp.locator('.tui-cli-input').fill('走到蓝色目标位置之后再走到红色目标位置'); await wp.locator('.tui-cli-btn.submit').click();
  await expect(wp.locator('.run-status')).toHaveText('模拟链路通过', { timeout: 30000 });
  snapshot = await wp.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(snapshot.summary.simulated, true); assert.equal(snapshot.summary.gameOutcome, 'unverified'); assert.equal(snapshot.summary.verification, undefined);
  assert.equal(snapshot.input.evidence, undefined);
  await wp.locator('.tui-cli-input').fill('走到黄色目标位置'); await wp.locator('.tui-cli-btn.submit').click();
  await expect(wp.locator('.run-status')).toHaveText('运行中'); await wp.getByRole('button', { name: /终止/ }).click();
  await expect(wp.locator('.run-status')).toHaveText('已取消');
  await wp.screenshot({ path: 'artifacts/merged-web-ui.png' });
  assert.deepEqual(errors, []);
  console.log('Merge UI passed: Electron IPC/image/tool/error/cancel/P4; isolated offline sandbox; production Web route/multi-target/cancel; no real gamepad input.');
} finally {
  if (app) await app.close(); if (browser) await browser.close(); if (web) web.kill();
  mock.closeAllConnections(); await new Promise(done => mock.close(done)); await rm(temp, { recursive: true, force: true });
}
