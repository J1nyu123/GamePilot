import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.GAMEPILOT_RENDERER_URL;
const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  await page.locator('.input-debug-panel>summary').click();
  await expect(page.getByRole('combobox', { name: '手柄服务模式' })).toHaveValue('dry-run');
  await page.getByRole('button', { name: '连接手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('模拟服务已连接', { timeout: 15000 });
  await page.getByRole('button', { name: '执行调试动作' }).click();
  await expect(page.locator('.input-result')).toContainText('输入执行完成');
  let state = await page.evaluate(async () => (await window.gamepilot.getInputState()).value);
  assert.equal(state.neutral, true); assert.equal(state.lastResult.status, 'executed');
  await page.getByRole('spinbutton', { name: '手柄动作时长' }).fill('1500');
  await page.getByRole('button', { name: '执行调试动作' }).click();
  await expect(page.locator('.input-summary')).toContainText('正在执行');
  await page.getByRole('button', { name: '停止并归零' }).click();
  await expect(page.locator('.input-summary')).toContainText('收到归零确认');
  await expect(page.locator('.input-result')).toContainText('输入已取消');
  state = await page.evaluate(async () => (await window.gamepilot.getInputState()).value);
  assert.equal(state.lastResult.status, 'cancelled'); assert.equal(state.neutral, true); assert.ok(state.cancelAckMs >= 0);
  // Button skill uses the same validated protocol and service, still dry-run.
  await page.getByRole('combobox', { name: '手柄调试技能' }).selectOption('press_button');
  await page.getByRole('combobox', { name: 'Xbox 按钮' }).selectOption('B');
  await page.getByRole('spinbutton', { name: '手柄动作时长' }).fill('50');
  await page.getByRole('button', { name: '执行调试动作' }).click();
  await expect(page.locator('.input-result')).toContainText('输入执行完成');
  await page.locator('.input-result details>summary').click();
  await expect(page.locator('.input-result pre')).toContainText('press_button');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/p2b-input-debug.png' });
  await page.getByRole('button', { name: '断开手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('断开设备');
  state = await page.evaluate(async () => (await window.gamepilot.getInputState()).value);
  assert.equal(state.status, 'disconnected');
  // Close while executing: shutdown waits for reset ACK and does not leak Python.
  await page.getByRole('button', { name: '连接手柄服务' }).click();
  await expect(page.locator('.input-summary')).toContainText('模拟服务已连接');
  await page.getByRole('spinbutton', { name: '手柄动作时长' }).fill('1500');
  await page.getByRole('button', { name: '执行调试动作' }).click();
  await expect(page.locator('.input-summary')).toContainText('正在执行');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  console.log('P2-B Electron input UI passed: explicit dry-run connect, move/button, cancel ACK, protocol details, disconnect and close during input.');
} finally { await app.close(); }
