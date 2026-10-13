import type { CaptureFrame, CaptureState, GameWindow } from '../contracts/capture';
import type { RawFrame } from './window-stream';
export interface CaptureDependencies { list(): Promise<GameWindow[]>; info(id: string): Promise<GameWindow | null>; start(id: string): Promise<void>; frame(): Promise<RawFrame>; stop(): void }
export class CaptureController {
  state: CaptureState = { status: 'stopped', generation: 0, message: '预览未启动' };
  private selected?: GameWindow;
  private generation = 0;
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private deps: CaptureDependencies, private notify: (state: CaptureState) => void) {}
  private update(state: CaptureState) { this.state = state; this.notify(state); }
  list() { return this.deps.list(); }
  async start(id: string) {
    this.stop(); const generation = this.generation;
    const selected = await this.deps.info(id);
    if (generation !== this.generation) throw new Error('窗口选择已改变');
    if (!selected) throw new Error('目标窗口已关闭或不可用');
    if (selected.minimized) throw new Error('目标窗口已最小化，请恢复窗口');
    this.selected = selected;
    this.update({ status: 'starting', generation, window: selected, message: '正在建立窗口捕获流' });
    try {
      await this.deps.start(id);
      if (generation !== this.generation) throw new Error('捕获初始化已取消');
      const frame = await this.freshFrame();
      this.update({ status: 'streaming', generation, window: this.selected, frame, message: '只读实时预览' });
      this.schedule(generation);
    } catch (error) { if (generation === this.generation) this.fail(error); throw error; }
  }
  private fail(error: unknown) {
    clearTimeout(this.timer); this.deps.stop();
    this.update({ status: 'error', generation: this.generation, window: this.selected, message: error instanceof Error ? error.message : '捕获失败' });
  }
  private schedule(generation: number) {
    this.timer = setTimeout(async () => {
      if (generation !== this.generation) return;
      try { const frame = await this.freshFrame();
        if (generation !== this.generation) return;
        this.update({ status: 'streaming', generation, window: this.selected, frame, message: '只读实时预览' }); this.schedule(generation);
      } catch (error) { if (generation === this.generation) this.fail(error); }
    }, 150);
  }
  freshFrame(): Promise<CaptureFrame> {
    const generation = this.generation, selected = this.selected;
    const task = async () => {
      if (!selected || generation !== this.generation || !['starting', 'streaming'].includes(this.state.status)) throw new Error('请先开始窗口预览');
      const ensure = async () => {
        const info = await this.deps.info(selected.id);
        if (generation !== this.generation) throw new Error('窗口选择已改变');
        if (!info || info.identity !== selected.identity) throw new Error('目标窗口已关闭或身份改变，请重新选择');
        if (info.minimized || info.width < 1 || info.height < 1) throw new Error('目标窗口已最小化，请恢复窗口后重新预览');
        this.selected = info;
      };
      await ensure(); let frame: RawFrame;
      try { frame = await this.deps.frame(); }
      catch (error) { await ensure(); throw error; } // Classify close/minimize even if it happened during the frame wait.
      await ensure();
      if (!(frame.sourceMediaTime > frame.barrierMediaTime && frame.presentedFrames > frame.barrierPresentedFrames)) throw new Error('拒绝屏障前的缓存帧');
      if (frame.capturedAt !== null && frame.capturedAt < frame.barrierRequestedAt) throw new Error('拒绝屏障前采集的源帧');
      return { ...frame, sourceId: selected.id, title: this.selected!.title, identity: selected.identity, generation,
        frameSequence: ++this.sequence, clock: 'video-media-time' as const, freshness: 'after-source-barrier' as const };
    };
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  async assertCurrent(sourceId: string, generation: number, identity: string) {
    if (this.state.status !== 'streaming' || this.generation !== generation || this.selected?.id !== sourceId) throw new Error('截图对应的捕获会话已失效，请重新截取');
    const info = await this.deps.info(sourceId);
    if (!info || info.identity !== identity || info.minimized) throw new Error('截图对应窗口已关闭或最小化');
  }
  stop() { ++this.generation; clearTimeout(this.timer); this.deps.stop(); this.selected = undefined; this.update({ status: 'stopped', generation: this.generation, message: '预览已停止' }); }
}
