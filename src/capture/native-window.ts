import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { GameWindow } from '../contracts/capture';
export function handleFromId(id: string) {
  const match = /^window:(\d+):\d+$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) throw new Error('无效窗口 ID');
  return match[1];
}
export class NativeWindows {
  private child?: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private script: string) {}
  private connect() {
    if (this.child) return;
    if (process.platform !== 'win32') throw new Error('窗口采集当前仅支持 Windows');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', line => {
      let response; try { response = JSON.parse(line); } catch { return; }
      const request = this.pending.get(response.id); if (!request) return;
      clearTimeout(request.timer); this.pending.delete(response.id);
      if (response.ok) request.resolve(response.value); else request.reject(new Error('原生窗口状态查询失败'));
    });
    child.stderr.resume();
    const fail = () => { if (this.child !== child) return; this.child = undefined; for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('窗口状态服务退出')); } this.pending.clear(); };
    child.once('exit', fail); child.once('error', fail);
  }
  private request(op: string, handle?: string, identity?: string): Promise<unknown> {
    this.connect();
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('窗口状态查询超时')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, op, handle, identity }) + '\n');
    });
  }
  async list(): Promise<GameWindow[]> { const rows = await this.request('list'); return Array.isArray(rows) ? rows : rows ? [rows as GameWindow] : []; }
  async info(id: string): Promise<GameWindow | null> { return await this.request('info', handleFromId(id)) as GameWindow | null; }
  async focus(id: string, identity: string) {
    const ok = await this.request('focus', handleFromId(id), identity);
    if (ok !== true) throw new Error('任务已取消并归零，但 Windows 未允许聚焦游戏，请手动切换');
  }
  close() { const child = this.child; this.child = undefined;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('窗口状态服务已停止')); } this.pending.clear();
    child?.stdin.end(); child?.kill(); }
}
