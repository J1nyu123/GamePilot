import { build } from 'esbuild';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'capture-request-')), result = join(temp, 'result.json');
const env = { ...process.env, GAMEPILOT_TEST_ROOT: resolve('.'), GAMEPILOT_TEST_RESULT: result }; delete env.ELECTRON_RUN_AS_NODE;
await build({ entryPoints: ['tests/capture-request-entry.ts'], outfile: join(temp, 'index.mjs'), platform: 'node', format: 'esm', bundle: true, external: ['electron'] });
await writeFile(join(temp, 'package.json'), JSON.stringify({ type: 'module', main: 'index.mjs' }));
await mkdir(join(temp, 'target'));
await writeFile(join(temp, 'target/package.json'), JSON.stringify({ main: 'index.cjs' }));
await writeFile(join(temp, 'target/index.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:480,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(join(temp, 'target/page.html'))});});app.on('window-all-closed',()=>app.quit());`);
await writeFile(join(temp, 'target/page.html'), '<html><head><title>Capture cancellation fixture (not game)</title></head><body><canvas id="c" width="600" height="400"></canvas><script>let n=0;setInterval(()=>{const g=document.getElementById("c").getContext("2d");g.fillStyle="blue";g.fillRect(0,0,600,400);g.fillStyle="white";g.fillRect(n++%500,10,60,60)},100)</script></body></html>');
let app, target;
try {
  target = await electron.launch({ args: [join(temp, 'target')], env, timeout: 30000 }); await target.firstWindow();
  env.GAMEPILOT_TEST_SOURCE_ID = await target.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0].getNativeWindowHandle(); return `window:${b.length >= 8 ? b.readBigUInt64LE().toString() : b.readUInt32LE()}:0`; });
  app = await electron.launch({ args: [temp], env, timeout: 30000 });
  let report;
  await expect.poll(async () => { try { report = JSON.parse(await readFile(result, 'utf8')); return true; } catch { return false; } }, { timeout: 20000 }).toBe(true);
  assert.equal(report.passed, true, report.error);
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/capture-request-check.json', JSON.stringify(report, null, 2));
  console.log('Native capture cancellation passed: pending frame and initialization reject on stop; restart yields fresh source frame.');
} finally { await app?.close().catch(() => {}); await target?.close(); await rm(temp, { recursive: true, force: true }); }
