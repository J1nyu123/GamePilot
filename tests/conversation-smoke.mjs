import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const temp = await mkdtemp(join(tmpdir(), 'gamepilot-chat-'));
let expectedImage = '';
let scenario = 'chat', routingRequests = 0, taskRequests = 0, historySeen = false;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const router = body.messages[0].content.includes('intent router');
  const hasImages = body.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));
  let content, tool;
  if (router) {
    routingRequests++; assert.equal(hasImages, false); assert.ok(!body.tools?.length);
    const input = JSON.stringify(body.messages);
    if (scenario === 'image_question') {
      assert.match(input, /你能看到我放入的图片吗/);
      assert.match(input, /fixture.png/);
      assert.match(input, /supportsImages/);
      assert.match(body.messages[0].content, /INCLUDING questions asking whether you can see/);
      assert.match(input, /import/);
    }
    if (scenario === 'followup') { assert.match(input, /小明/); historySeen = true; }
    if (scenario.startsWith('capabilities')) {
      const expected = scenario.endsWith('keyboard') ? ['capture_game', 'keyboard_action'] : ['gamepad_press_button', 'gamepad_release_button', 'gamepad_set_stick', 'gamepad_set_trigger', 'gamepad_reset_all', 'gamepad_get_state'];
      for (const name of expected) assert.ok(input.includes(name));
      assert.ok(input.includes('toolsCallableInCurrentStage'));
      content = JSON.stringify({ intent: 'chat', confidence: 1, reply: expected.join('、'), task: '' });
    } else content = scenario === 'malformed'  ? 'oops' : JSON.stringify({
      intent: scenario === 'image_question' ? 'observe' : ['observe', 'act'].includes(scenario) ? scenario : 'chat', confidence: 0.99,
      reply: scenario === 'followup' ? '你叫小明。' : '你好，小明。', task: scenario === 'act' ? '向左短步移动' : '描述当前画面',
    });
  } else {
    taskRequests++; assert.equal(hasImages, true);
    if (scenario === 'image_question') {
      assert.ok(!body.tools?.length);
      const images = body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'image_url') : []);
      assert.equal(images.length, 1); assert.equal(images[0].image_url.url, expectedImage);
      content = '可以，我已收到载入的图片，图中是测试色块。';
    }
    else if (scenario === 'observe') { assert.ok(!body.tools?.length); content = '画面是测试色块，没有执行动作。'; }
    else if (body.messages.some(m => m.role === 'tool')) content = '模拟动作已完成，游戏效果未经验证。';
    else tool = { name: 'gamepad_set_stick', arguments: '{"stick":"left","x":-0.5,"y":0,"duration_ms":20}' };
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
  send({ role: 'assistant' });
  if (tool) { send({ tool_calls: [{ index: 0, id: 'action', type: 'function', function: tool }] }); send({}, 'tool_calls'); }
  else { send({ content }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const config = join(temp, 'models.json');
await writeFile(config, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-key', models: [{ id: 'fixture-vision', input: ['text', 'image'] }] } } }));
const env = { ...process.env, GAMEPILOT_CONFIG: config, GAMEPILOT_PROVIDER: 'fixture', GAMEPILOT_MODEL: 'fixture-vision' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'GAMEPILOT_BASE_URL', 'GAMEPILOT_API_KEY', 'GAMEPILOT_RENDERER_URL']) delete env[key];
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); const page = await app.firstWindow();
  await expect(page.getByText('fixture-vision', { exact: true })).toBeVisible();
  // Exercise normal chat through the real UI, with neither a screenshot nor a window selected.
  await page.getByRole('button', { name: /任务控制台/ }).click();
  await page.locator('.tui-cli-input').fill('你好，我叫小明');
  await expect(page.locator('.tui-cli-btn.submit')).toBeEnabled();
  await page.locator('.tui-cli-input').press('Enter');
  let snapshot;
  const settled = async () => {
    await expect.poll(async () => { snapshot = (await page.evaluate(() => window.gamepilot.getSnapshot())).value; return snapshot && !['running', 'canceling'].includes(snapshot.status); }, { timeout: 15000 }).toBe(true);
    return snapshot;
  };
  await settled(); assert.equal(snapshot.summary.intent, 'chat'); assert.equal(snapshot.observations.length, 0); assert.equal(taskRequests, 0);
  const manifest = JSON.parse(await readFile(resolve('runs', snapshot.runId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.input, null);
  const send = async (prompt, next, executionMode = 'simulation') => {
    scenario = next;
    const response = await page.evaluate(({ prompt, executionMode }) => window.gamepilot.sendMessage({ prompt, timeoutMs: 15000, executionMode }), { prompt, executionMode });
    assert.equal(response.ok, true, response.error); await settled(); return snapshot;
  };
  await send('你能使用哪些工具和MCP', 'capabilities-keyboard', 'keyboard');
  assert.equal(snapshot.summary.intent, 'chat'); assert.match(snapshot.summary.finalText, /keyboard_action/); assert.equal(taskRequests, 0);
  await send('模拟模式有哪些工具', 'capabilities-simulation');
  assert.match(snapshot.summary.finalText, /gamepad_set_stick/); assert.equal(taskRequests, 0);
  await send('我叫什么名字？', 'followup'); assert.equal(historySeen, true); assert.equal(snapshot.summary.finalText, '你叫小明。');
  await send('看看当前画面', 'observe'); assert.equal(snapshot.status, 'blocked'); assert.equal(taskRequests, 0);
  await send('那个呢？', 'malformed'); assert.equal(snapshot.summary.intent, 'clarify'); assert.equal(taskRequests, 0);
  const imagePath = join(temp, 'fixture.png');
  const bytes = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 100), { width: 64, height: 64 }).toPNG().toString('base64'));
  expectedImage = `data:image/png;base64,${bytes}`;
  await writeFile(imagePath, Buffer.from(bytes, 'base64'));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, imagePath);
  assert.equal((await page.evaluate(() => window.gamepilot.importImage())).ok, true);
  await send('你能看到我放入的图片吗', 'image_question', 'keyboard');
  assert.equal(snapshot.summary.intent, 'observe'); assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.summary.completedTools, 0); assert.equal(snapshot.input.name, 'fixture.png');
  assert.match(snapshot.summary.finalText, /已收到载入的图片/);
  await send('描述当前画面，不操作', 'observe'); assert.equal(snapshot.summary.intent, 'observe'); assert.equal(snapshot.status, 'completed'); assert.equal(snapshot.summary.completedTools, 0); assert.equal(snapshot.observations.length, 1);
  await send('向左走一下', 'act'); assert.equal(snapshot.status, 'protocol_passed'); assert.equal(snapshot.summary.intent, 'act');
  const actionsBefore = taskRequests;
  await send('谢谢', 'chat'); assert.equal(taskRequests, actionsBefore); assert.equal(snapshot.observations.length, 0);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/conversation-check.json', JSON.stringify({ passed: true, routingRequests, taskRequests, historySeen,
    cases: ['chat without screenshot', 'bounded conversation context', 'missing image blocks only game task', 'malformed intent clarifies', 'observe has no action tools', 'loaded-image visibility question sends exact image bytes in keyboard mode', 'act enters tool loop', 'thanks never replays prior action'], model: 'scripted local fixture; routing accuracy of live models not measured' }, null, 2));
  console.log('PASS: text-only chat/history, intent gates, read-only observation, action dispatch and no replay.');
} finally {
  await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true });
}
