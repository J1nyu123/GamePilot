import { app } from 'electron';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { WindowStream } from '../src/capture/window-stream';
// Keep the test process alive while its only hidden capture window is replaced.
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const stream = new WindowStream(resolve(process.env.GAMEPILOT_TEST_ROOT!, 'dist/capture/capture.html'));
  try {
    const id = process.env.GAMEPILOT_TEST_SOURCE_ID!;
    await stream.start(id); await stream.frame();
    const started = performance.now(), pending = stream.frame(); stream.close();
    await assert.rejects(pending, /停止|关闭/); assert.ok(performance.now() - started < 1000);
    await stream.start(id); const fresh = await stream.frame(); assert.ok(fresh.width > 0);
    const initializing = stream.start(id); stream.close(); await assert.rejects(initializing, /停止|取消|关闭/);
    await writeFile(process.env.GAMEPILOT_TEST_RESULT!, JSON.stringify({ passed: true, pendingFrameSettledOnStop: true, initializationSettledOnStop: true, restartProducedFreshFrame: true }));
  } catch (error) {
    await writeFile(process.env.GAMEPILOT_TEST_RESULT!, JSON.stringify({ passed: false, error: error instanceof Error ? error.message : 'unknown' }));
  } finally { stream.close(); app.quit(); }
});
