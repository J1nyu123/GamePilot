import test from 'node:test';
import assert from 'node:assert/strict';
import { ApproachTarget, type ApproachDependencies } from '../src/skills/approach-target';
import { TargetEstimator, parseDetection } from '../src/state/target-estimator';
import { normalizeApproach, type Box, type TargetDetection } from '../src/contracts/approach';
import type { AgentEvent, ImportedImage } from '../src/contracts/debug';

export const image = (n: number): ImportedImage => ({ id: `f-${n}`, name: 'fixture', path: '', importedAt: 1, mimeType: 'image/png', width: 1, height: 1, size: 1, dataUrl: 'data:image/png;base64,eA==', source: 'window', evidence: {
  sourceId: 'window:1:0', title: 'fixture', identity: 'same', generation: 1, frameSequence: n, sourceMediaTime: n, presentedFrames: n,
  barrierMediaTime: n - .1, barrierPresentedFrames: n - 1, barrierRequestedAt: n * 100, capturedAt: n * 100 + 1, receivedAt: n * 100 + 2, clock: 'video-media-time', freshness: 'after-source-barrier' } });
const spec = normalizeApproach({ description: 'unique pillar', region: [.35,.2,.3,.65], minArea: .06 });
export const detection = (box: Box = [.375,.3,.25,.3]): TargetDetection => ({ mode: 'gameplay', visible: true, sameTarget: true, sceneStable: true, pathClear: true, box, confidence: .95, facts: ['same unique pillar'] });
function setup(boxes: TargetDetection[] = [detection([.15,.3,.1,.2]), detection([.4,.3,.2,.2]), detection(), detection()], requireInteraction = false) {
  const parent = new AbortController(), events: Partial<AgentEvent>[] = [], moves: string[] = [];
  let clock = 0, frame = 1, calls = 0, stops = 0, saves = 0;
  const receipt = { ok: true, status: 'executed' as const, neutral: true };
  const deps: ApproachDependencies = {
    execute: async (skill, beforeSend) => { beforeSend(); moves.push(skill.skill === 'move_for' ? skill.direction : 'button'); return receipt; },
    neutral: async () => receipt, stop: async () => { stops++; },
    capture: async () => { clock += 400; return image(++frame); }, save: async () => { saves++; },
    tracker: new TargetEstimator(async () => JSON.stringify(boxes[Math.min(calls++, boxes.length - 1)])),
    emit: (type, fields) => events.push({ type, ...fields }), now: () => clock,
  };
  const skill = new ApproachTarget({ ...spec, requireInteraction }, image(1), parent.signal, deps);
  let result: Awaited<ReturnType<ApproachTarget['execute']>>;
  return { result: () => result, skill, deps, parent, events, moves, advance: (ms: number) => { clock += ms; }, counts: () => ({ stops, saves }), run: async () => { result = await skill.execute({ targetId: spec.targetId, observationId: 'f-1' }, undefined, 'tool'); return result; } };
}
test('feedback changes left to forward from new frames and reports a stable arrival candidate without final verification', async () => {
  const f = setup(); await f.run();
  assert.deepEqual(f.moves, ['left', 'forward']); assert.equal(f.result().arrivalCandidate, true);
  assert.equal(f.skill.stats.corrections, 1); assert.equal(f.skill.stats.trackingCalls, 4);
  assert.equal(f.events.filter(e => e.type === 'approach_input').length, 2);
  assert.equal(f.events.filter(e => e.type === 'verification_start').length, 0);
  assert.equal(f.events.filter(e => e.type === 'tracking_state').at(-1)?.observationId, 'f-5');
});
for (const [name, override, reason] of [
  ['lost', { visible: false, sameTarget: false, box: null }, 'target-lost'],
  ['identity', { sameTarget: false }, 'target-lost'],
  ['confidence', { confidence: .2 }, 'low-confidence'],
  ['scene', { sceneStable: false }, 'scene-changed'],
  ['menu', { mode: 'menu' }, 'scene-changed'],
  ['path', { pathClear: false }, 'path-unclear'],
] as const) test(`${name}: stops without input and does not reuse previous coordinates`, async () => {
  const f = setup([{ ...detection(), ...override } as TargetDetection]); await f.run();
  assert.equal(f.moves.length, 0); assert.equal(f.skill.stats.stopReason, reason); assert.equal(f.result().status, 'blocked');
});
test('target loss after an executed step prevents every subsequent step', async () => {
  const f = setup([detection([.15,.3,.1,.2]), { ...detection(), visible: false, box: null }]); await f.run();
  assert.deepEqual(f.moves, ['left']); assert.equal(f.skill.stats.stopReason, 'target-lost');
});
test('a late tracker result is stale from the observation request, not fresh from response time', async () => {
  const f = setup(); f.deps.tracker = new TargetEstimator(async () => { f.advance(8000); return JSON.stringify(detection()); });
  await f.run(); assert.equal(f.skill.stats.stopReason, 'stale-state'); assert.equal(f.moves.length, 0);
});
test('state expiring during asynchronous focus guard is rejected immediately before send', async () => {
  const f = setup(); let sent = false;
  f.deps.execute = async (_skill, beforeSend) => { f.advance(8000); beforeSend(); sent = true; return { ok: true, neutral: true }; };
  await f.run(); assert.equal(sent, false); assert.equal(f.skill.stats.stopReason, 'stale-state'); assert.equal(f.skill.stats.executedSteps, 0);
});
test('old frame cannot reach tracker or move', async () => {
  const f = setup(); f.deps.capture = async () => image(1); await f.run();
  assert.equal(f.skill.stats.trackingCalls, 0); assert.equal(f.skill.stats.stopReason, 'invalid-frame'); assert.equal(f.counts().saves, 0);
});
test('unconfirmed release fails before capture, never returns passed', async () => {
  const f = setup(); f.deps.neutral = async () => ({ ok: false, neutral: false });
  await assert.rejects(f.run(), /释放未确认/); assert.equal(f.counts().saves, 0);
});
test('eight-step budget bounds perpetual progress and blocks a second skill invocation', async () => {
  const f = setup([detection([.4,.3,.2,.2])]); await f.run();
  assert.equal(f.moves.length, 8); assert.equal(f.skill.stats.stopReason, 'step-budget'); await assert.rejects(f.run(), /一次/);
});
test('timeout stops and cannot accept a late detection', async () => {
  const f = setup(); f.deps.tracker = new TargetEstimator(async () => { f.advance(60001); return JSON.stringify(detection()); });
  await f.run(); assert.equal(f.skill.stats.stopReason, 'timeout'); assert.equal(f.moves.length, 0); assert.equal(f.counts().stops, 1);
});
test('cancel during a tracker that ignores abort stops promptly, late result does not send input', async () => {
  const f = setup(); let resolve!: (text: string) => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  f.deps.tracker = new TargetEstimator(() => { entered(); return new Promise(r => { resolve = r; }); });
  const running = f.run(); await ready; f.parent.abort(); await assert.rejects(running, /取消/);
  resolve(JSON.stringify(detection())); await new Promise(r => setImmediate(r));
  assert.equal(f.moves.length, 0); assert.equal(f.counts().stops, 1);
});

