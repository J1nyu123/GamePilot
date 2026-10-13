import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { setTimeout as delay } from 'node:timers/promises';
import { visionModel, shouldDisableThinking } from './model.mjs';

// Default remains P1 simulation. Device access is injected by the host, never owned here.
export async function validate({ baseUrl, apiKey, modelId, image, prompt, signal,
  timeoutMs = 30000, maxTurns = 4, failTool = false, thinkingMode, movement, verifiedTools, toolRegistry, onEvent = () => {} }) {
  const simulated = !movement && !verifiedTools && !toolRegistry;
  let sequence = 0, turn = 0, completedTools = 0, toolErrors = 0, aborted = false, toolCalls = 0;
  let lastVerifiedToolTurn = 0;
  let finalResponseReceived = false;
  let timedOut = false, limitReached = false, finalText = '', modelError = '';
  let incompleteReason = '';
  const disableThinking = shouldDisableThinking(baseUrl, modelId, thinkingMode);
  const emit = (type, fields = {}) => onEvent({ sequence: ++sequence, timestamp: Date.now(), type, ...fields });
  const tool = {
    name: 'move_for', label: simulated ? 'Simulated movement' : 'Virtual Xbox movement',
    description: verifiedTools ? 'Real bounded left-stick movement at strength 0.5, 20–1500ms, followed by release, new screenshot and goal verification. At most two movement calls. Use returned visual evidence for the next decision.' : simulated ? 'SIMULATION ONLY. Simulate holding a direction for 1–2000 ms; does not operate a game.'
      : 'Hold the virtual Xbox left stick at strength 0.5 for 20–1500 ms, then release. Only one call per task. This executes real input, not game-goal verification.',
    parameters: Type.Object({
      direction: Type.Union(['left', 'right', 'forward', 'backward'].map(x => Type.Literal(x))),
      durationMs: Type.Integer({ minimum: simulated ? 1 : 20, maximum: simulated ? 2000 : 1500 }),
    }, { additionalProperties: false }),
    async execute(id, args, abortSignal) {
      if (verifiedTools) {
        const result = await verifiedTools.move(args, abortSignal, id);
        if (signal?.aborted || abortSignal?.aborted) throw new Error('Verified tool canceled');
        completedTools++; return result;
      }
      if (!simulated) {
        const reply = await movement(args, abortSignal);
        if (signal?.aborted || abortSignal?.aborted) throw new Error('Real input canceled');
        if (reply.status !== 'executed' || reply.neutral !== true || reply.ok !== true) throw new Error(reply.error || 'Real input not completed or release unconfirmed');
        completedTools++;
        const result = { simulated: false, ...args, strength: 0.5, receipt: reply, gameOutcome: 'unverified' };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
      emit('simulation_start', { toolCallId: id, args });
      await delay(args.durationMs, undefined, { signal: abortSignal });
      if (failTool) throw new Error('Injected simulated tool failure');
      completedTools++;
      return { content: [{ type: 'text', text: JSON.stringify({ simulated: true, ...args, execution: 'completed', gameOutcome: 'unverified' }) }],
        details: { simulated: true, gameOutcome: 'unverified' } };
    },
  };
  const tools = toolRegistry ? toolRegistry.tools.map(registered => ({ ...registered, parameters: Type.Unsafe(registered.parameters),
    async execute(id, args, abortSignal) {
      const result = await registered.execute(args, abortSignal, id);
      if (signal?.aborted || abortSignal?.aborted) throw new Error('Registered tool canceled');
      completedTools++; return result;
    },
  })) : [tool];
  if (verifiedTools) tools.push({ name: 'wait_for_state', label: 'Wait for fixed visible goal',
    description: 'Read-only poll of the FIXED success condition. Does not change the goal or send gamepad input. At most one call, three observations, 500–10000ms waiting budget. Returns fresh evidence and passed/failed/inconclusive.',
    parameters: Type.Object({ timeoutMs: Type.Integer({ minimum: 500, maximum: 10000 }) }, { additionalProperties: false }),
    async execute(id, args, abortSignal) {
      const result = await verifiedTools.wait(args, abortSignal, id);
      if (signal?.aborted || abortSignal?.aborted) throw new Error('State wait canceled');
      completedTools++; return result;
    },
  });
  const agent = new Agent({
    initialState: {
      systemPrompt: toolRegistry
        ? toolRegistry.systemPrompt
        : verifiedTools
        ? `You are GamePilot P2-D, a visual game planner. Fixed success condition: ${JSON.stringify(verifiedTools.goal)}. Never change it. Describe only visible facts, do not reveal private reasoning, and do not move in menus/unknown scenes. Tools operate a REAL virtual Xbox. Exactly at most ONE game tool call per assistant turn: never batch tools; wait for fresh evidence before deciding again. At most two move_for calls and one wait_for_state; at most three tool calls total. Each tool returns independent verification and a fresh screenshot. If failed, use the fresh evidence for at most one corrective move or a read-only wait. If inconclusive, do not move blindly; a read-only wait may acquire better evidence. If passed, stop calling tools and summarize the VLM verdict without claiming calibrated or infallible proof. Input executed does NOT mean the goal passed. Only the RuntimeSupervisor can accept completion. If budgets are exhausted or evidence insufficient, explain blocked status.`
        : simulated
        ? 'You are a GamePilot P1 integration tester. Inspect the supplied image, describe only visible facts, then call move_for once if appropriate for the user request. After its result, summarize it. Tools are simulations: never claim the game actually moved or the goal was achieved. Do not expose private reasoning.'
        : 'You are GamePilot P2-C. Inspect the supplied fresh game-window screenshot and describe only visible facts. Choose whether one bounded move_for is appropriate for the user task. Do not move in menus or unknown scenes; explain instead. Tools operate a REAL virtual Xbox. At most one move_for call is allowed; never request additional actions. After the receipt, summarize input execution and release, but never claim visible movement or game-goal success: no post-action screenshot or Verifier is available. Do not expose private reasoning.',
      thinkingLevel: 'off', tools,
      model: visionModel(baseUrl, modelId),
    },
    streamFn: (model, context, options) => streamSimple(model, context, { ...options, apiKey, maxRetries: 0, maxTokens: 2048,
      onPayload: payload => {
        if (disableThinking) payload.thinking = { type: 'disabled' };
        emit('model_request', { turn, modelId, maxTokens: 2048, thinkingMode: disableThinking ? 'disabled' : 'provider_default' });
        return payload;
      },
    }),
    toolExecution: 'sequential',
    beforeToolCall: ({ toolCall }) => {
      toolCalls++;
      const rejection = (verifiedTools || toolRegistry) && lastVerifiedToolTurn === turn ? '每轮仅允许一个游戏工具，必须基于新截图重新决策' : verifiedTools?.allow(toolCall.name) ?? toolRegistry?.allow(toolCall.name);
      if (verifiedTools || toolRegistry) lastVerifiedToolTurn = turn;
      if (toolCalls > (toolRegistry ? toolRegistry.maxCalls : verifiedTools ? 3 : simulated ? 4 : 1) || rejection) limitReached = true;
      return signal?.aborted || timedOut || limitReached
        ? { block: true, reason: rejection || 'Validation stopped or call budget exhausted', terminate: true } : undefined;
    },
  });
  agent.subscribe(event => {
    if (event.type === 'turn_start') {
      turn++;
      if (turn > maxTurns) { limitReached = true; agent.abort(); }
      emit('turn_start', { turn });
    } else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') emit('model_text', { turn, text: update.delta });
      if (update.type === 'toolcall_delta') emit('tool_arguments_delta', { turn, text: update.delta });
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message;
      finalText = message.content.filter(x => x.type === 'text').map(x => x.text).join('');
      const thinkingChars = message.content.filter(x => x.type === 'thinking').reduce((n, x) => n + (x.thinking?.length || 0), 0);
      const toolCallCount = message.content.filter(x => x.type === 'toolCall').length;
      const diagnostics = { contentTypes: [...new Set(message.content.map(x => x.type))], textChars: finalText.length, thinkingChars,
        toolCallCount, ...(message.usage?.totalTokens > 0 ? { tokenUsage: { input: message.usage.input, output: message.usage.output,
          reasoning: message.usage.reasoning, total: message.usage.totalTokens } } : {}) };
      if (!finalText && !toolCallCount && !['error', 'aborted'].includes(message.stopReason)) {
        incompleteReason = thinkingChars > 0 ? '模型仅返回推理内容，没有公开回复或工具调用；请检查思考模式与输出预算。'
          : '模型请求已结束，但没有返回可展示文本或工具调用。';
      } else incompleteReason = '';
      finalResponseReceived = completedTools > 0 && message.stopReason === 'stop' && Boolean(finalText);
      if (message.stopReason === 'error') modelError = message.errorMessage || 'Model request failed';
      if (message.stopReason === 'aborted') aborted = true;
      emit('model_end', { turn, stopReason: message.stopReason, error: modelError || undefined, warning: incompleteReason || undefined, diagnostics });
    } else if (event.type === 'tool_execution_start') {
      emit(event.type, { turn, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, simulated });
    } else if (event.type === 'tool_execution_end') {
      if (event.isError) toolErrors++;
      emit(event.type, { turn, toolCallId: event.toolCallId, isError: event.isError,
        durationMs: event.durationMs, result: event.result, simulated });
    }
  });
  const abort = () => { aborted = true; agent.abort(); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; agent.abort(); }, timeoutMs);
  emit('validation_start', { simulated });
  try {
    if (signal?.aborted) aborted = true;
    else await agent.prompt(prompt, [image]);
  } catch (error) { modelError = String(error.message || error); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  const status = timedOut ? 'timed_out' : limitReached ? 'budget_exceeded' : aborted ? 'canceled'
    : modelError || toolErrors ? 'failed' : finalResponseReceived ? (simulated ? 'protocol_passed' : 'control_passed') : 'incomplete';
  if (status === 'incomplete' && !incompleteReason) incompleteReason = completedTools === 0
    ? '模型没有调用工具，图片—工具—回复的链路未完成。' : '工具已执行，但没有收到后续公开回复。';
  const summary = { status, simulated, gameOutcome: 'unverified', turns: turn, completedTools, toolErrors, finalText,
    error: modelError || (status === 'incomplete' ? incompleteReason : undefined) };
  emit('validation_end', summary);
  return summary;
}
