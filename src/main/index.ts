import { app, BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';
import type { DebugSession } from './session';

let window: BrowserWindow | null = null, session: DebugSession | undefined, exiting = false;
let closeCapture = () => {};
let closeInput = async () => {}, inputActive = () => false;
app.setName('GamePilot');
// Do not await readiness at ESM module scope: Electron must finish loading its
// entry module before it emits ready.
void app.whenReady().then(async () => {
window = new BrowserWindow({ title: 'GamePilot · 模型调试台', width: 1440, height: 940, minWidth: 640, minHeight: 680,
  backgroundColor: '#101318', autoHideMenuBar: true,
  webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true },
});
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
const services = registerIpc(window, app.getAppPath()); session = services.session; closeCapture = services.closeCapture; closeInput = services.closeInput; inputActive = services.inputBusy;
window.on('close', event => {
  closeCapture();
  if ((session?.busy || inputActive()) && !exiting) { event.preventDefault(); void Promise.allSettled([session?.close(), closeInput()]).finally(() => { exiting = true; window?.close(); }); }
});
app.on('before-quit', event => {
  closeCapture();
  if ((session?.busy || inputActive()) && !exiting) { event.preventDefault(); void Promise.allSettled([session?.close(), closeInput()]).finally(() => { exiting = true; app.quit(); }); }
});
app.on('window-all-closed', () => app.quit());
if (process.env.GAMEPILOT_RENDERER_URL) {
  const url = new URL(process.env.GAMEPILOT_RENDERER_URL);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('无效本地开发地址');
  await window.loadURL(url.href);
} else await window.loadFile(resolve(app.getAppPath(), 'dist/renderer/index.html'));
}).catch(error => { console.error('GamePilot startup failed:', error instanceof Error ? error.message : 'unknown'); app.exit(1); });
