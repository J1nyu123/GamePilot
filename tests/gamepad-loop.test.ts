import test from 'node:test';
import assert from 'node:assert/strict';
import { gamepadLoopRegistry } from '../src/agent/gamepad-loop';
import { toolCapabilities } from '../src/agent/capabilities';

test('real gamepad validates actions, releases before new image, and exposes correct capabilities', async () => {
  const order: string[] = [];
  const registry = gamepadLoopRegistry({ capture: async () => { order.push('capture'); return { id: 'test', data: 'pixels', mimeType: 'image/png' }; },
    act: async () => { order.push('action-release'); return { neutral: true }; } }, new AbortController().signal);
  const [observe, action] = registry.tools;
  await assert.rejects(action.execute({ buttons: ['A'], duration_ms: 200 }, undefined, '1'), /capture_game/);
  await observe.execute({}, undefined, '2');
  for (const args of [{ duration_ms: 1001 }, { duration_ms: 200, left_x: 2 }, { duration_ms: 200, buttons: ['BAD'] }, { duration_ms: 200, shell: 'x' }]) {
    await assert.rejects(action.execute(args, undefined, '3'));
  }
  const result = await action.execute({ buttons: ['A'], left_y: 0.7, duration_ms: 200 }, undefined, '4');
  assert.deepEqual(order, ['capture', 'action-release', 'capture']);
  assert.equal(result.details.simulated, false); assert.equal(result.content[1].type, 'image');
  assert.deepEqual(toolCapabilities('gamepad').taskTools.map(t => t.name), ['capture_game', 'gamepad_action']);
});
