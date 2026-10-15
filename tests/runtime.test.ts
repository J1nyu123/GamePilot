import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runValidation } from '../src/agent/validation-runtime';
import { SimulatedInputController } from '../src/input/simulated-controller';

test('real Pi loop receives an image, calls simulated MCP and returns public events', async () => {
  let requests = 0, sawImage = false, sawReceipt = false;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); requests++;
    sawImage ||= body.messages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url'));
    const afterTool = body.messages.some((m: any) => m.role === 'tool');
    if (afterTool) sawReceipt = body.messages.some((m: any) => m.role === 'tool' && m.content.includes('"simulated":true'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    send({ role: 'assistant' });
    if (afterTool) { send({ content: '模拟操作完成，游戏效果未经验证。' }); send({}, 'stop'); }
    else { send({ tool_calls: [{ index: 0, id: 'mcp-call', type: 'function', function: { name: 'gamepad_set_stick', arguments: '{"stick":"left","x":-0.5,"y":0,"duration_ms":20}' } }] }); send({}, 'tool_calls'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const input = new SimulatedInputController(() => {}), events: string[] = [];
  try {
    const signal = new AbortController().signal;
    const result = await input.withRun(signal, registry => runValidation({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      modelId: 'fixture', apiKey: 'fixture-key', image: { type: 'image', data: 'AQID', mimeType: 'image/png' }, prompt: '模拟左摇杆',
      timeoutMs: 10000, signal, toolRegistry: registry, onEvent: e => events.push(e.type) }), () => {});
    assert.equal(requests, 2); assert.equal(sawImage, true); assert.equal(sawReceipt, true);
    assert.equal(result.status, 'protocol_passed'); assert.equal(result.completedTools, 1);
    assert.equal(result.simulated, true); assert.equal(result.gameOutcome, 'unverified');
    assert.ok(events.includes('model_request')); assert.ok(events.includes('tool_execution_end'));
    assert.equal(input.backend.getState().neutral, true);
  } finally { input.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
