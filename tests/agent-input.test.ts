import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { PythonGamepad, findPython } from '../src/input/python-client';
import { ManualInputController } from '../src/input/manual-controller';
import { runValidation } from '../src/agent/validation-runtime';
import type { InputMode, InputReply } from '../src/contracts/input';
import type { AgentEvent } from '../src/contracts/debug';

const python = findPython(resolve('.')), script = resolve('python/gamepad_service.py');
const image = { type: 'image' as const, mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=' };
type Scenario = 'normal' | 'bad' | 'extra' | 'repeat' | 'cancel-model' | 'cancel-action' | 'focus' | 'timeout' | 'reset-failure';

// All integration tests use a real Python process in dry-run mode: ZERO device input.
async function exercise(scenario: Scenario) {
  const abort = new AbortController(), events: Omit<AgentEvent, 'runId'>[] = [], protocol: InputReply[] = [];
  let device!: PythonGamepad, foreground = true, modelCalls = 0, applied = 0;
  class DryDevice extends PythonGamepad {
    override start(_mode: InputMode) { return super.start('dry-run'); }
    override async reset() {
      if (scenario === 'reset-failure' && applied) throw new Error('Injected reset ACK failure');
      return super.reset();
    }
  }
  const control = new ManualInputController(python, script, () => {}, {
    createPad: notify => {
      device = new DryDevice(python, script, reply => {
        protocol.push(reply); notify(reply);
        if (reply.event === 'action_start') { applied++; if (scenario === 'cancel-action') abort.abort(); }
      }); return device;
    }, prepareMs: 0, guardIntervalMs: 5,
  });
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); modelCalls++;
    assert.ok(input.messages.some((m: { content: unknown }) => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
    if (scenario === 'cancel-model') { abort.abort(); return; }
    if (scenario === 'focus') { foreground = false; return; }
    if (scenario === 'timeout') return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: 'p2c', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (!input.messages.some((m: { role: string }) => m.role === 'tool') || scenario === 'repeat') {
      send({ content: '可操作场景。选择一次向左移动。' });
      send({ tool_calls: [{ index: 0, id: `call-${modelCalls}`, type: 'function', function: { name: 'move_for', arguments: JSON.stringify({ direction: 'left', durationMs: scenario === 'bad' ? 2000 : scenario === 'cancel-action' ? 1500 : 40, ...(scenario === 'extra' ? { arbitrary: true } : {}) }) } }] });
      send({}, 'tool_calls');
    } else { send({ content: '输入已执行，游戏目标未经验证。' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('test address');
  try {
    await control.connect('virtual-xbox');
    const summary = await control.withAgent(abort.signal, async () => { if (!foreground) throw new Error('lost focus'); }, async execute => {
      assert.equal(control.busy, true);
      await assert.rejects(control.execute({ skill: 'press_button', button: 'A', durationMs: 20 }), /当前操作/);
      return runValidation({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'local-test', modelId: 'mock', image, prompt: '根据画面向左移动', signal: abort.signal, timeoutMs: scenario === 'timeout' ? 80 : 5000,
        movement: args => execute({ skill: 'move_for', ...args, strength: .5 }), onEvent: event => events.push(event) });
    }, () => abort.abort(), (type, text, result) => events.push({ type, text, result, sequence: 0, timestamp: Date.now(), simulated: false }));
    assert.equal(control.busy, false); assert.equal(control.state.neutral, true);
    if (summary.status === 'control_passed') assert.equal(control.state.lastResult?.status, 'executed');
    return { summary, events, protocol, modelCalls, applied };
  } finally {
    // Restore the deliberately failed test method so the owned dry process can be cleaned up.
    if (device) device.reset = PythonGamepad.prototype.reset.bind(device);
    await control.disconnect().catch(() => {}); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  }
}

test('Pi screenshot → bounded movement → actual Python receipt → model response (injected dry backend)', async () => {
  const result = await exercise('normal');
  assert.equal(result.summary.status, 'control_passed'); assert.equal(result.summary.simulated, false);
  assert.equal(result.summary.gameOutcome, 'unverified'); assert.equal(result.modelCalls, 2); assert.equal(result.applied, 1);
  const end = result.events.find(e => e.type === 'tool_execution_end');
  assert.equal(end?.isError, false); assert.equal(end?.simulated, false);
  assert.ok(result.events.some(e => e.type === 'input_released'));
  assert.ok(!result.events.some(e => e.type === 'simulation_start'));
});
test('real tool rejects duration above 1500ms before sending any input', async () => {
  const result = await exercise('bad'); assert.equal(result.summary.status, 'failed'); assert.equal(result.applied, 0);
});
test('unexpected tool fields do not reach Python', async () => {
  const result = await exercise('extra'); assert.equal(result.summary.status, 'failed'); assert.equal(result.applied, 0);
});
test('second movement request is blocked even after the first receipt succeeds', async () => {
  const result = await exercise('repeat'); assert.equal(result.summary.status, 'budget_exceeded'); assert.equal(result.applied, 1);
});
for (const scenario of ['cancel-model', 'cancel-action', 'focus', 'timeout'] as const) {
  test(`${scenario}: interrupted model/tool cannot report task success`, async () => {
    const result = await exercise(scenario);
    assert.equal(result.summary.status, scenario === 'timeout' ? 'timed_out' : 'canceled');
    assert.equal(result.summary.completedTools, 0); assert.equal(result.applied, scenario === 'cancel-action' ? 1 : 0);
  });
}
test('missing final reset ACK cannot become a successful Agent result', async () => {
  await assert.rejects(exercise('reset-failure'), /reset ACK failure/);
});
test('abort during preparation prevents model and movement altogether', async () => {
  class DryDevice extends PythonGamepad { override start(_mode: InputMode) { return super.start('dry-run'); } }
  const control = new ManualInputController(python, script, () => {}, { createPad: notify => new DryDevice(python, script, notify), prepareMs: 3000 });
  const abort = new AbortController(); let calls = 0;
  try {
    await control.connect('virtual-xbox');
    const run = control.withAgent(abort.signal, async () => {}, async () => { calls++; }, () => abort.abort(), type => { if (type === 'input_preparing') abort.abort(); });
    await assert.rejects(run, { name: 'AbortError' });
    assert.equal(calls, 0); assert.equal(control.state.neutral, true); assert.equal(control.busy, false);
  } finally { await control.disconnect(); }
});
