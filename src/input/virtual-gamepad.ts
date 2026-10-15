import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleFromId } from '../capture/native-window';

export class VirtualGamepad {
  private child?: ChildProcessWithoutNullStreams;
  private connecting?: Promise<void>;
  private sequence = 0;
  private pending?: { id: number; resolve(value: unknown): void; reject(error: Error): void };
  get connected() { return Boolean(this.child && !this.connecting); }
  constructor(private root: string) {}
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.child) return;
    const python = process.env.GAMEPILOT_PYTHON || resolve(this.root, '.venv/Scripts/python.exe');
    if (!existsSync(python)) throw new Error('未找到手柄 Python 环境，请运行 scripts/setup-gamepad.ps1');
    const child = spawn(python, ['-u', resolve(this.root, 'dist/capture/virtual-gamepad.py')], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    this.connecting = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => { child.kill(); fail(new Error('虚拟手柄连接超时')); }, 10000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? fail(error) : done(); };
      child.stderr.resume(); child.stdin.on('error', () => {});
      createInterface({ input: child.stdout }).on('line', line => {
        let value; try { value = JSON.parse(line); } catch { return; }
        if ('ready' in value) { finish(value.ready ? undefined : new Error(`虚拟手柄连接失败：${value.error}；请检查 ViGEmBus 与 vgamepad`)); return; }
        if (!this.pending || this.pending.id !== value.id) return;
        const pending = this.pending; this.pending = undefined;
        if (value.ok) pending.resolve(value); else pending.reject(new Error(value.error));
      });
      const exit = (error: Error) => {
        if (this.child === child) { this.child = undefined; this.pending?.reject(error); this.pending = undefined; }
        finish(error);
      };
      child.once('error', exit);
      child.once('exit', () => exit(new Error('虚拟手柄服务已退出')));
    }).catch(error => { child.kill(); if (this.child === child) this.child = undefined; throw error; }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  async action(sourceId: string, identity: string, action: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); await this.connect(); signal.throwIfAborted();
    if (this.pending) throw new Error('虚拟手柄正在执行动作');
    const child = this.child!, id = ++this.sequence;
    const cancel = () => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ op: 'cancel' }) + '\n'); };
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => child.kill(), 4000); // Disconnecting the client removes its virtual device.
    try {
      const result = await new Promise<unknown>((resolveResult, reject) => {
        this.pending = { id, resolve: resolveResult, reject };
        child.stdin.write(JSON.stringify({ id, op: 'action', handle: handleFromId(sourceId), pid: identity.split(':')[1], action }) + '\n');
        if (signal.aborted) cancel();
      });
      signal.throwIfAborted(); return result;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  async close() {
    const child = this.child;
    if (!child) return;
    await new Promise<void>(done => {
      const timer = setTimeout(() => child.kill(), 1500);
      child.once('exit', () => { clearTimeout(timer); done(); });
      if (!child.stdin.destroyed) child.stdin.end(JSON.stringify({ op: 'close' }) + '\n');
    });
  }
}
