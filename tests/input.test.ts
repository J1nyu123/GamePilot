import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import { PythonGamepad, findPython } from '../src/input/python-client';
import { ManualInputController } from '../src/input/manual-controller';
import { toPadAction } from '../src/input/skills';
import type { InputMode, InputReply } from '../src/contracts/input';
const root = resolve('.'), python = findPython(root), script = resolve('python/gamepad_service.py');
const move = (durationMs = 20) => ({ buttons: [], durationMs, leftStick: { x: -.5, y: 0 } });
function waiter() {
  const history: InputReply[] = [], pending: { predicate: (v: InputReply) => boolean; resolve(v: InputReply): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }[] = [];
  return {
    history, notify(reply: InputReply) { history.push(reply); for (const item of [...pending]) if (item.predicate(reply)) { clearTimeout(item.timer); pending.splice(pending.indexOf(item), 1); item.resolve(reply); } },
    wait(predicate: (v: InputReply) => boolean, timeout = 4000) {
      const previous = history.find(predicate); if (previous) return Promise.resolve(previous);
      return new Promise<InputReply>((resolveValue, reject) => { const item = { predicate, resolve: resolveValue, reject, timer: setTimeout(() => { pending.splice(pending.indexOf(item), 1); reject(new Error('Protocol event timeout')); }, timeout) }; pending.push(item); });
    },
  };
}
test('skill boundary maps axes and rejects invalid durations/buttons', () => {
  assert.deepEqual(toPadAction({ skill: 'move_for', direction: 'left', strength: .5, durationMs: 200 }), move(200));
  assert.throws(() => toPadAction({ skill: 'move_for', direction: 'left', strength: NaN, durationMs: 200 }));
  assert.throws(() => toPadAction({ skill: 'press_button', button: 'BAD' as 'A', durationMs: 200 }));
  assert.throws(() => toPadAction({ skill: 'press_button', button: 'A', durationMs: 2000 }));
});
test('persistent Python service executes repeated bounded actions and resets after each', async () => {
  const events = waiter(), client = new PythonGamepad(python, script, events.notify);
  try {
    await client.start('dry-run'); const lease = await client.begin('continuous');
    for (let i = 0; i < 8; i++) { const reply = await client.execute(lease, [move()]); assert.equal(reply.status, 'executed'); assert.equal(reply.neutral, true); }
    const status = await client.request('status'); assert.equal(status.appliedCount, 8); assert.equal(status.neutral, true);
  } finally { await client.dispose(); }
});
test('cancel while long action runs discards queued actions and rejects old generation', async () => {
  const events = waiter(), client = new PythonGamepad(python, script, events.notify);
  try {
    await client.start('dry-run'); const lease = await client.begin('cancel');
    const running = client.execute(lease, [move(1500), move(200)]);
    await events.wait(e => e.event === 'action_start' && e.runId === 'cancel');
    const queued = client.execute(lease, [move(200)]);
    await events.wait(e => e.event === 'queued' && e.runId === 'cancel' && e.id !== events.history.find(x => x.event === 'action_start')?.id);
    const reset = await client.reset(); assert.equal(reset.neutral, true);
    assert.equal((await running).status, 'cancelled'); assert.equal((await queued).status, 'cancelled');
    assert.equal((await client.request('status')).appliedCount, 1);
    assert.equal((await client.execute(lease, [move()])).ok, false);
    const fresh = await client.begin('new'); assert.ok(fresh.generation > lease.generation);
    assert.equal((await client.execute(fresh, [move()])).status, 'executed');
  } finally { await client.dispose(); }
});
test('20 independent cancels measure reset acknowledgement RTT (dry-run)', async () => {
  const events = waiter(), client = new PythonGamepad(python, script, events.notify), samples: number[] = [];
  try {
    await client.start('dry-run');
    for (let i = 0; i < 20; i++) {
      const runId = `latency-${i}`, lease = await client.begin(runId), action = client.execute(lease, [move(1500)]);
      await events.wait(e => e.event === 'action_start' && e.runId === runId);
      const reset = await client.reset(); samples.push(reset.cancelAckMs); assert.equal((await action).status, 'cancelled');
    }
    const sorted = [...samples].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
    assert.ok(p95 <= 500, `dry-run reset P95 ${p95}ms`);
    await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/input-cancel-latency.json', JSON.stringify({ mode: 'dry-run', measurement: 'Main request to Python neutral-reset ACK', samplesMs: samples, p95Ms: p95, physicalDriverLatencyVerified: false }, null, 2));
  } finally { await client.dispose(); }
});
test('manual controller only reports cancellation after neutral reset ACK', async () => {
  const states: string[] = [], controller = new ManualInputController(python, script, state => states.push(state.status));
  try {
    await controller.connect('dry-run'); await controller.execute({ skill: 'move_for', direction: 'left', strength: .5, durationMs: 1500 });
    await new Promise<void>((resolveWait, reject) => { const timer = setInterval(() => { if (controller.state.status === 'executing') { clearInterval(timer); clearTimeout(timeout); resolveWait(); } }, 5); const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('manual action did not start')); }, 2000); });
    await controller.stop(); assert.equal(controller.state.neutral, true); assert.equal(controller.state.lastResult?.status, 'cancelled');
    assert.ok(states.includes('resetting')); assert.ok(typeof controller.state.cancelAckMs === 'number');
  } finally { await controller.disconnect(); }
});
test('heartbeat loss interrupts input; EOF resets and terminates the service', async () => {
  for (const reason of ['watchdog', 'eof']) {
    const events = waiter(), child = spawn(python, ['-u', script, '--dry-run'], { windowsHide: true, stdio: 'pipe' });
    child.stderr.resume(); createInterface({ input: child.stdout }).on('line', line => events.notify(JSON.parse(line)));
    const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
    try {
      await events.wait(e => e.event === 'ready'); send({ id: 'begin', op: 'begin', runId: reason });
      const lease = await events.wait(e => e.id === 'begin');
      send({ id: 'action', op: 'execute_sequence', runId: reason, generation: lease.generation, actions: [move(1500), move(1500)] });
      await events.wait(e => e.event === 'action_start');
      if (reason === 'eof') child.stdin.end();
      else { const reset = await events.wait(e => e.event === 'watchdog'); assert.equal(reset.neutral, true); }
      const final = await events.wait(e => e.id === 'action' && !e.event); assert.equal(final.status, 'cancelled'); assert.equal(final.neutral, true);
    } finally { child.stdin.end(); await new Promise<void>(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once('exit', () => resolveExit()); }); }
  }
});
test('real-mode focus guard failure cancels and releases via injected dry-run device', async () => {
  class DryDevice extends PythonGamepad { override start(_mode: InputMode) { return super.start('dry-run'); } }
  const controller = new ManualInputController(python, script, () => {}, {
    createPad: notify => new DryDevice(python, script, notify), prepareMs: 0, guardIntervalMs: 10,
  });
  let checks = 0;
  try {
    await controller.connect('virtual-xbox');
    await controller.execute({ skill: 'move_for', direction: 'left', strength: .5, durationMs: 1500 }, async () => {
      if (++checks > 1) throw new Error('window lost focus');
    });
    await new Promise<void>((resolveWait, reject) => { const interval = setInterval(() => { if (controller.state.lastResult?.status === 'cancelled') { clearInterval(interval); clearTimeout(timeout); resolveWait(); } }, 5); const timeout = setTimeout(() => { clearInterval(interval); reject(new Error('guard failed to cancel')); }, 2000); });
    assert.equal(controller.state.neutral, true); assert.equal(controller.state.stopReason, 'window lost focus');
  } finally { await controller.disconnect(); }
});
test('late focus failure from a finished generation cannot stop a new input', async () => {
  class DryDevice extends PythonGamepad { override start(_mode: InputMode) { return super.start('dry-run'); } }
  const controller = new ManualInputController(python, script, () => {}, { createPad: notify => new DryDevice(python, script, notify), prepareMs: 0, guardIntervalMs: 1 });
  let rejectOld!: (error: Error) => void, checked = 0;
  const waitFinished = async () => { while (controller.busy) await new Promise(r => setTimeout(r, 5)); };
  try {
    await controller.connect('virtual-xbox');
    await controller.execute({ skill: 'move_for', direction: 'left', strength: .5, durationMs: 50 }, async () => {
      if (++checked > 1) await new Promise<void>((_, reject) => { rejectOld = reject; });
    });
    await waitFinished(); assert.ok(rejectOld);
    await controller.execute({ skill: 'move_for', direction: 'right', strength: .5, durationMs: 50 }, async () => {});
    rejectOld(new Error('stale focus failure')); await waitFinished();
    assert.equal(controller.state.lastResult?.status, 'executed'); assert.equal(controller.state.neutral, true);
  } finally { await controller.disconnect(); }
});
test('Python termination rejects pending input and never fabricates a reset ACK', async () => {
  const events = waiter(), client = new PythonGamepad(python, script, events.notify);
  try {
    await client.start('dry-run'); const lease = await client.begin('process-exit');
    const pending = client.execute(lease, [move(1500)]);
    await events.wait(e => e.event === 'action_start' && e.runId === lease.runId);
    process.kill(client.pid!);
    await assert.rejects(pending, /退出/);
    assert.equal(client.connected, false);
    await assert.rejects(client.reset());
    assert.ok(!events.history.some(e => e.runId === lease.runId && e.status === 'executed'));
  } finally { await client.dispose().catch(() => {}); }
});

test('concurrent shutdown callers share one disconnect and do not race a second reset', async () => {
  const states: string[] = [], controller = new ManualInputController(python, script, state => states.push(state.message));
  await controller.connect('dry-run');
  await controller.execute({ skill: 'move_for', direction: 'left', strength: .5, durationMs: 1500 });
  const first = controller.disconnect(), second = controller.disconnect();
  assert.equal(first, second); await Promise.all([first, second]);
  assert.equal(controller.state.status, 'disconnected');
  assert.ok(!states.some(state => state.includes('停止失败') || state.includes('复位未确认')));
});