test('configuration and tracker JSON reject invalid geometry, extra fields and invented defaults', () => {
  assert.throws(() => normalizeApproach({ description: 'x', region: [.9,0,.2,.5], minArea: .1 }));
  assert.throws(() => normalizeApproach({ description: 'x', region: [0,0,.5,.5], minArea: .1, maxSteps: 999 }));
  for (const text of ['{}', 'not json', JSON.stringify({ ...detection(), box: [0,0,2,2] }), JSON.stringify({ ...detection(), command: 'move' })]) assert.ok(parseDetection(text).invalidReason);
});
test('real deadline aborts a stalled locator and resets; late response cannot revive the skill', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(); let resolve!: (text: string) => void, enter!: () => void;
  const entered = new Promise<void>(r => { enter = r; });
  f.deps.tracker = new TargetEstimator(() => { enter(); return new Promise(r => { resolve = r; }); });
  const running = f.run(); await entered; t.mock.timers.tick(60000); await running;
  assert.equal(f.skill.stats.stopReason, 'timeout'); assert.equal(f.counts().stops, 1);
  resolve(JSON.stringify(detection())); await Promise.resolve(); assert.equal(f.moves.length, 0);
});
test('identity jump after a small step stops instead of chasing a new object', async () => {
  const f = setup([detection([.1,.3,.1,.2]), detection([.8,.3,.1,.2])]); await f.run();
  assert.equal(f.skill.stats.stopReason, 'target-jump'); assert.equal(f.moves.length, 1);
});

