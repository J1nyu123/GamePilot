import { spawn } from 'node:child_process';
import { validateKeys } from '../agent/game-loop';
import { handleFromId } from '../capture/native-window';

/** Cancellation is delivered over stdin; the child releases keys in finally before exiting. */
export function sendGameKeys(script: string, sourceId: string, identity: string, keys: string[], durationMs: number, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted(); validateKeys(keys, durationMs);
  const handle = handleFromId(sourceId);
  if (process.platform !== 'win32') throw new Error('真实键盘输入需要 Windows');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: 'pipe' });
    let output = '', errors = '', expired = false;
    const cancel = () => { if (!child.stdin.destroyed) child.stdin.end('cancel\n'); };
    const timer = setTimeout(() => { expired = true; cancel(); }, 15000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    signal.addEventListener('abort', cancel, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', () => {
      cleanup();
      if (signal.aborted) { reject(signal.reason); return; }
      if (expired) { reject(new Error('键盘服务超时')); return; }
      try { const result = JSON.parse(output.trim()); if (!result.ok) throw new Error(result.error); resolve(result); }
      catch (error) { reject(new Error(`键盘执行失败: ${errors || String(error)}`)); }
    });
    child.stdin.write(JSON.stringify({ handle, identity, keys, durationMs }) + '\n');
    if (signal.aborted) cancel();
  });
}
