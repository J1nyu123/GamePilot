// Test-only Electron entry. Not bundled into the production app.
import { app, BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import { registerIpc } from '../src/main/ipc';
import { PythonGamepad, findPython } from '../src/input/python-client';
import type { InputMode } from '../src/contracts/input';
class DryDevice extends PythonGamepad { override start(_mode: InputMode) { return super.start('dry-run'); } }
void app.whenReady().then(async () => {
  const root = process.env.GAMEPILOT_TEST_ROOT!;
  const window = new BrowserWindow({ width: 1440, height: 940, webPreferences: { preload: resolve(root, 'dist/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const services = registerIpc(window, process.env.GAMEPILOT_TEST_STATE_ROOT!, {
    input: { createPad: notify => new DryDevice(findPython(root), resolve(root, 'python/gamepad_service.py'), notify) },
    emergencyShortcut: 'Control+Shift+F12', isForeground: async () => process.env.GAMEPILOT_TEST_FOCUS !== 'lost',
  });
  let closing = false;
  window.on('close', event => {
    if (!closing) {
      event.preventDefault();
      void Promise.allSettled([services.session.close(), services.closeInput()]).finally(() => { services.closeCapture(); closing = true; window.close(); });
    }
  });
  await window.loadFile(resolve(root, 'dist/renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
