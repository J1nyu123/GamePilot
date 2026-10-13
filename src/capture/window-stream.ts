import { BrowserWindow } from 'electron';
import type { CaptureFrame } from '../contracts/capture';
import { isAfterBarrier } from './fresh-frame';
export interface RawFrame { dataUrl: string; width: number; height: number; sourceMediaTime: number; presentedFrames: number; barrierMediaTime: number; barrierPresentedFrames: number; barrierRequestedAt: number; capturedAt: number | null; receivedAt: number }
export class WindowStream {
  private host?: BrowserWindow;
  private pending = new Map<BrowserWindow, Set<(error: Error) => void>>();
  constructor(private page: string) {}
  private rejectHost(host: BrowserWindow, message: string) { for (const reject of [...(this.pending.get(host) ?? [])]) reject(new Error(message)); }
  private run<T>(host: BrowserWindow, work: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return; settled = true; clearTimeout(timer); tasks.delete(cancel);
        if (!tasks.size) this.pending.delete(host);
        if (error) reject(error); else resolve(value!);
      };
      const cancel = (error: Error) => finish(error), tasks = this.pending.get(host) ?? new Set<(error: Error) => void>();
      tasks.add(cancel); this.pending.set(host, tasks);
      const timer = setTimeout(() => cancel(new Error(message)), timeoutMs);
      void Promise.resolve().then(() => {
        if (host.isDestroyed() || this.host !== host) throw new Error('捕获会话已停止');
        return work();
      }).then(value => finish(undefined, value), error => finish(error instanceof Error ? error : new Error('捕获请求失败')));
    });
  }
  async start(id: string) {
    this.close();
    const host = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'gamepilot-capture' } });
    this.host = host;
    host.on('closed', () => this.rejectHost(host, '捕获窗口已关闭'));
    host.webContents.on('render-process-gone', () => this.rejectHost(host, '捕获渲染进程退出'));
    try { await this.run(host, async () => {
      await host.loadFile(this.page);
      if (this.host !== host || host.isDestroyed()) throw new Error('捕获初始化已取消');
      await host.webContents.executeJavaScript(`(async () => {
      const video = document.querySelector('video');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(id)}, maxFrameRate: 10 } } });
      video.srcObject = stream; await video.play();
    })()`);
    }, 10000, '窗口捕获初始化超时，请停止预览后重试'); }
    catch (error) { if (this.host === host) this.close(); throw error; }
  }
  async frame(): Promise<RawFrame> {
    const host = this.host;
    if (!host || host.isDestroyed()) throw new Error('捕获流未启动');
    // Discard the next delivered frame as a watermark, then require a newer source
    // timestamp. A late callback with an old timestamp cannot cross this barrier.
    return this.run(host, () => host.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const video = document.querySelector('video');
      const track = video.srcObject?.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') { reject(new Error('目标窗口捕获流已结束')); return; }
      const requestedAt = performance.now(); let watermark, callback;
      const timer = setTimeout(() => { video.cancelVideoFrameCallback(callback); reject(new Error('目标窗口没有新的源帧，请恢复窗口或重新开始预览')); }, 3000);
      const after = ${isAfterBarrier.toString()};
      const next = (now, metadata) => {
        if (!watermark) { watermark = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, requestedAt }; callback = video.requestVideoFrameCallback(next); return; }
        if (!after(metadata, watermark)) { callback = video.requestVideoFrameCallback(next); return; }
        clearTimeout(timer);
        if (video.videoWidth < 1 || video.videoHeight < 1) { reject(new Error('窗口画面尺寸无效')); return; }
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1280 / video.videoWidth, 800 / video.videoHeight);
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height,
          sourceMediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
          barrierMediaTime: watermark.mediaTime, barrierPresentedFrames: watermark.presentedFrames,
          barrierRequestedAt: performance.timeOrigin + requestedAt,
          capturedAt: typeof metadata.captureTime === 'number' ? performance.timeOrigin + metadata.captureTime : null,
          receivedAt: performance.timeOrigin + now });
      };
      callback = video.requestVideoFrameCallback(next);
    })`), 3500, '捕获新帧响应超时，请重新开始预览');
  }
  close() { const host = this.host; this.host = undefined; if (host) { this.rejectHost(host, '捕获会话已停止'); if (!host.isDestroyed()) host.destroy(); } }
}
