import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InputMode, InputReply, Lease, PadAction } from '../contracts/input';
export function findPython(root: string) {
  if (process.env.GAMEPAD_PYTHON) return process.env.GAMEPAD_PYTHON;
  const local = resolve(root, '../GamePilot-input-test/.venv/Scripts/python.exe');
  return existsSync(local) ? local : 'python';
}
export class PythonGamepad {
  private child?: ChildProcessWithoutNullStreams;
  private heartbeat?: ReturnType<typeof setInterval>;
  private serial = 0;
  private pending = new Map<string, { resolve(reply: InputReply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private fault?: Error;
  private closing = false;
  constructor(private python: string, private script: string, private notify: (reply: InputReply) => void = () => {}) {}
  get connected() { return Boolean(this.child && !this.fault); }
  get pid() { return this.child?.pid; }
  async start(mode: InputMode) {
    if (this.child) throw new Error('手柄服务已经连接');
    this.fault = undefined; this.closing = false;
    const child = spawn(this.python, ['-u', this.script, ...(mode === 'dry-run' ? ['--dry-run'] : [])], { windowsHide: true, stdio: 'pipe' });
    this.child = child; child.stderr.resume();
    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => { fail(new Error('Python 手柄启动超时')); child.kill(); }, 12000);
      const fail = (error: Error) => { clearTimeout(timer); this.fail(error); rejectReady(error); };
      child.on('error', () => fail(new Error('无法启动 Python，请检查 GAMEPAD_PYTHON')));
      child.stdin.on('error', () => fail(new Error('Python 输入通道已断开')));
      child.on('exit', () => { if (this.child === child) { this.child = undefined; fail(new Error(this.closing ? '手柄服务已断开' : 'Python 手柄服务意外退出')); } });
      createInterface({ input: child.stdout }).on('line', line => {
        let reply: InputReply; try { reply = JSON.parse(line); } catch { fail(new Error('Python 返回了无效协议')); child.kill(); return; }
        this.notify(reply);
        if (reply.event === 'ready') {
          if (reply.protocol !== 2 || reply.backend !== mode || reply.neutral !== true) { fail(new Error('手柄协议或初始复位无效')); child.kill(); return; }
          clearTimeout(timer); resolveReady(); return;
        }
        if (reply.event === 'fatal') { fail(new Error(reply.error || '手柄设备失败')); child.kill(); return; }
        if (reply.event) return;
        if (reply.id) { const pending = this.pending.get(reply.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(reply.id); pending.resolve(reply); }
      });
    });
    this.heartbeat = setInterval(() => { void this.request('ping', {}, 1500).catch(error => { this.fail(error); this.child?.kill(); }); }, 500);
  }
  private fail(error: Error) {
    this.fault = error; clearInterval(this.heartbeat);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
    if (!this.closing) this.notify({ event: 'connection_error', error: error.message, neutral: false });
  }
  request(op: string, data: Record<string, unknown> = {}, timeoutMs = 6000): Promise<InputReply> {
    if (this.fault || !this.child?.stdin.writable) return Promise.reject(this.fault || new Error('手柄服务未连接'));
    const id = String(++this.serial);
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); const error = new Error(`手柄 ${op} 超时，复位状态未知`); reject(error);
        this.fail(error); this.child?.kill(); }, timeoutMs);
      this.pending.set(id, { resolve: resolveReply, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...data, id, op }) + '\n');
    });
  }
  async begin(runId: string): Promise<Lease> {
    const reply = await this.request('begin', { runId });
    if (!reply.ok || reply.neutral !== true || !Number.isInteger(reply.generation)) throw new Error(reply.error || '控制租约申请失败');
    return { runId, generation: reply.generation! };
  }
  execute(lease: Lease, actions: PadAction[]) { return this.request('execute_sequence', { ...lease, actions }); }
  async reset(): Promise<InputReply & { cancelAckMs: number }> {
    const before = performance.now(); const reply = await this.request('reset', {}, 2000);
    if (!reply.ok || reply.neutral !== true) throw new Error(reply.error || '没有获得输入归零确认');
    return { ...reply, cancelAckMs: performance.now() - before };
  }
  async dispose() {
    const child = this.child; if (!child) return;
    this.closing = true; clearInterval(this.heartbeat);
    let error: unknown;
    try {
      const reply = await this.request('shutdown', {}, 2000);
      if (!reply.ok || reply.neutral !== true) throw new Error(reply.error || '服务退出前复位失败');
    } catch (failure) { error = failure; }
    finally { child.stdin.end();
      await Promise.race([new Promise<void>(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once('exit', () => resolveExit()); }), new Promise<void>(resolveTimeout => setTimeout(resolveTimeout, 1000))]);
      if (child.exitCode === null) child.kill();
      this.child = undefined; this.fail(new Error('手柄服务已断开')); }
    if (error) throw error;
  }
}
