import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerBackend, XBOX_BUTTONS } from '../src/mcp/controller-backend';
import { GAMEPAD_TOOL_DEFINITIONS, executeGamepadTool } from '../src/mcp/gamepad-skill';
import { createGamepadMcpServer } from '../src/mcp/gamepad-mcp-server';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

test('Gamepad MCP Tool - Zero Game Priors Check', () => {
  // Ensure none of the tools contain game-specific semantic keywords
  const forbiddenGamePriors = [
    'attack', 'jump', 'climb', 'sword', 'shield', 'parry',
    'zelda', 'link', 'item', 'menu', 'dodge', 'bow', 'arrow'
  ];

  for (const def of GAMEPAD_TOOL_DEFINITIONS) {
    const jsonStr = JSON.stringify(def).toLowerCase();
    for (const prior of forbiddenGamePriors) {
      assert.equal(
        jsonStr.includes(prior),
        false,
        `Tool ${def.name} unexpectedly leaked game-specific prior: ${prior}`
      );
    }
  }

  // Exactly 6 hardware-level orthogonal tools
  assert.equal(GAMEPAD_TOOL_DEFINITIONS.length, 6);
  const names = GAMEPAD_TOOL_DEFINITIONS.map(d => d.name);
  assert.deepEqual(names, [
    'gamepad_press_button',
    'gamepad_release_button',
    'gamepad_set_stick',
    'gamepad_set_trigger',
    'gamepad_reset_all',
    'gamepad_get_state',
  ]);
});

test('ControllerBackend - Button Press, Hold, and Release', async () => {
  const backend = new ControllerBackend({ forceEmulator: true });
  assert.equal(backend.getState().neutral, true);

  // Press button A without duration (holding)
  backend.pressButton('A');
  let state = backend.getState();
  assert.deepEqual(state.buttons, ['A']);
  assert.equal(state.neutral, false);

  // Release button A
  backend.releaseButton('A');
  state = backend.getState();
  assert.deepEqual(state.buttons, []);
  assert.equal(state.neutral, true);

  // Timed press with auto-release
  backend.pressButton('B', 60);
  assert.deepEqual(backend.getState().buttons, ['B']);
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(backend.getState().buttons, []);
  assert.equal(backend.getState().neutral, true);

  backend.close();
});

test('ControllerBackend - Analog Stick and Trigger Clamping', async () => {
  const backend = new ControllerBackend({ forceEmulator: true });

  // Out of range coordinates should be clamped to [-1.0, 1.0]
  backend.setStick('left', 2.5, -3.0);
  let state = backend.getState();
  assert.equal(state.leftStick.x, 1.0);
  assert.equal(state.leftStick.y, -1.0);

  // Timed stick hold auto-centers
  backend.setStick('right', 0.5, 0.5, 60);
  assert.equal(backend.getState().rightStick.x, 0.5);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(backend.getState().rightStick.x, 0);
  assert.equal(backend.getState().rightStick.y, 0);

  // Triggers clamp to [0.0, 1.0]
  backend.setTrigger('left', 1.5);
  assert.equal(backend.getState().leftTrigger, 1.0);
  backend.setTrigger('left', -0.5);
  assert.equal(backend.getState().leftTrigger, 0.0);

  backend.close();
});

test('ControllerBackend - Reset All', () => {
  const backend = new ControllerBackend({ forceEmulator: true });

  backend.pressButton('X');
  backend.pressButton('Y');
  backend.setStick('left', 0.8, -0.8);
  backend.setTrigger('right', 0.9);
  assert.equal(backend.getState().neutral, false);

  backend.resetAll();
  const state = backend.getState();
  assert.equal(state.neutral, true);
  assert.deepEqual(state.buttons, []);
  assert.equal(state.leftStick.x, 0);
  assert.equal(state.leftStick.y, 0);
  assert.equal(state.rightTrigger, 0);

  backend.close();
});

test('executeGamepadTool - Unified execution dispatch', async () => {
  const backend = new ControllerBackend({ forceEmulator: true });

  const pressRes = await executeGamepadTool('gamepad_press_button', { button: 'START' }, backend);
  assert.equal(pressRes.ok, true);
  assert.deepEqual(backend.getState().buttons, ['START']);

  const releaseRes = await executeGamepadTool('gamepad_release_button', { button: 'START' }, backend);
  assert.equal(releaseRes.ok, true);
  assert.deepEqual(backend.getState().buttons, []);

  const invalidRes = await executeGamepadTool('gamepad_press_button', { button: 'INVALID_BTN' }, backend);
  assert.equal(invalidRes.ok, false);

  backend.close();
});
