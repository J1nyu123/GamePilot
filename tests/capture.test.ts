import test from 'node:test';
import assert from 'node:assert/strict';
import { isAfterBarrier } from '../src/capture/fresh-frame';
import { CaptureController } from '../src/capture/controller';
import type { GameWindow } from '../src/contracts/capture';
import type { RawFrame } from '../src/capture/window-stream';
const windowInfo: GameWindow = { id: 'window:1:0', identity: '1:pid:created', title: 'Cemu', processName: 'Cemu', foreground: false, minimized: false, width: 640, height: 480 };
const frame = (n: number): RawFrame => ({ dataUrl: 'data:image/jpeg;base64,AA==', width: 640, height: 480, sourceMediaTime: n, presentedFrames: n, barrierMediaTime: n - 1, barrierPresentedFrames: n - 1, barrierRequestedAt: Date.now(), capturedAt: null, receivedAt: Date.now() });
test('source barrier rejects late cached frames, reordered counts, and old capture clocks', () => {
  const barrier = { mediaTime: 10, presentedFrames: 30, requestedAt: 1000 };
  assert.equal(isAfterBarrier({ mediaTime: 9, presentedFrames: 31, presentationTime: 1100 }, barrier), false);
  assert.equal(isAfterBarrier({ mediaTime: 11, presentedFrames: 29, presentationTime: 1100 }, barrier), false);
  assert.equal(isAfterBarrier({ mediaTime: 11, presentedFrames: 31, presentationTime: 1100, captureTime: 900 }, barrier), false);
  assert.equal(isAfterBarrier({ mediaTime: 11, presentedFrames: 31, presentationTime: 1100 }, barrier), true);
});
test('static image pixels remain valid with advancing source stamps; title/focus changes keep identity', async () => {
  let info = { ...windowInfo }, n = 1;
  const controller = new CaptureController({ list: async () => [info], info: async () => info, start: async () => {}, stop: () => {}, frame: async () => frame(n++) }, () => {});
  try {
    await controller.start(info.id); const first = await controller.freshFrame();
    info = { ...info, title: 'Cemu changed title', foreground: true };
    const next = await controller.freshFrame();
    assert.equal(first.dataUrl, next.dataUrl); assert.ok(next.sourceMediaTime > first.sourceMediaTime);
    assert.equal(next.title, info.title); assert.equal(next.capturedAt, null);
  } finally { controller.stop(); }
});
test('window minimize/close/identity replacement cannot produce a snapshot', async () => {
  let info: GameWindow | null = { ...windowInfo }, n = 1;
  const controller = new CaptureController({ list: async () => [], info: async () => info, start: async () => {}, stop: () => {}, frame: async () => frame(n++) }, () => {});
  try {
    await controller.start(windowInfo.id);
    info = { ...windowInfo, minimized: true }; await assert.rejects(controller.freshFrame(), /最小化/);
    info = { ...windowInfo, identity: 'reused-handle' }; await assert.rejects(controller.freshFrame(), /身份改变/);
    info = null; await assert.rejects(controller.freshFrame(), /已关闭/);
  } finally { controller.stop(); }
});
test('stop generation rejects an in-flight late frame instead of resuming preview', async () => {
  let release!: (f: RawFrame) => void, delayed = false;
  const controller = new CaptureController({ list: async () => [windowInfo], info: async () => windowInfo, start: async () => {}, stop: () => {},
    frame: async () => delayed ? new Promise<RawFrame>(resolve => { release = resolve; }) : frame(1) }, () => {});
  await controller.start(windowInfo.id); delayed = true;
  const pending = controller.freshFrame();
  while (!release) await new Promise(r => setImmediate(r));
  controller.stop(); release(frame(2)); await assert.rejects(pending, /窗口选择已改变/);
  assert.equal(controller.state.status, 'stopped');
});
test('no source-frame progress and capture failure never fall back to previous pixels', async () => {
  let stale = false;
  const controller = new CaptureController({ list: async () => [windowInfo], info: async () => windowInfo, start: async () => {}, stop: () => {},
    frame: async () => stale ? { ...frame(1), sourceMediaTime: 0 } : frame(1) }, () => {});
  try { await controller.start(windowInfo.id); stale = true; await assert.rejects(controller.freshFrame(), /缓存帧/); }
  finally { controller.stop(); }
});
test('source capture time before request barrier is rejected even with advanced media stamps', async () => {
  let old = false;
  const controller = new CaptureController({ list: async () => [windowInfo], info: async () => windowInfo, start: async () => {}, stop: () => {},
    frame: async () => old ? { ...frame(2), capturedAt: 100, barrierRequestedAt: 200 } : frame(1) }, () => {});
  try { await controller.start(windowInfo.id); old = true; await assert.rejects(controller.freshFrame(), /屏障前采集/); }
  finally { controller.stop(); }
});
test('source-frame timeout during minimize is classified using the current window state', async () => {
  let info = { ...windowInfo }, fail = false;
  const controller = new CaptureController({ list: async () => [info], info: async () => info, start: async () => {}, stop: () => {},
    frame: async () => { if (fail) { info = { ...info, minimized: true }; throw new Error('frame timeout'); } return frame(1); } }, () => {});
  try { await controller.start(windowInfo.id); fail = true; await assert.rejects(controller.freshFrame(), /最小化/); }
  finally { controller.stop(); }
});
