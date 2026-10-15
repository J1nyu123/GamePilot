import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLoopRegistry } from '../src/agent/game-loop';

test('observation precedes action; action receipt and fresh pixels are returned together', async () => {
  const order: string[] = []; let frame = 0;
  const registry = gameLoopRegistry({
    capture: async () => { order.push('capture'); return { id: String(++frame), data: `frame-${frame}`, mimeType: 'image/png' }; },
    act: async () => { order.push('press-release'); return { released: true }; },
  }, new AbortController().signal);
  const [capture, action] = registry.tools;
  await assert.rejects(action.execute({ keys: ['W'], duration_ms: 200 }, undefined, 'a'), /capture_game/);
  await capture.execute({}, undefined, 'b');
  const result = await action.execute({ keys: ['W'], duration_ms: 200 }, undefined, 'c');
  assert.deepEqual(order, ['capture', 'press-release', 'capture']);
  assert.deepEqual(result.content[1], { type: 'image', data: 'frame-2', mimeType: 'image/png' });
  assert.equal(result.details.simulated, false);
  await assert.rejects(action.execute({ keys: ['ALT'], duration_ms: 200 }, undefined, 'd'), /按键/);
  await assert.rejects(action.execute({ keys: ['W'], duration_ms: 1001 }, undefined, 'e'), /20–1000/);
  for (let i = 0; i < 3; i++) await action.execute({ keys: ['W'], duration_ms: 20 }, undefined, 'f');
  await assert.rejects(action.execute({ keys: ['W'], duration_ms: 20 }, undefined, 'g'), /预算/);
});

test('cancellation and capture failures never return successful action feedback', async () => {
  const controller = new AbortController(); let actions = 0;
  const registry = gameLoopRegistry({ capture: async () => ({ id: '1', data: 'x', mimeType: 'image/png' }),
    act: async () => { actions++; controller.abort(); } }, controller.signal);
  await registry.tools[0].execute({}, undefined, 'a');
  await assert.rejects(registry.tools[1].execute({ keys: ['W'], duration_ms: 20 }, undefined, 'b'));
  await assert.rejects(registry.tools[1].execute({ keys: ['W'], duration_ms: 20 }, undefined, 'c'));
  assert.equal(actions, 1);
  let frames = 0;
  const failed = gameLoopRegistry({ capture: async () => { if (++frames > 1) throw new Error('lost window'); return { id: '1', data: 'x', mimeType: 'image/png' }; }, act: async () => ({ released: true }) }, new AbortController().signal);
  await failed.tools[0].execute({}, undefined, 'a');
  await assert.rejects(failed.tools[1].execute({ keys: ['W'], duration_ms: 20 }, undefined, 'b'), /lost window/);
});