test('cancel during input awaits reset and cannot start a second feedback segment', async () => {
  const f = setup(); let enter!: () => void, release!: () => void, neutral = false;
  const entered = new Promise<void>(r => { enter = r; });
  f.deps.execute = async (_input, beforeSend) => { beforeSend(); enter(); await new Promise<void>(r => { release = r; }); return { ok: false, neutral, status: 'cancelled' }; };
  f.deps.stop = async () => { await Promise.resolve(); neutral = true; release(); };
  const running = f.run(); await entered; f.parent.abort(); await assert.rejects(running, /取消/);
  assert.equal(neutral, true); assert.equal(f.skill.stats.steps, 1); assert.equal(f.skill.stats.executedSteps, 0);
  assert.equal(f.skill.stats.trackingCalls, 1); assert.equal(f.skill.stats.stopReason, 'canceled');
});

test('invalid locator fields have actionable diagnostics and never dispatch movement', async () => {
  const cases = [
    [{ ...detection(), confidence: 95 }, /confidence/],
    [{ ...detection(), box: [100, 200, 50, 60] }, /box/],
    [{ ...detection(), facts: [] }, /facts/],
    [{ ...detection(), pathClear: 'true' }, /pathClear/],
    [{ mode: 'gameplay' }, /缺少/],
  ] as const;
  for (const [value, reason] of cases) {
    assert.match(parseDetection(JSON.stringify(value)).invalidReason!, reason);
    const f = setup();
    f.deps.tracker = new TargetEstimator(async () => JSON.stringify(value));
    await f.run();
    assert.equal(f.moves.length, 0);
    assert.equal(f.skill.stats.stopReason, 'invalid-state');
    assert.match(f.result().detail!, reason);
    assert.equal(f.events.some(e => e.type === 'verification_end'), false);
  }
});

test('locator accepts a single JSON code fence but rejects prose, truncation and multiple objects', () => {
  const json = JSON.stringify(detection());
  assert.deepEqual(parseDetection('```json\n' + json + '\n```'), detection());
  assert.deepEqual(parseDetection('```\r\n' + json + '\r\n```'), detection());
  for (const text of ['Explanation: ' + json, json + json, json.slice(0, -1), '```json\n' + json + '\n```\nextra']) {
    assert.ok(parseDetection(text).invalidReason);
  }
  assert.match(parseDetection('').invalidReason!, /为空/);
});

test('invalid public locator response is retained as bounded diagnostic without usable coordinates', async () => {
  const text = 'invalid '.repeat(400);
  const estimator = new TargetEstimator(async () => text);
  const state = await estimator.estimate({ spec, initial: image(1), image: image(2), signal: new AbortController().signal }, 0);
  assert.equal(state.box, null);
  assert.equal(state.responseDiagnostic?.length, text.length);
  assert.equal(state.responseDiagnostic?.preview.length, 2000);
});

