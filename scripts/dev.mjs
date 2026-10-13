import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildHost, root } from './build.mjs';
console.log('[GamePilot] 正在构建主进程与 preload…');
await buildHost();
const server = await createServer();
await server.listen();
console.log(`[GamePilot] 开发服务已就绪：${server.resolvedUrls.local[0]}`);
const env = { ...process.env, GAMEPILOT_RENDERER_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
// Electron is the user-facing application. Hiding the spawned Windows process
// also hides its main window, even though BrowserWindow defaults to show:true.
const child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit', windowsHide: false });
child.on('spawn', () => console.log(`[GamePilot] 已启动界面，Electron PID：${child.pid}`));
child.on('error', async error => { console.error(`[GamePilot] 界面启动失败：${error.message}`); await server.close(); process.exit(1); });
child.on('exit', async code => { await server.close(); process.exit(code || 0); });
process.on('SIGINT', () => child.kill());
