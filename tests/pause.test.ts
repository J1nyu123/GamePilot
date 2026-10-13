import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PauseGate } from '../src/runtime/pause';
import { DebugSession } from '../src/main/session';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImportedImage, RunSummary } from '../src/contracts/debug';

test('pause waits for release, resume starts a fresh segment, parent cancellation remains active', async () => {
  const gate = new PauseGate(), parent = new AbortController(); let calls = 0, neutral = false, parked = false;
  const result = gate.run(parent.signal, async signal => {
    calls++; neutral = false;
    try { await delay(10000, undefined, { signal }); } catch { await delay(15); neutral = true; }
    return 'released';
  }, () => neutral, value => { parked = value; });
  gate.request(); assert.throws(() => gate.resume());
  await delay(30); assert.equal(parked, true); assert.equal(calls, 1);
  gate.resume(); await delay(5); assert.equal(calls, 2); assert.equal(parked, false);
  parent.abort(); await assert.rejects(result, /abort/i);
});
test('failed release cannot enter paused state', async () => {
  const gate = new PauseGate(), parent = new AbortController(); let parked = false;
  const result = gate.run(parent.signal, async signal => { try { await delay(10000, undefined, { signal }); } catch {} throw new Error('reset failed'); }, () => false, () => { parked = true; });
  gate.request(); await assert.rejects(result, /reset failed/); assert.equal(parked, false);
});
test('parent deadline ends a parked task without allowing resume', async () => {
  const gate = new PauseGate(), parent = new AbortController();
  const result = gate.run(parent.signal, async signal => { try { await delay(10000, undefined, { signal }); } catch {} return true; }, () => true, () => {});
  gate.request(); await delay(5); parent.abort(); await assert.rejects(result); assert.throws(() => gate.resume());
});
test('release failure remains failed when cancellation races it', async () => {
  const gate = new PauseGate(), parent = new AbortController();
  const result = gate.run(parent.signal, async signal => { try { await delay(10000, undefined, { signal }); } catch {} throw new Error('release failed'); }, () => false, () => assert.fail('must not pause'));
  parent.abort(); await assert.rejects(result, /release failed/);
});
test('event storage failure aborts the live runner and cannot report success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-p4-log-'));
  const image = { id: 'image', name: 'image.png', mimeType: 'image/png', dataUrl: '' } as ImportedImage;
  const session = new DebugSession(root, async options => {
    // Allow the first append to settle, then inject a filesystem failure for later events.
    await delay(30);
    const path = join(root, session.current!.runId, 'events.jsonl');
    await rm(path); await mkdir(path);
    options.onEvent({ sequence: 1, timestamp: Date.now(), type: 'model_request' });
    try { await delay(10000, undefined, { signal: options.signal }); } catch {}
    return { status: 'protocol_passed', simulated: true, gameOutcome: 'unverified', turns: 1, completedTools: 0, toolErrors: 0, finalText: '' };
  }, () => {});
  try {
    await session.start(image, Buffer.from('test'), 'task', 2000, { baseUrl: 'http://127.0.0.1', apiKey: 'test', modelId: 'test', provider: 'test', configPath: 'test' });
    await session.waitForEnd(); assert.equal(session.current?.status, 'failed'); assert.match(session.current?.summary?.error ?? '', /写入失败/);
  } finally { await session.close(); await rm(root, { recursive: true, force: true }); }
});
test('session preserves run and trace across pause and does not reset total deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-p4-pause-'));
  const image = { id: 'image', name: 'image.png', mimeType: 'image/png', dataUrl: '', source: 'window' } as ImportedImage;
  let calls = 0;
  const summary: RunSummary = { status: 'canceled', simulated: false, gameOutcome: 'unverified', turns: 1, completedTools: 0, toolErrors: 0, finalText: '' };
  const session = new DebugSession(root, async () => summary, () => {});
  try {
    const { runId } = await session.start(image, Buffer.from('test'), 'fixed task', 180, { baseUrl: 'http://127.0.0.1', apiKey: 'test', modelId: 'test', provider: 'test', configPath: 'test' }, {
      simulated: false, goal: { id: 'goal', successCondition: 'fixed' }, runner: async options => {
        calls++; options.onEvent({ sequence: 1, timestamp: Date.now(), type: 'turn_start', turn: 1 });
        try { await delay(10000, undefined, { signal: options.signal }); } catch {}
        options.onEvent({ sequence: 2, timestamp: Date.now(), type: 'input_released', result: { neutral: true } });
        return summary;
      },
    });
    session.pause(runId); while (session.current?.status !== 'paused') await delay(2);
    assert.equal(session.busy, true); session.resume(runId);
    while (calls < 2) await delay(2);
    await session.waitForEnd();
    assert.equal(session.current?.runId, runId); assert.equal(session.current?.summary?.status, 'timed_out');
    assert.deepEqual(session.current?.events.filter(e => e.type === 'turn_start').map(e => e.turn), [1, 2]);
  } finally { await session.close(); await rm(root, { recursive: true, force: true }); }
});
