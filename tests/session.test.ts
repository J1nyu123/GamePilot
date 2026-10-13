import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DebugSession } from '../src/main/session';
import type { AgentEvent, ImportedImage, RunSummary } from '../src/contracts/debug';
import type { ReleaseEvidence } from '../src/contracts/verification';
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
    assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4]);
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

test('real session saves the post-preparation image and keeps real receipts visible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-real-session-'));
  const fresh = { ...image, id: 'fresh', name: 'fresh.jpg', mimeType: 'image/jpeg' as const, source: 'window' as const };
  try {
    const session = new DebugSession(root, async () => { throw new Error('simulation runner must not be used'); }, () => {});
    const { runId } = await session.start(image, Buffer.from('old'), 'task', 1000, config, { simulated: false,
      runner: async (options, replace) => {
        await replace(fresh, Buffer.from('fresh-bytes'));
        options.onEvent({ sequence: 1, timestamp: 1, type: 'input_released', simulated: false });
        return { ...passed, simulated: false, status: 'control_passed' };
      },
    });
    while (session.busy) await delay(5);
    const manifest = JSON.parse(await readFile(join(root, runId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.simulated, false); assert.equal(manifest.input.id, 'fresh');
    assert.equal((await readFile(join(root, runId, 'input.jpg'))).toString(), 'fresh-bytes');
    assert.equal(session.current?.input?.id, 'fresh'); assert.equal(session.current?.status, 'control_passed');
    assert.equal(session.current?.summary?.gameOutcome, 'unverified');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session deadline includes preparation and cannot become control_passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-preparation-timeout-'));
  try {
    const session = new DebugSession(root, async () => passed, () => {});
    await session.start(image, Buffer.from('input'), 'task', 30, config, { simulated: false, runner: async options => {
      await delay(3000, undefined, { signal: options.signal }); return { ...passed, simulated: false, status: 'control_passed' };
    } });
    while (session.busy) await delay(5);
    assert.equal(session.current?.status, 'timed_out'); assert.equal(session.current?.summary?.simulated, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real runner release failure stays failed even when cancellation raced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-reset-failure-'));
  try {
    const session = new DebugSession(root, async () => passed, () => {});
    await session.start(image, Buffer.from('input'), 'task', 1000, config, { simulated: false, runner: async () => { session.cancelActive(); throw new Error('No release ACK'); } });
    while (session.busy) await delay(5);
    assert.equal(session.current?.status, 'failed'); assert.match(session.current?.summary?.error || '', /release ACK/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stop racing with final event publication cannot leave a success summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-final-cancel-'));
  try {
    const session: DebugSession = new DebugSession(root, async () => passed, event => { if (event.type === 'validation_end' && event.summary?.status === 'control_passed') session.cancelActive(); });
    const { runId } = await session.start(image, Buffer.from('input'), 'task', 1000, config, { simulated: false, runner: async () => ({ ...passed, simulated: false, status: 'control_passed' }) });
    while (session.busy) await delay(5);
    assert.equal(session.current?.status, 'canceled');
    assert.equal(JSON.parse(await readFile(join(root, runId, 'summary.json'), 'utf8')).status, 'canceled');
    const disk = (await readFile(join(root, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(disk, session.current?.events); assert.equal(disk.at(-1)?.summary?.status, 'canceled');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verified trace keeps original input, key screenshots, immutable goal and image references only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-goal-trace-'));
  const release: ReleaseEvidence = { id: 'release', receipt: { ok: true, neutral: true }, sourceId: 'window:1:0', identity: 'same', captureGeneration: 1, receivedAt: 1, order: 'release-ack-then-capture' };
  try {
    const session = new DebugSession(root, async () => passed, () => {});
    const { runId } = await session.start(image, Buffer.from('staged'), 'task', 1000, config, { simulated: false, goal: { id: 'goal', successCondition: 'visible test-secret goal' },
      runner: async (options, replace, trace) => {
        await replace({ ...image, id: 'before' }, Buffer.from('before-bytes'));
        await trace.saveObservation({ ...image, id: 'after' }, Buffer.from('after-bytes'), release);
        options.onEvent({ type: 'tool_execution_end', sequence: 1, timestamp: 1, isError: false, result: { content: [{ type: 'image', data: 'BASE64-DO-NOT-LOG', mimeType: 'image/png' }], details: { observationId: 'after' } } });
        return { ...passed, simulated: false, status: 'succeeded', gameOutcome: 'passed' };
      },
    });
    while (session.busy) await delay(5);
    const manifest = JSON.parse(await readFile(join(root, runId, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.input.id, 'before'); assert.equal(manifest.observations.length, 2);
    assert.equal(manifest.goal.successCondition, 'visible [REDACTED] goal');
    assert.equal((await readFile(join(root, runId, 'input.png'))).toString(), 'before-bytes');
    assert.equal((await readFile(join(root, runId, 'observations/after.png'))).toString(), 'after-bytes');
    const events = await readFile(join(root, runId, 'events.jsonl'), 'utf8'); assert.ok(!events.includes('BASE64-DO-NOT-LOG'));
    assert.equal(session.current?.input?.id, 'before'); assert.equal(session.current?.observations?.length, 2);
    assert.equal(session.current?.status, 'blocked'); // A runner's success claim without independent verification is insufficient.
    assert.equal(session.current?.summary?.gameOutcome, 'inconclusive');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancellation during goal-success publication clears accepted completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gamepilot-goal-cancel-'));
  try {
    const session: DebugSession = new DebugSession(root, async () => passed, event => { if (event.summary?.status === 'succeeded') session.cancelActive(); });
    await session.start(image, Buffer.from('input'), 'task', 1000, config, { simulated: false, runner: async () => ({ ...passed, status: 'succeeded', simulated: false, gameOutcome: 'passed' }) });
    while (session.busy) await delay(5);
    assert.equal(session.current?.status, 'canceled'); assert.equal(session.current?.summary?.gameOutcome, 'unverified');
  } finally { await rm(root, { recursive: true, force: true }); }
});
