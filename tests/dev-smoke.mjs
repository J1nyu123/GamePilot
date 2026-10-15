import { createServer } from 'vite';
import { _electron as electron, expect } from '@playwright/test';
// An isolated ephemeral port lets this test coexist with a user's dev window.
const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const env = { ...process.env, GAMEPILOT_RENDERER_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: /^GamePilot/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /选择 PNG/ })).toBeVisible();
  await expect(page.locator('.config-message')).not.toHaveText('正在读取模型配置…');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  if (!csp.includes("script-src 'self' 'unsafe-inline'")) throw new Error('React development preamble CSP missing');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Electron + Vite development startup passed, including React HMR preamble and preload bridge.');
} finally { await app?.close(); await server.close(); }
