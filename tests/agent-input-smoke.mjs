import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root = resolve('.'), temp = await mkdtemp(join(tmpdir(), 'gamepilot-p2c-ui-'));
const stateRoot = join(temp, 'state');
await mkdir(join(stateRoot, 'dist/capture'), { recursive: true });
for (const asset of ['capture.html', 'native-window.ps1']) await copyFile(join(root, 'dist/capture', asset), join(stateRoot, 'dist/capture', asset));
const env = { ...process.env, GAMEPILOT_TEST_ROOT: root, GAMEPILOT_TEST_STATE_ROOT: stateRoot, GAMEPILOT_TEST_FOCUS: 'ready' }; delete env.ELECTRON_RUN_AS_NODE; delete env.GAMEPILOT_RENDERER_URL;
let trackingRequests = 0;
let scenario = 'normal', requests = 0, sentImage = '', toolResults = [], verifierRequests = 0, lastPlannerImages = [];
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); requests++;
  const verifier = input.messages[0].content.includes('independent visual verifier');
  const locator = input.messages[0].content.includes('P3 target locator');
  if (locator) { trackingRequests++; assert.ok(!input.tools?.length); }
  if (verifier) { verifierRequests++; assert.ok(!input.tools?.length); }
  else lastPlannerImages = input.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'image_url').map(c => c.image_url.url) : []);
  sentImage = input.messages.find(m => m.role === 'user').content.find(c => c.type === 'image_url').image_url.url;
  if (scenario === 'approach-stall' && locator || scenario === 'stall' || (scenario === 'verified-verifier-stall' && verifier)) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'p2c-ui', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  const result = input.messages.find(m => m.role === 'tool');
  if (locator) {
    const lost = scenario === 'approach-lost' && trackingRequests > 1;
    const box = trackingRequests === 1 ? [.15,.3,.1,.2] : trackingRequests === 2 ? [.4,.3,.2,.2] : [.375,.3,.25,.3];
    send({ content: JSON.stringify({ mode: 'gameplay', visible: !lost, sameTarget: !lost, sceneStable: true, pathClear: true, coordinateSystem: 'ltrb-1000', bounds1000: lost ? null : { left: Math.round(box[0]*1000), top: Math.round(box[1]*1000), right: Math.round((box[0]+box[2])*1000), bottom: Math.round((box[1]+box[3])*1000) }, interaction: { status: 'present', text: 'A 调查（测试）' }, confidence: .95, facts: ['test target fixture'] }) }); send({}, 'stop');
  } else if (verifier) {
    const verdict = scenario === 'verified-fail' ? 'failed' : scenario === 'verified-inconclusive' ? 'inconclusive' : 'passed';
    send({ content: JSON.stringify({ verdict, summary: `本地测试验证 ${verdict}`, facts: ['测试窗口可见帧计数'] }) }); send({}, 'stop');
  } else if (result) { toolResults.push(result.content); send({ content: scenario.startsWith('verified') ? 'Planner 声称完成，但最终结果以独立验证为准。' : '输入执行及释放已确认。游戏目标未经验证。' }); send({}, 'stop'); }
  else if (scenario.startsWith('approach-')) {
    const parameters = input.tools[0].function.parameters.properties;
    const args = { targetId: parameters.targetId.const ?? parameters.targetId.enum?.[0], observationId: parameters.observationId.const ?? parameters.observationId.enum?.[0] };
    assert.ok(args.targetId && args.observationId);
    send({ tool_calls: [{ index: 0, id: 'p3-tool', type: 'function', function: { name: 'approach_target', arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls');
  } else {
    send({ content: '已收到新截图，选择短暂向左移动。' });
    send({ tool_calls: [{ index: 0, id: 'p2c-tool', type: 'function', function: { name: scenario === 'verified-wait' ? 'wait_for_state' : 'move_for', arguments: scenario === 'verified-wait' ? '{"timeoutMs":2000}' : scenario === 'verified-long' ? '{"direction":"left","durationMs":1500}' : '{"direction":"left","durationMs":200}' } }] }); send({}, 'tool_calls');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await writeFile(join(temp, 'models.json'), JSON.stringify({ providers: { volcengine: { api: 'openai-completions', apiKey: 'p2c-local-test', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'mock', input: ['text', 'image'] }] } } }));
env.GAMEPILOT_CONFIG = join(temp, 'models.json'); delete env.GAMEPILOT_MODEL; delete env.GAMEPILOT_BASE_URL; delete env.GAMEPILOT_API_KEY;
const piRoot = resolve('../pi'), paths = JSON.parse(await readFile(join(piRoot, 'tsconfig.json'), 'utf8')).compilerOptions.paths;
await build({ entryPoints: ['tests/agent-ui-entry.ts'], outfile: join(temp, 'app/index.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [{ name: 'pi-test-source', setup(builder) { builder.onResolve({ filter: /^@earendil-works\// }, args => {
    const exact = paths[args.path]?.[0]; return { path: exact ? resolve(piRoot, exact) : resolve(piRoot, 'packages/ai/src', args.path.slice('@earendil-works/pi-ai/'.length) + '.ts') };
  }); } }],
});
await writeFile(join(temp, 'app/package.json'), JSON.stringify({ main: 'index.mjs', type: 'module' }));
await mkdir(join(temp, 'target'));
await writeFile(join(temp, 'target/package.json'), JSON.stringify({ main: 'index.cjs' }));
await writeFile(join(temp, 'target/index.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:900,height:650,backgroundColor:'#21344a'});w.loadFile(${JSON.stringify(join(temp, 'target/page.html'))});});app.on('window-all-closed',()=>app.quit());`);
await writeFile(join(temp, 'target/page.html'), '<html><head><title>Cemu P2-C 测试窗口（非游戏）</title></head><body style="background:#21344a;color:white;font:24px sans-serif"><h1>P2-C / dry backend / no controller device</h1><div id="n"></div><script>let n=0;setInterval(()=>document.getElementById("n").textContent="source frame "+n++,100)</script></body></html>');
let target, app;
try {
  target = await electron.launch({ args: [join(temp, 'target')], env, timeout: 30000 }); await target.firstWindow();
  app = await electron.launch({ args: [join(temp, 'app')], env, timeout: 30000 }); const page = await app.firstWindow();
  await expect(page.getByRole('combobox', { name: '游戏窗口' })).toContainText('Cemu P2-C', { timeout: 15000 });
  const windows = await page.evaluate(async () => (await window.gamepilot.listWindows()).value);
  await page.getByRole('combobox', { name: '游戏窗口' }).selectOption(windows.find(w => w.title.includes('Cemu P2-C')).id);
  await page.getByRole('button', { name: '开始预览' }).click();
  await expect(page.getByAltText('游戏窗口实时画面')).toBeVisible({ timeout: 15000 });
  await page.getByRole('combobox', { name: '模型工具模式' }).selectOption('virtual-xbox');
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  await page.locator('.input-debug-panel>summary').click();
  await page.getByRole('combobox', { name: '手柄服务模式' }).selectOption('virtual-xbox');
  await page.getByRole('button', { name: '连接手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('已连接', { timeout: 15000 });
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+F12')), true);
  const run = async () => {
    await app.evaluate(() => { process.env.GAMEPILOT_TEST_FOCUS = 'ready'; });
    await page.getByRole('button', { name: /运行一次/ }).click();
    await expect(page.locator('.input-summary')).toContainText('Agent 3 秒准备');
  };
  if (!process.env.GAMEPILOT_TEST_P3_ONLY) {
  await run();
  await expect(page.locator('.run-status')).toHaveText('真实输入链路通过', { timeout: 15000 });
  const snapshot = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(snapshot.summary.simulated, false); assert.equal(snapshot.summary.gameOutcome, 'unverified');
  assert.equal(snapshot.input.dataUrl, sentImage);
  assert.ok(toolResults[0].includes('"simulated":false'));
  assert.ok(toolResults[0].includes('"neutral":true'));
  const disk = JSON.parse(await readFile(join(stateRoot, 'runs', snapshot.runId, 'manifest.json'), 'utf8'));
  assert.equal(disk.input.id, snapshot.input.id); assert.equal(disk.simulated, false);
  assert.ok(snapshot.events.find(e => e.type === 'observation').sequence > snapshot.events.find(e => e.type === 'input_preparing').sequence);
  await page.locator('.tool-result details>summary').click();
  await expect(page.locator('.tool-result pre')).toContainText('receipt');
  const parity = (await readFile(join(stateRoot, 'runs', snapshot.runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(parity, snapshot.events);
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/p2c-agent-input.png' });
  await writeFile('artifacts/p2c-agent-ui-check.json', JSON.stringify({ testOnly: true, backend: 'injected Python dry-run', focus: 'controlled test dependency', physicalInputVerified: false, summary: snapshot.summary, manifest: disk, events: parity }, null, 2));
  scenario = 'stall'; await run();
  await expect.poll(() => requests).toBe(3, { timeout: 15000 });
  await page.evaluate(async () => { const state = await window.gamepilot.getSnapshot(); return window.gamepilot.cancelRun(state.value.runId); });
  await expect(page.locator('.run-status')).toHaveText('已取消', { timeout: 10000 });
  const canceled = await page.evaluate(async () => (await window.gamepilot.getInputState()).value);
  assert.equal(canceled.neutral, true);
  // Focus loss while waiting for model must terminate the whole task, not only reset a pad.
  await run(); await expect.poll(() => requests).toBe(4, { timeout: 15000 });
  await app.evaluate(() => { process.env.GAMEPILOT_TEST_FOCUS = 'lost'; });
  await expect(page.locator('.run-status')).toHaveText('已取消', { timeout: 10000 });
  await expect(page.locator('.transcript')).toContainText('游戏窗口失焦');
  await page.getByRole('combobox', { name: '模型工具模式' }).selectOption('verified-xbox');
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  // Presets fill drafts only: no implicit execution, model request or device reconnection.
  const requestsBeforePresets = requests;
  await page.locator('.acceptance-presets>summary').click();
  await page.getByRole('combobox', { name: '验收样例' }).selectOption('negative');
  await page.getByRole('button', { name: '填入指令与条件' }).click();
  await expect(page.getByRole('textbox', { name: '成功条件' })).toHaveValue('当前游戏画面清晰显示完整文字「GAMEPILOT_TEST_TARGET_7F3A」。');
  assert.equal(requests, requestsBeforePresets);
  assert.equal(await page.locator('.acceptance-presets').evaluate(el => el.open), false);
  await page.locator('.acceptance-presets>summary').click();
  await page.getByRole('combobox', { name: '验收样例' }).selectOption('move');
  await page.getByRole('button', { name: '填入指令与条件' }).click();
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  assert.equal(requests, requestsBeforePresets);
  await page.getByRole('textbox', { name: '任务指令' }).fill('依据固定成功条件选择一个游戏工具。');
  await page.getByRole('textbox', { name: '成功条件' }).fill('测试画面中存在可见的 source frame 计数');
  const reports = [];
  for (const variant of ['verified-pass', 'verified-fail', 'verified-inconclusive', 'verified-wait']) {
    scenario = variant; await run();
    assert.equal(await page.locator('.acceptance-presets select').isDisabled(), true);
    await expect(page.locator('.run-status')).toHaveText(variant === 'verified-pass' || variant === 'verified-wait' ? '目标验证通过' : '任务受阻 / 未通过验证', { timeout: 20000 });
    const state = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
    const manifest = JSON.parse(await readFile(join(stateRoot, 'runs', state.runId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 2); assert.equal(state.observations.length, 2);
    assert.equal(manifest.goal.id, state.summary.verification.goalId);
    assert.ok(state.events.find(e => e.type === 'skill_released' || e.type === 'observation_post_start').sequence < state.events.find(e => e.type === 'verification_end').sequence);
    const after = state.observations.at(-1).image;
    assert.ok(lastPlannerImages.includes(after.dataUrl));
    const bytes = await readFile(join(stateRoot, 'runs', state.runId, manifest.observations.at(-1).path));
    assert.equal(bytes.toString('base64'), after.dataUrl.split(',')[1]);
    const log = await readFile(join(stateRoot, 'runs', state.runId, 'events.jsonl'), 'utf8');
    assert.ok(!log.includes('data:image/')); assert.deepEqual(log.trim().split('\n').map(line => JSON.parse(line)), state.events);
    if (variant === 'verified-wait') { assert.equal(state.summary.metrics.moves, 0); assert.equal(state.summary.metrics.waits, 1); }
    reports.push({ scenario: variant, summary: state.summary, manifest });
    if (variant === 'verified-pass') {
      await page.getByRole('combobox', { name: '运行关键截图' }).selectOption(after.id);
      assert.equal(await page.getByAltText('实际发送给模型的游戏截图').getAttribute('src'), after.dataUrl);
      await page.getByRole('button', { name: '记录对应的输入' }).click();
      assert.equal(await page.getByAltText('实际发送给模型的游戏截图').getAttribute('src'), state.input.dataUrl);
      await page.screenshot({ path: 'artifacts/p2d-goal-verification.png' });
      const sample = join(root, 'artifacts/p2d-sample-trace', state.runId);
      await cp(join(stateRoot, 'runs', state.runId), sample, { recursive: true });
      await writeFile(join(sample, 'test-context.json'), JSON.stringify({ testOnly: true, backend: 'Python dry-run', model: 'local mock SSE', focus: 'controlled', physicalInputVerified: false }, null, 2));
    }
  }
  scenario = 'verified-verifier-stall'; const previousChecks = verifierRequests; await run();
  await expect.poll(() => verifierRequests, { timeout: 15000 }).toBe(previousChecks + 1);
  await page.evaluate(async () => { const state = await window.gamepilot.getSnapshot(); return window.gamepilot.cancelRun(state.value.runId); });
  await expect(page.locator('.run-status')).toHaveText('已取消', { timeout: 10000 });
  const stopped = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(stopped.summary.gameOutcome, 'unverified');
  assert.equal((await page.evaluate(async () => (await window.gamepilot.getInputState()).value)).neutral, true);
  reports.push({ scenario, summary: stopped.summary });
  await writeFile('artifacts/p2d-agent-ui-check.json', JSON.stringify({ testOnly: true, backend: 'injected Python dry-run', focus: 'controlled dependency', physicalInputVerified: false, reports }, null, 2));
  // P4 lifecycle integration uses the same run, independent Pi segments and shared budgets.
  scenario = 'stall'; const beforePauseRequests = requests; await run();
  await expect.poll(() => requests, { timeout: 15000 }).toBe(beforePauseRequests + 1);
  const pauseRunId = (await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value)).runId;
  await page.getByRole('button', { name: '暂停任务', exact: true }).click();
  await expect(page.locator('.run-status')).toHaveText('已暂停');
  assert.equal((await page.evaluate(async () => (await window.gamepilot.getInputState()).value)).neutral, true);
  scenario = 'verified-pass'; await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  await expect(page.locator('.run-status')).toHaveText('目标验证通过', { timeout: 20000 });
  const resumed = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(resumed.runId, pauseRunId); assert.equal(resumed.observations.length, 3);
  assert.equal(resumed.summary.verification.evidenceIds[0], resumed.observations[0].image.id);
  assert.ok(resumed.events.some(e => e.type === 'task_paused'));
  scenario = 'verified-long'; await run();
  for (let i = 0; i < 2; i++) {
    await expect.poll(async () => (await page.evaluate(async () => (await window.gamepilot.getInputState()).value)).status, { timeout: 15000, intervals: [20] }).toBe('executing');
    await page.getByRole('button', { name: '暂停任务', exact: true }).click();
    await expect(page.locator('.run-status')).toHaveText('已暂停');
    await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  }
  await expect(page.locator('.run-status')).toHaveText(/任务受阻 \/ 未通过验证|预算耗尽/, { timeout: 20000 });
  const budgeted = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(budgeted.summary.metrics.moves, 2);
  scenario = 'stall'; const takeoverRequests = requests; await run();
  await expect.poll(() => requests, { timeout: 15000 }).toBe(takeoverRequests + 1);
  await page.getByRole('button', { name: '接管游戏', exact: true }).click();
  await expect(page.locator('.run-status')).toHaveText('已取消', { timeout: 10000 });
  assert.equal((await page.evaluate(async () => (await window.gamepilot.getInputState()).value)).neutral, true);
  const taken = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.ok(taken.events.some(e => e.type === 'control_requested' && e.text === '用户接管'));
  await page.screenshot({ path: 'artifacts/p4-controls.png' });
  await writeFile('artifacts/p4-controls-check.json', JSON.stringify({ testOnly: true, physicalInputVerified: false, backend: 'injected Python dry-run', pausedModelResumed: resumed.summary, repeatedActionPause: budgeted.summary, takeover: taken.summary }, null, 2));
  const campaignId = randomUUID();
  const campaignPlan = { schemaVersion: 1, timeoutMs: 60000, game: 'test fixture', scene: 'fixed test window', resetProcedure: 'fixture', environment: { machine: 'test', cemu: 'test', gameVersion: 'test', controller: 'dry-run', modelId: 'mock', provider: 'volcengine' }, tasks: Object.fromEntries(['move', 'wait', 'blocked', 'cancel-model', 'cancel-action'].map(group => [group, { prompt: `P4 fixture ${group}`, successCondition: '测试画面中存在可见的 source frame 计数' }])) };
  const campaignDir = join(stateRoot, 'benchmarks', campaignId); await mkdir(campaignDir, { recursive: true });
  await writeFile(join(campaignDir, 'plan.json'), JSON.stringify({ plan: campaignPlan, planHash: createHash('sha256').update(JSON.stringify(campaignPlan)).digest('hex'), frozenAt: Date.now() }));
  await page.locator('.p4-presets>summary').click();
  await page.getByRole('textbox', { name: 'P4 批次 ID' }).fill(campaignId);
  const beforeLoad = requests;
  await page.getByRole('button', { name: '载入下一项' }).click();
  await expect(page.getByRole('textbox', { name: '任务指令' })).toHaveValue('P4 fixture move');
  assert.equal(requests, beforeLoad);
  scenario = 'verified-pass'; await run();
  await expect(page.locator('.run-status')).toHaveText('目标验证通过', { timeout: 20000 });
  const campaignRun = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  const reserved = JSON.parse(await readFile(join(campaignDir, 'move-1.json'), 'utf8'));
  const campaignManifest = JSON.parse(await readFile(join(stateRoot, 'runs', campaignRun.runId, 'manifest.json'), 'utf8'));
  assert.equal(reserved.runId, campaignRun.runId); assert.equal(campaignManifest.benchmark.campaignId, campaignId);
  assert.equal(campaignManifest.timeoutMs, 60000);
  await page.getByRole('button', { name: '载入下一项' }).click();
  await expect(page.locator('.p4-presets')).toContainText('第 2 次');
  await page.screenshot({ path: 'artifacts/p4-campaign.png' });
  await writeFile('artifacts/p4-campaign-check.json', JSON.stringify({ testOnly: true, physicalInputVerified: false, reservation: reserved, manifest: campaignManifest }, null, 2));
  }
  await mkdir('artifacts', { recursive: true });
  await page.getByRole('combobox', { name: '模型工具模式' }).selectOption('approach-xbox');
  await expect(page.getByRole('button', { name: /运行一次/ })).toBeDisabled();
  await page.getByRole('textbox', { name: 'P3 目标描述' }).fill('唯一测试目标');
  await page.getByRole('textbox', { name: '成功条件' }).fill('测试目标在固定屏幕区域内且面积达标');
  const p3Reports = [];
  for (const variant of ['approach-pass', 'approach-lost']) {
    scenario = variant; trackingRequests = 0; await run();
    await expect(page.locator('.run-status')).toHaveText(variant === 'approach-pass' ? '目标验证通过' : '任务受阻 / 未通过验证', { timeout: 30000 });
    const state = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
    assert.equal(state.summary.approach.executedSteps, variant === 'approach-pass' ? 2 : 1);
    assert.equal(state.summary.approach.stopReason, variant === 'approach-pass' ? 'arrived' : 'target-lost');
    await expect(page.getByLabel('P3 反馈进度')).toContainText(variant === 'approach-pass' ? 'arrived' : 'target-lost');
    const runDir = join(stateRoot, 'runs', state.runId);
    const audit = () => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type', 'module', '-e', "import { auditApproach } from './src/trace/approach-audit.ts'; console.log(JSON.stringify(await auditApproach(process.argv[1])))", runDir], { cwd: root, encoding: 'utf8', windowsHide: true }));
    const report = audit(); assert.equal(report.technicalPassed, true, JSON.stringify(report.checks)); assert.equal(report.testData, true);
    p3Reports.push({ scenario: variant, summary: state.summary, audit: report });
    if (variant === 'approach-pass') {
      assert.equal(report.feedbackDemonstrated, true);
      const logPath = join(runDir, 'events.jsonl'), original = await readFile(logPath, 'utf8');
      const damaged = original.trim().split('\n').map(line => JSON.parse(line)); damaged.find(e => e.type === 'approach_input').result.ageMs = 8000;
      await writeFile(logPath, damaged.map(e => JSON.stringify(e)).join('\n') + '\n'); assert.equal(audit().technicalPassed, false); await writeFile(logPath, original);
      const sample = join(root, 'artifacts/p3-sample-trace', state.runId); await cp(runDir, sample, { recursive: true });
      await writeFile(join(sample, 'test-context.json'), JSON.stringify({ testOnly: true, physicalInputVerified: false, backend: 'Python dry-run', locator: 'mock target boxes' }, null, 2));
      await page.getByLabel('P3 反馈进度').scrollIntoViewIfNeeded();
      await expect(page.getByLabel('P3 反馈进度')).toBeVisible();
      await page.screenshot({ path: 'artifacts/p3-approach.png' });
    }
  }
  scenario = 'approach-stall'; trackingRequests = 0; await run();
  await expect.poll(() => trackingRequests, { timeout: 15000 }).toBe(1);
  await page.getByRole('button', { name: '■ 取消运行', exact: true }).click();
  await expect(page.locator('.run-status')).toHaveText('已取消', { timeout: 10000 });
  const p3Canceled = await page.evaluate(async () => (await window.gamepilot.getSnapshot()).value);
  assert.equal(p3Canceled.summary.gameOutcome, 'unverified');
  assert.equal((await page.evaluate(async () => (await window.gamepilot.getInputState()).value)).neutral, true);
  p3Reports.push({ scenario: 'approach-stall-cancel', summary: p3Canceled.summary });
  await writeFile('artifacts/p3-agent-ui-check.json', JSON.stringify({ testOnly: true, physicalInputVerified: false, backend: 'Python dry-run', reports: p3Reports }, null, 2));
  if (!(await page.locator('.input-debug-panel').evaluate(el => el.open))) await page.locator('.input-debug-panel>summary').click();
  await page.getByRole('button', { name: '断开手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('断开设备');
  await expect.poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+F12'))).toBe(false);
  console.log(process.env.GAMEPILOT_TEST_P3_ONLY ? 'P3 Electron passed: feedback correction, lost-target stop, tracker cancellation, trace audit and stale-state rejection. ZERO physical controller actions.' : 'P3 feedback, target loss, tracker cancellation, trace audit; P4 campaign binding / pause-resume / cumulative budget / takeover and P2-C/P2-D Electron passed: native fresh capture → real Pi → injected dry Python receipt → independent verifier; passed/failed/inconclusive, read-only wait, screenshots/trace parity, verifier cancellation. ZERO physical controller actions.');
} finally {
  await app?.close(); await target?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
}
