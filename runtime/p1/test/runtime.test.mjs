import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validate } from '../src/runtime.mjs';

const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=' };
async function run({ badArgs = false, failTool = false, cancel = false, stall = false, httpError = false, repeat = false, noTool = false, empty = false, thinkingOnly = false, thinkingMode, timeoutMs = 3000 } = {}) {
  const requests = [], events = [], controller = new AbortController();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (httpError) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Test authentication failure' } })); return; }
    if (stall) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant' });
    if (empty || thinkingOnly) {
      if (thinkingOnly) send({ reasoning_content: 'Private test reasoning, never expose this content.' });
      send({}, 'stop');
    } else if (!noTool && (requests.length === 1 || repeat)) {
      send({ content: 'Test image received; requesting a simulated action.' });
      send({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'move_for', arguments: JSON.stringify({ direction: badArgs ? 'invalid' : 'left', durationMs: cancel ? 2000 : 5 }) } }] });
      send({}, 'tool_calls');
    } else { send({ content: 'Simulation returned. Actual game outcome remains unverified.' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const summary = await validate({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only', modelId: 'mock',
      image, prompt: 'Simulate left movement', failTool, timeoutMs, thinkingMode, signal: controller.signal,
      onEvent(event) { events.push(event); if (cancel && event.type === 'simulation_start') controller.abort(); },
    });
    return { summary, requests, events };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('actual Pi Core + pi-ai: image → tool → tool result → model response', async () => {
  const { summary, requests, events } = await run();
  assert.equal(summary.status, 'protocol_passed');
  assert.equal(summary.gameOutcome, 'unverified');
  assert.equal(requests.length, 2);
  assert.ok(requests[0].messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
  assert.ok(requests[1].messages.some(m => m.role === 'tool' && m.content.includes('unverified')));
  assert.ok(events.some(e => e.type === 'model_text'));
  assert.ok(events.some(e => e.type === 'tool_execution_end' && !e.isError));
  assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1));
});
test('invalid arguments never execute the tool', async () => {
  const { summary, events } = await run({ badArgs: true });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.completedTools, 0);
  assert.ok(!events.some(e => e.type === 'simulation_start'));
});
test('tool exceptions cannot become success', async () => {
  const { summary } = await run({ failTool: true });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.completedTools, 0);
});
test('cancel interrupts a long simulated action', async () => {
  const { summary } = await run({ cancel: true });
  assert.equal(summary.status, 'canceled');
  assert.equal(summary.completedTools, 0);
});
test('timeout aborts stalled model request', async () => {
  const { summary } = await run({ stall: true, timeoutMs: 100 });
  assert.equal(summary.status, 'timed_out');
  assert.equal(summary.completedTools, 0);
});
test('provider errors are failures', async () => {
  const { summary } = await run({ httpError: true });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.completedTools, 0);
});
test('plain model reply without a tool is incomplete', async () => {
  assert.equal((await run({ noTool: true })).summary.status, 'incomplete');
});
test('repeated tool requests cannot loop forever', async () => {
  const { summary, requests } = await run({ repeat: true });
  assert.equal(summary.status, 'budget_exceeded');
  assert.ok(requests.length <= 5);
  assert.ok(summary.completedTools <= 4);
});
test('empty provider response is explained and cannot pass', async () => {
  const { summary, events } = await run({ empty: true });
  assert.equal(summary.status, 'incomplete');
  assert.match(summary.error, /没有返回可展示文本/);
  assert.equal(events.find(e => e.type === 'model_end').diagnostics.textChars, 0);
});
test('thinking-only responses are counted without logging reasoning', async () => {
  const { summary, events } = await run({ thinkingOnly: true });
  assert.equal(summary.status, 'incomplete');
  assert.match(summary.error, /仅返回推理内容/);
  assert.ok(events.find(e => e.type === 'model_end').diagnostics.thinkingChars > 0);
  assert.ok(!JSON.stringify(events).includes('Private test reasoning'));
});
test('provider thinking switch is sent explicitly, while generic defaults are untouched', async () => {
  const disabled = await run({ thinkingMode: 'disabled' });
  assert.equal(disabled.summary.status, 'protocol_passed');
  assert.deepEqual(disabled.requests[0].thinking, { type: 'disabled' });
  assert.equal((await run()).requests[0].thinking, undefined);
});
