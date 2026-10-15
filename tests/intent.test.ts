import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecision, runConversation } from '../src/agent/conversation';
import type { ValidationOptions } from '../src/agent/validation-runtime';
import type { RunSummary } from '../src/contracts/debug';

const summary: RunSummary = { status: 'completed', simulated: true, gameOutcome: 'unverified', turns: 1, completedTools: 0, toolErrors: 0, finalText: '' };
const options: ValidationOptions = { baseUrl: 'http://localhost/v1', apiKey: 'test', modelId: 'test', prompt: '你好',
  image: { type: 'image', data: 'must-not-send', mimeType: 'image/png' }, timeoutMs: 1000, signal: new AbortController().signal, onEvent: () => {} };

test('chat uses text-only context and cannot invoke game tools', async () => {
  const events: string[] = [];
  const result = await runConversation({ ...options, onEvent: e => events.push(e.type) }, [{ role: 'user', text: '我叫小明' }],
    async () => { throw new Error('must not dispatch'); }, async request => {
      assert.equal(request.image, undefined); assert.equal(request.toolRegistry?.tools.length, 0);
      assert.match(request.prompt, /小明/);
      request.onEvent({ type: 'model_text', text: 'private routing JSON', sequence: 1, timestamp: 1 });
      return { ...summary, finalText: JSON.stringify({ intent: 'chat', confidence: 0.99, reply: '你好，小明。', task: '' }) };
    });
  assert.equal(result.intent, 'chat'); assert.equal(result.finalText, '你好，小明。');
  assert.deepEqual(events, ['intent_resolved', 'model_text']);
});

test('only well-formed, confident game intents dispatch; ambiguous output asks without action', async () => {
  for (const intent of ['observe', 'act'] as const) {
    let calls = 0;
    const result = await runConversation(options, [], async decision => { calls++; assert.equal(decision.intent, intent); return summary; },
      async () => ({ ...summary, finalText: JSON.stringify({ intent, confidence: 0.95, reply: '', task: '查看前方柱子' }) }));
    assert.equal(calls, 1); assert.equal(result.intent, intent);
  }
  for (const text of ['invalid JSON', '{"intent":"act"}', JSON.stringify({ intent: 'act', confidence: 0.5, reply: '', task: '走过去' })]) {
    const result = await runConversation(options, [], async () => { throw new Error('must not act'); }, async () => ({ ...summary, finalText: text }));
    assert.equal(result.intent, 'clarify'); assert.ok(result.finalText);
  }
  assert.throws(() => parseDecision('{"intent":"execute_shell","confidence":1,"reply":"","task":"x"}'));
});

test('failed or canceled classification never invokes the task path', async () => {
  const failed = await runConversation(options, [], async () => { throw new Error('must not act'); }, async () => ({ ...summary, status: 'failed', error: 'network failure' }));
  assert.equal(failed.status, 'failed');
  const controller = new AbortController();
  await assert.rejects(runConversation({ ...options, signal: controller.signal }, [], async () => { throw new Error('must not act'); }, async () => {
    controller.abort(); return { ...summary, finalText: '{"intent":"act","confidence":1,"reply":"","task":"W"}' };
  }), /abort/i);
});


test('router receives loaded-image metadata without pixels and forwards visibility question to observation', async () => {
  let dispatched = false;
  const result = await runConversation({ ...options, prompt: '你能看到我放入的图片吗', visualContext: { source: 'import', supportsImages: true, name: 't1.png' } }, [],
    async decision => { dispatched = true; assert.equal(decision.intent, 'observe'); return { ...summary, finalText: '已收到图片' }; },
    async request => {
      const input = JSON.parse(request.prompt);
      assert.deepEqual(input.visualContext, { source: 'import', supportsImages: true, name: 't1.png' });
      assert.equal(request.image, undefined); assert.ok(!request.prompt.includes('must-not-send'));
      assert.match(request.toolRegistry!.systemPrompt, /你能看到我放入的图片吗 -> observe/);
      return { ...summary, finalText: JSON.stringify({ intent: 'observe', confidence: 0.99, reply: '', task: input.message }) };
    });
  assert.equal(dispatched, true); assert.equal(result.finalText, '已收到图片');
});


test('capability questions receive mode-specific schemas without granting execution', async () => {
  for (const mode of ['keyboard', 'simulation'] as const) {
    const result = await runConversation({ ...options, executionMode: mode, prompt: '你能使用哪些工具和MCP' }, [],
      async () => { throw new Error('Capability question must not execute tools'); }, async request => {
        const catalog = JSON.parse(request.prompt).toolCapabilities;
        assert.equal(catalog.executionMode, mode);
        assert.equal(catalog.toolsCallableInCurrentStage, false);
        assert.equal(request.toolRegistry!.tools.length, 0);
        assert.equal(request.image, undefined);
        if (mode === 'keyboard') {
          assert.deepEqual(catalog.taskTools.map((t: any) => t.name), ['capture_game', 'keyboard_action']);
          assert.equal(catalog.taskTools[1].parameters.properties.duration_ms.maximum, 1000);
          assert.equal(catalog.limits.maxActions, 4);
        } else {
          assert.equal(catalog.taskTools.length, 6);
          assert.ok(catalog.taskTools.every((t: any) => t.name.startsWith('gamepad_')));
          assert.equal(catalog.limits.simulatedOnly, true);
        }
        return { ...summary, finalText: JSON.stringify({ intent: 'chat', confidence: 1, reply: catalog.taskTools.map((t: any) => t.name).join('、'), task: '' }) };
      });
    assert.equal(result.intent, 'chat'); assert.equal(result.completedTools, 0);
  }
});