test('mixed-scale real-world locator response stops after the preceding valid segment', async () => {
  const f = setup(); let calls = 0;
  f.deps.tracker = new TargetEstimator(async () => JSON.stringify(detection(
    ++calls === 1 ? [.61, .57, .075, .12] : [.612, 572, .07, .115]
  )));
  await f.run();
  assert.deepEqual(f.moves, ['forward']);
  assert.equal(f.skill.stats.executedSteps, 1);
  assert.equal(f.skill.stats.stopReason, 'invalid-state');
  assert.match(f.result().detail!, /572/);
  assert.equal(f.counts().stops, 1);
});


test('explicit integer wire coordinates normalize once and reject mixed units', () => {
  const { box: _, ...rest } = detection();
  const wire = { ...rest, coordinateSystem: 'xywh-1000', box1000: [607,572,66,118] };
  assert.deepEqual(parseDetection(JSON.stringify(wire)).box, [.607,.572,.066,.118]);
  for (const box1000 of [[.607,572,.066,.118], [607,572,660,118], [607,572,0,118]]) {
    assert.match(parseDetection(JSON.stringify({ ...wire, box1000 })).invalidReason!, /box1000/);
  }
  assert.ok(parseDetection(JSON.stringify({ ...wire, coordinateSystem: 'pixels' })).invalidReason);
  assert.ok(parseDetection(JSON.stringify({ ...wire, box: [.607,.572,.066,.118] })).invalidReason);
  assert.equal(parseDetection(JSON.stringify({ ...wire, visible: false, box1000: null })).box, null);
});

test('named integer corners convert to width and height without guessing old array semantics', () => {
  const { box: _, ...rest } = detection();
  const wire = { ...rest, coordinateSystem: 'ltrb-1000', bounds1000: { left: 545, top: 572, right: 590, bottom: 685 } };
  assert.deepEqual(parseDetection(JSON.stringify(wire)).box, [.545,.572,.045,.113]);
  for (const bounds1000 of [[545,572,590,685], { left: 590, top: 572, right: 545, bottom: 685 }, { left: .545, top: 572, right: 590, bottom: 685 }, { left: 545, top: 572, right: 1590, bottom: 685 }]) {
    assert.ok(parseDetection(JSON.stringify({ ...wire, bounds1000 })).invalidReason);
  }
  assert.equal(parseDetection(JSON.stringify({ ...wire, visible: false, bounds1000: null })).box, null);
  assert.ok(parseDetection(JSON.stringify({ ...rest, coordinateSystem: 'xywh-1000', box1000: [545,572,590,685] })).invalidReason);
});

test('interaction mode continues past area threshold then returns two prompt frames as a candidate', async () => {
  const absent = { ...detection(), interaction: { status: 'absent' as const, text: '' } };
  const present = { ...detection(), interaction: { status: 'present' as const, text: 'A 调查' } };
  const f = setup([absent, present, present], true); await f.run();
  assert.deepEqual(f.moves, ['forward']);
  assert.equal(f.result().arrivalCandidate, true);
  assert.equal(f.skill.stats.trackingCalls, 3);
});

test('interaction mode stops on missing or uncertain evidence and never treats it as absent', async () => {
  for (const interaction of [undefined, { status: 'unknown' as const, text: '' }]) {
    const f = setup([{ ...detection(), interaction }], true); await f.run();
    assert.equal(f.moves.length, 0); assert.equal(f.skill.stats.stopReason, 'interaction-unknown');
  }
  assert.ok(parseDetection(JSON.stringify({ ...detection(), interaction: { status: 'present', text: '' } })).invalidReason);
});

test('absent interaction remains bounded by eight moves even when area already passes', async () => {
  const f = setup([{ ...detection(), interaction: { status: 'absent', text: '' } }], true); await f.run();
  assert.equal(f.moves.length, 8); assert.equal(f.skill.stats.stopReason, 'step-budget');
  assert.equal(f.events.some(e => e.type === 'verification_start'), false);
});
