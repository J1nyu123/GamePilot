import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('standalone MCP negotiates stdio, exposes six tools and executes simulated commands', async () => {
  const client = new Client({ name: 'gamepilot-check', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', resolve('src/mcp/gamepad-mcp-server.ts')], cwd: resolve('.'), stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: 'gamepad_set_stick', arguments: { stick: 'right', x: .2, y: -.4 } });
    const content = result.content as { type: string; text: string }[];
    const state = JSON.parse(content.find(c => c.type === 'text')!.text).state;
    assert.equal(state.backend, 'emulator'); assert.deepEqual(state.rightStick, { x: .2, y: -.4 });
    await assert.rejects(client.callTool({ name: 'gamepad_press_button', arguments: { button: 'A', duration_ms: 0 } }));
    await client.callTool({ name: 'gamepad_reset_all', arguments: {} });
  } finally { await client.close(); }
});
