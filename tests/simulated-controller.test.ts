import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedInputController } from '../src/input/simulated-controller';

test('manual MCP supports full stick vectors, triggers, explicit release and state queries', async () => {
  const input = new SimulatedInputController(() => {}); input.connect();
  try {
    await input.execute({ tool: 'gamepad_set_stick', args: { stick: 'right', x: .3, y: -.6 } });
    assert.deepEqual(input.backend.getState().rightStick, { x: .3, y: -.6 });
    await input.execute({ tool: 'gamepad_set_trigger', args: { trigger: 'left', value: .4 } });
    await input.execute({ tool: 'gamepad_press_button', args: { button: 'A' } });
    await input.execute({ tool: 'gamepad_release_button', args: { button: 'A' } });
    assert.deepEqual(input.backend.getState().buttons, []);
    const result = await input.execute({ tool: 'gamepad_get_state', args: {} });
    assert.equal(result.state.leftTrigger, .4);
    await input.execute({ tool: 'gamepad_reset_all', args: {} });
    assert.equal(input.state.neutral, true);
  } finally { input.close(); }
});

test('invalid arguments fail before modifying simulated controller state', async () => {
  const input = new SimulatedInputController(() => {}); input.connect();
  try {
    for (const command of [
      { tool: 'gamepad_set_stick', args: { stick: 'invented', x: .5, y: 0 } },
      { tool: 'gamepad_set_trigger', args: { trigger: 'left', value: NaN } },
      { tool: 'gamepad_press_button', args: { button: 'A', duration_ms: 0 } },
      { tool: 'gamepad_get_state', args: { unexpected: true } },
    ]) {
      await assert.rejects(input.execute(command)); assert.equal(input.backend.getState().neutral, true);
    }
  } finally { input.close(); }
});

test('runtime reservation rejects manual input and cancellation neutralizes before ownership is released', async () => {
  const input = new SimulatedInputController(() => {}), controller = new AbortController();
  let started!: () => void; const began = new Promise<void>(r => started = r);
  let released = false;
  const running = input.withRun(controller.signal, async registry => {
    started();
    return registry.tools.find(t => t.name === 'gamepad_set_stick')!.execute({ stick: 'left', x: .5, y: 0, duration_ms: 2000 }, undefined, 'call');
  }, () => { assert.equal(input.backend.getState().neutral, true); released = true; });
  try {
    await began;
    await assert.rejects(input.execute({ tool: 'gamepad_press_button', args: { button: 'A' } }), /等待模型任务/);
    controller.abort(); await assert.rejects(running, /abort|中断/i);
    assert.equal(input.busy, false); assert.equal(released, true); assert.equal(input.backend.getState().activeTimers, 0);
  } finally { input.close(); }
});

test('runtime receipts remain simulated and termination releases indefinite holds', async () => {
  const input = new SimulatedInputController(() => {});
  try {
    await input.withRun(new AbortController().signal, async registry => {
      const result = await registry.tools.find(t => t.name === 'gamepad_press_button')!.execute({ button: 'B' }, undefined, 'call');
      assert.equal(result.details.simulated, true); assert.equal(result.details.gameOutcome, 'unverified');
      assert.equal(input.backend.getState().neutral, false);
    }, () => {});
    assert.equal(input.backend.getState().neutral, true); assert.equal(input.backend.getState().activeTimers, 0);
  } finally { input.close(); }
});
