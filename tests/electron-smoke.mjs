import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const temp = await mkdtemp(join(tmpdir(), 'gamepilot-ui-'));
let scenario = 'normal', requests = 0;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); requests++;
  if (scenario === 'stall') return;
  if (scenario === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Test authentication failure: test-ui-secret' } })); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'ui-test', object: 'chat.completion.chunk', created: 1, model: 'mock-vision', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (scenario === 'empty') { send({}, 'stop'); }
  else if (input.messages.some(m => m.role === 'tool')) {
    send({ content: '模拟向左移动已执行。游戏效果未经验证。' }); send({}, 'stop');
  } else {
    assert.ok(input.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
    const text = '已接收到游戏截图。接下来调用模拟技能向左移动。\n';
    // Long stream exercises scroll behavior and preserves incremental model feedback.
    send({ content: scenario === 'long' ? text.repeat(120) : text });
    if (scenario === 'long') await new Promise(r => setTimeout(r, 500));
    send({ tool_calls: [{ index: 0, id: 'ui-call', type: 'function', function: { name: 'move_for', arguments: JSON.stringify({ direction: scenario === 'invalid' ? 'invalid' : 'left', durationMs: scenario === 'cancel-tool' ? 2000 : 200 }) } }] });
    send({}, 'tool_calls');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const configPath = join(temp, 'models.json');
await writeFile(configPath, JSON.stringify({ providers: { volcengine: {
  api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: '${ARK_API_KEY}', models: [{ id: 'mock-vision', input: ['text', 'image'] }],
} } }));
const env = { ...process.env, GAMEPILOT_CONFIG: configPath, ARK_API_KEY: 'test-ui-secret' };
delete env.ELECTRON_RUN_AS_NODE; delete env.GAMEPILOT_API_KEY; delete env.GAMEPILOT_MODEL; delete env.GAMEPILOT_BASE_URL; delete env.GAMEPILOT_RENDERER_URL;
const errors = [];
const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByText('mock-vision', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const imagePath = process.env.GAMEPILOT_TEST_IMAGE || join(temp, 'fixture.png');
  if (!process.env.GAMEPILOT_TEST_IMAGE) {
    const fixture = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(640 * 360 * 4, 100), { width: 640, height: 360 }).toPNG().toString('base64'));
    await writeFile(imagePath, Buffer.from(fixture, 'base64'));
  }
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imagePath);
  await page.getByRole('button', { name: /选择 PNG/ }).click();
  await expect(page.getByAltText('实际发送给模型的游戏截图')).toBeVisible();
  assert.equal(requests, 0); // Selecting an image never uploads it.
  const run = async () => { await page.getByRole('button', { name: /运行一次/ }).click(); };
  await run();
  await expect(page.getByRole('button', { name: '替换图片' })).toBeDisabled();
  await expect(page.locator('.run-status')).toHaveText('模拟链路通过', { timeout: 15000 });
  await expect(page.getByText('CYCLE 02')).toBeVisible();
  await page.locator('.tool-toggle').click();
  await expect(page.locator('.tool-item > .json-block')).toContainText('durationMs');
  let snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  const dir = resolve('runs', snapshot.runId);
  const disk = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(x => JSON.parse(x));
  assert.deepEqual(disk, snapshot.events);
  assert.equal(snapshot.summary.completedTools, 1);
  const denied = await page.evaluate(async () => window.gamepilot.openLogs('../../arbitrary-path'));
  assert.equal(denied.ok, false);
  await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });
  await page.getByRole('button', { name: /打开日志目录/ }).click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/debug-ui-desktop.png' });
  // Importing the next input does not replace the screenshot tied to existing records.
  await page.getByRole('button', { name: '替换图片' }).click();
  await expect(page.getByRole('button', { name: '记录对应的输入' })).toBeVisible();
  await page.getByRole('button', { name: '记录对应的输入' }).click();
  await expect(page.locator('.input-reference')).toContainText(snapshot.imageId.slice(0, 8));
  await page.getByRole('button', { name: '待运行图片' }).click();
  scenario = '401'; await run();
  await expect(page.locator('.run-status')).toHaveText('运行失败');
  await expect(page.locator('.error-row').first()).toContainText('[REDACTED]');
  assert.ok(!(await page.locator('body').innerText()).includes('test-ui-secret'));
  scenario = 'empty'; await run();
  await expect(page.locator('.run-status')).toHaveText('链路未完成');
  await expect(page.locator('.model-warning')).toContainText('没有返回可展示文本');
  await expect(page.locator('.response-diagnostics')).toContainText('正文 0 字符');
  scenario = 'invalid'; await run();
  await expect(page.locator('.run-status')).toHaveText('运行失败');
  snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(snapshot.summary.completedTools, 0);
  scenario = 'stall'; await run();
  await expect(page.getByRole('button', { name: '■ 取消运行' })).toBeEnabled();
  await page.getByRole('button', { name: '■ 取消运行' }).click();
  await expect(page.locator('.run-status')).toHaveText('已取消');
  scenario = 'cancel-tool'; await run();
  await expect(page.locator('.tool-toggle')).toBeVisible();
  await page.getByRole('button', { name: '■ 取消运行' }).click();
  await expect(page.locator('.run-status')).toHaveText('已取消');
  snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(snapshot.summary.completedTools, 0);
  scenario = 'long'; await run();
  await expect(page.locator('.model-text')).toBeVisible();
  await page.locator('.transcript').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '↓ 有新事件' })).toBeVisible();
  await expect(page.locator('.run-status')).toHaveText('模拟链路通过');
  const scrollTop = await page.locator('.transcript').evaluate(el => el.scrollTop);
  assert.ok(scrollTop < 50);
  await page.getByRole('button', { name: '↓ 有新事件' }).click();
  const separator = page.getByRole('separator', { name: '调整左右宽度' });
  const initialWidth = await page.locator('.preview-column').evaluate(el => el.getBoundingClientRect().width);
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x - 80, handle.y + handle.height / 2); await page.mouse.up();
  assert.ok(await page.locator('.preview-column').evaluate(el => el.getBoundingClientRect().width) < initialWidth - 30);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(950, 900));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 900));
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/debug-ui-narrow.png', fullPage: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
  // Missing config reference prevents runs without exposing any credential.
  await app.evaluate(() => { delete process.env.ARK_API_KEY; });
  await page.getByRole('button', { name: /刷新配置/ }).click();
  await expect(page.locator('.config-message')).toContainText('ARK_API_KEY');
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  await app.evaluate(() => { process.env.ARK_API_KEY = 'test-ui-secret'; });
  await page.getByRole('button', { name: /刷新配置/ }).click();
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeEnabled();
  scenario = 'stall'; await run();
  await expect(page.getByRole('button', { name: '■ 取消运行' })).toBeEnabled();
  const closeSnapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await new Promise(r => setTimeout(r, 600));
  const closeSummary = JSON.parse(await readFile(resolve('runs', closeSnapshot.runId, 'summary.json'), 'utf8'));
  assert.equal(closeSummary.status, 'canceled');
  assert.deepEqual(errors, []);
  console.log(`Electron UI passed: import, complete stream, JSON, trace parity, 401 redaction, invalid args, cancel model/tool, long scroll, narrow layout, missing key. HTTP requests: ${requests}`);
} finally {
  await app.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
