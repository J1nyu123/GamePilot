/** A pause aborts one execution segment, never the task's deadline or budget. */
export class PauseGate {
  private segment?: AbortController;
  private requested = false;
  private wake?: () => void;
  private parked = false;
  request() {
    if (!this.segment || this.requested) throw new Error('当前阶段不能暂停');
    this.requested = true; this.segment.abort();
  }
  resume() {
    if (!this.parked || !this.wake) throw new Error('尚未确认归零，不能恢复');
    this.requested = false; this.wake();
  }
  async run<T>(parent: AbortSignal, work: (signal: AbortSignal) => Promise<T>,
    released: (result: T | undefined, error: unknown) => boolean, state: (paused: boolean) => void): Promise<T> {
    try {
      for (;;) {
        parent.throwIfAborted(); this.segment = new AbortController();
        let result: T | undefined, failure: unknown;
        try { result = await work(AbortSignal.any([parent, this.segment.signal])); }
        catch (error) { failure = error; }
        if (parent.aborted) {
          if (failure && !(failure instanceof Error && failure.name === 'AbortError')) throw failure;
          if (result !== undefined && !released(result, failure)) return result;
          parent.throwIfAborted();
        }
        if (!this.requested || !released(result, failure)) {
          if (failure) throw failure;
          return result!;
        }
        this.parked = true;
        await new Promise<void>((resolve, reject) => {
          const abort = () => { cleanup(); reject(new DOMException('Task stopped', 'AbortError')); };
          const cleanup = () => { parent.removeEventListener('abort', abort); this.wake = undefined; };
          this.wake = () => { cleanup(); resolve(); };
          parent.addEventListener('abort', abort, { once: true });
          state(true);
          if (parent.aborted) abort();
        });
        this.parked = false; state(false);
      }
    } finally { this.segment = undefined; this.wake = undefined; this.parked = false; this.requested = false; }
  }
}
