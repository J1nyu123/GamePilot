// Explicit real-device probe. No executeInput request is sent.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.GAMEPILOT_RENDERER_URL;
const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
try {
  const page = await app.firstWindow(); await page.locator('.input-debug-panel>summary').click();
  await page.getByRole('combobox', { name: '手柄服务模式' }).selectOption('virtual-xbox');
  await page.getByRole('button', { name: '连接手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('虚拟 Xbox 已连接', { timeout: 15000 });
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')), true);
  await page.getByRole('button', { name: '停止并归零' }).click();
  await expect(page.locator('.input-summary')).toContainText('收到归零确认');
  const state = await page.evaluate(async () => (await window.gamepilot.getInputState()).value);
  assert.equal(state.mode, 'virtual-xbox'); assert.equal(state.neutral, true);
  assert.ok(!state.history.some(e => e.event === 'action_start'));
  await page.getByRole('button', { name: '断开手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('断开设备');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')), false);
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/input-driver-ui-probe.json', JSON.stringify({ backend: 'virtual-xbox', neutralResetAck: state.neutral, resetAckMs: state.cancelAckMs, f8RegisteredAndReleased: true, movementOrButtonActionsSent: 0, cemuMappingVerified: false }, null, 2));
  console.log('Real driver UI connect/reset/disconnect and F8 registration passed; no movement or button input sent.');
} finally { await app.close(); }
