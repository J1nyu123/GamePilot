import { _electron as electron, expect } from '@playwright/test';
import { createInterface } from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { sendGameKeys } from '../src/input/windows-keyboard.ts';
import { NativeWindows } from '../src/capture/native-window.ts';

const gamepadMode = process.argv.includes('--gamepad');
const mode = gamepadMode ? 'gamepad' : 'keyboard';
let padSamples = [];
const probe = gamepadMode ? spawn(resolve('.venv/Scripts/python.exe'), ['-u', resolve('tests/xinput-probe.py')], { windowsHide: true, stdio: 'pipe' }) : undefined;
if (probe) { probe.stderr.resume(); createInterface({ input: probe.stdout }).on('line', line => padSamples.push(...JSON.parse(line))); }
const temp = await mkdtemp(join(tmpdir(), 'gamepilot-loop-'));
let requests = 0, imagesAfter = [], toolReceipt = false;
const server = createServer(async (req, res) => {
  let text = ''; for await (const c of req) text += c;
  const body = JSON.parse(text); requests++;
  const receipts = body.messages.filter(m => m.role === 'tool');
  const imageUrls = body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'image_url').map(c => c.image_url.url) : []);
  if (receipts.length >= 2) { imagesAfter = imageUrls; toolReceipt = JSON.stringify(receipts).includes('after_action'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'loop', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
  send({ role: 'assistant' });
  if (body.messages[0].content.includes('intent router')) { send({ content: JSON.stringify({ intent: 'act', confidence: 0.99, reply: '', task: '走到前面柱子处' }) }); send({}, 'stop'); }
  else if (receipts.length >= 2) { send({ content: '已执行向前短步并收到动作后截图。闭环完成；目标是否到达仍需判断。' }); send({}, 'stop'); }
  else {
    const name = receipts.length ? (gamepadMode ? 'gamepad_action' : 'keyboard_action') : 'capture_game';
    send({ content: receipts.length ? '计划向前短步移动，再对比新截图。' : '先观察当前游戏画面。' });
    send({ tool_calls: [{ index: 0, id: `tool-${requests}`, type: 'function', function: { name, arguments: receipts.length ? JSON.stringify(gamepadMode ? { buttons: ['A'], left_y: 0.6, duration_ms: 400 } : { keys: ['W'], duration_ms: 200 }) : '{}' } }] }); send({}, 'tool_calls');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(join(temp, 'target'));
await writeFile(join(temp, 'target/package.json'), JSON.stringify({ main: 'index.cjs' }));
await writeFile(join(temp, 'target/index.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:480,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(join(temp, 'target/page.html'))});});app.on('window-all-closed',()=>app.quit());`);
await writeFile(join(temp, 'target/page.html'), `<title>GamePilot keyboard acceptance fixture</title><canvas id="c" width="600" height="400"></canvas><script>window.down=0;window.up=0;let y=320,n=0;onkeydown=e=>{if(e.code==='KeyW'){down++;y-=30}};onkeyup=e=>{if(e.code==='KeyW')up++};setInterval(()=>{let g=c.getContext('2d');g.fillStyle='#223344';g.fillRect(0,0,600,400);g.fillStyle='gold';g.fillRect(280,20,40,100);g.fillStyle='cyan';g.fillRect(280,y,30,30);g.fillStyle='white';g.fillRect(n++%500,380,5,5)},50)</script>`);
const config = join(temp, 'models.json');
await writeFile(config, JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-key', models: [{ id: 'fixture-vision', input: ['text', 'image'] }] } } }));
const env = { ...process.env, GAMEPILOT_CONFIG: config, GAMEPILOT_PROVIDER: 'fixture', GAMEPILOT_MODEL: 'fixture-vision' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'GAMEPILOT_BASE_URL', 'GAMEPILOT_API_KEY', 'GAMEPILOT_RENDERER_URL']) delete env[key];
let target, app;
try {
  target = await electron.launch({ args: [join(temp, 'target')], env }); const targetPage = await target.firstWindow();
  const sourceId = await target.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0].getNativeWindowHandle(); return `window:${b.readBigUInt64LE()}:0`; });
  app = await electron.launch({ args: ['.'], cwd: resolve('.'), env }); const page = await app.firstWindow();
  await expect(page.getByText('fixture-vision', { exact: true })).toBeVisible();
  await page.getByLabel('执行模式', { exact: true }).selectOption(mode);
  if (gamepadMode) { const connection = await page.evaluate(() => window.gamepilot.connectGamepad()); assert.equal(connection.ok, true, connection.error); }
  const result = await page.evaluate(async ({sourceId, mode}) => {
    const api = window.gamepilot;
    const preview = await api.startPreview(sourceId); if (!preview.ok) return preview;
    return api.sendMessage({ prompt: '走到前面柱子处', timeoutMs: 60000, executionMode: mode });
  }, { sourceId, mode });
  assert.equal(result.ok, true, result.error);
  let snapshot;
  await expect.poll(async () => { snapshot = (await page.evaluate(() => window.gamepilot.getSnapshot())).value; return snapshot && !['running', 'canceling'].includes(snapshot.status); }, { timeout: 60000 }).toBe(true);
  assert.equal(snapshot.status, 'control_passed', JSON.stringify(snapshot.summary));
  const keys = await targetPage.evaluate(() => ({ down: window.down, up: window.up }));
  if (gamepadMode) assert.ok(padSamples.some(s => (s.buttons & 0x1000) && s.ly > 19000), 'XInput observes the real model-requested action');
  else { assert.ok(keys.down > 0); assert.equal(keys.up, 1); }
  assert.equal(requests, 4); assert.equal(toolReceipt, true); assert.ok(imagesAfter.length >= 3);
  assert.notEqual(imagesAfter.at(-1), imagesAfter.at(-2));
  assert.equal(snapshot.summary.simulated, false); assert.equal(snapshot.summary.gameOutcome, 'unverified');
  assert.equal(snapshot.observations.length, 3);
  const directory = resolve('runs', result.value.runId);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.inputBackend, 'intent-routed');
  assert.equal(snapshot.summary.intent, 'act');
  for (const frame of snapshot.observations) assert.ok((await readFile(join(directory, frame.relativePath))).length > 0);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: `artifacts/${mode}-loop-desktop.png` });
  const native = new NativeWindows(resolve('dist/capture/native-window.ps1'));
  let cancelReleased = false, unfocusedInputBlocked = false;
  if (!gamepadMode) try {
    const info = await native.info(sourceId);
    await native.focus(sourceId, info.identity);
    const controller = new AbortController();
    const pending = sendGameKeys(resolve('dist/capture/windows-keyboard.ps1'), sourceId, info.identity, ['W'], 1000, controller.signal);
    const canceled = assert.rejects(pending, /abort/i);
    await expect.poll(() => targetPage.evaluate(() => window.down), { timeout: 10000, intervals: [20] }).toBeGreaterThan(keys.down);
    controller.abort(); await canceled;
    await expect.poll(() => targetPage.evaluate(() => window.up)).toBe(2); cancelReleased = true;
    await native.focus(sourceId, info.identity);
    await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await assert.rejects(sendGameKeys(resolve('dist/capture/windows-keyboard.ps1'), sourceId, info.identity, ['W'], 1000, new AbortController().signal), /focus lost/);
    const down = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class KeyState {[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);}'; [Console]::Write(([KeyState]::GetAsyncKeyState(87) -band 32768))`], { windowsHide: true, encoding: 'utf8' });
    assert.equal(down.trim(), '0'); unfocusedInputBlocked = true;
  } finally { native.close(); }
  await writeFile(`artifacts/${mode}-loop-check.json`, JSON.stringify({ passed: true, runId: result.value.runId, requests, keys, cancelReleased, unfocusedInputBlocked, imagesReturned: imagesAfter.length, status: snapshot.status, model: 'scripted local fixture, not live VLM', input: gamepadMode ? 'ViGEm Xbox360 observed through XInputGetState' : 'real Win32 SendInput into isolated test window' }, null, 2));
  console.log(`PASS: instruction → native screenshot → Pi model tools → real ${mode} input → fresh screenshot → model feedback → persisted trace.`);
} finally {
  probe?.kill(); await app?.close(); await target?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
