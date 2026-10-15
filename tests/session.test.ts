import test from 'node:test';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DebugSession } from '../src/runtime/session';
import type { AgentEvent, ImportedImage, RunSummary } from '../src/contracts/debug';
const image: ImportedImage = { id: 'image', name: 'input.png', path: 'input.png', importedAt: 1, width: 1, height: 1, size: 1, mimeType: 'image/png', dataUrl: '' };
const config = { baseUrl: 'http://127.0.0.1/v1', apiKey: 'test-secret', modelId: 'test', provider: 'local', configPath: 'config' };
const passed: RunSummary = { status: 'protocol_passed', simulated: true, gameOutcome: 'unverified', turns: 2, completedTools: 1, toolErrors: 0, finalText: 'Simulation only' };
test('session produces the same ordered events for UI and disk; retains completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-session-')), events: AgentEvent[] = [];
  try {
    const session = new DebugSession(root, async options => {
      options.onEvent({ sequence: 1, timestamp: 1, type: 'turn_start', turn: 1 });
      options.onEvent({ sequence: 2, timestamp: 2, type: 'model_text', turn: 1, text: 'Echo test-secret' });
      return passed;
    }, event => events.push(event));
    const { runId } = await session.start(image, Buffer.from('input'), 'task', 1000, config);
    await session.close();
    const disk = (await readFile(join(root, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(disk, events);
    assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4, 5]);
    assert.ok(!JSON.stringify(events).includes('test-secret'));
    assert.equal(session.current?.status, 'canceled'); // close cancels even at a completion race
    assert.ok(session.current?.events.length);
    assert.equal(session.runDirectory('../../other'), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('concurrent start is rejected and active request cancellation settles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-cancel-'));
  try {
    const session = new DebugSession(root, async options => {
      try { await delay(2000, undefined, { signal: options.signal }); }
      catch { return { ...passed, status: 'canceled', completedTools: 0 }; }
      return passed;
    }, () => {});
    const pending = session.start(image, Buffer.from('input'), 'task', 1000, config);
    await assert.rejects(session.start(image, Buffer.from('input'), 'second', 1000, config), /已有运行/);
    const { runId } = await pending;
    session.cancel(runId); await session.close();
    assert.equal(session.current?.status, 'canceled'); assert.equal(session.busy, false);
    assert.equal(session.current?.summary?.completedTools, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancellation racing with completion publication is reflected in UI, events and saved summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-publish-'));
  const events: AgentEvent[] = [];
  const session = new DebugSession(root, async () => passed, event => {
    events.push(event);
    if (event.type === 'validation_end' && event.summary?.status === 'protocol_passed') session.cancelActive();
  });
  try {
    const { runId } = await session.start(image, Buffer.from('input'), 'task', 1000, config);
    await session.waitForEnd();
    assert.equal(session.current?.status, 'canceled');
    assert.equal(JSON.parse(await readFile(join(root, runId, 'summary.json'), 'utf8')).status, 'canceled');
    const disk = (await readFile(join(root, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    assert.deepEqual(disk, events); assert.equal(disk.at(-1)?.summary?.status, 'canceled');
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const file of ['events.jsonl', 'summary.json']) test(`${file} write failure stops the session without reporting success`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-record-error-'));
  const session = new DebugSession(root, async () => passed, event => {
    if (event.type === 'user_message') mkdirSync(join(root, event.runId, file));
  });
  try {
    await session.start(image, Buffer.from('input'), 'task', 1000, config); await session.waitForEnd();
    assert.equal(session.current?.status, 'failed'); assert.equal(session.busy, false);
    assert.match(session.current?.summary?.error ?? '', /写入失败/);
    assert.equal(session.current?.events.at(-1)?.summary?.status, 'failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
