import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { visionModel, shouldDisableThinking } from '../models/model.mjs';

// The host supplies the sole simulated MCP tool registry and owns cancellation.
export async function validate({ baseUrl, apiKey, modelId, image, prompt, signal,
  timeoutMs = 30000, maxTurns = 4, thinkingMode, toolRegistry, onEvent = () => {} }) {
  if (!toolRegistry) throw new Error('模拟 MCP 工具注册表缺失');
  const simulated = toolRegistry.simulated !== false;
  let actionFeedback = false;
  let sequence = 0, turn = 0, completedTools = 0, toolErrors = 0, aborted = false, toolCalls = 0;
  let finalResponseReceived = false, timedOut = false, limitReached = false, finalText = '', modelError = '', incompleteReason = '';
  const disableThinking = shouldDisableThinking(baseUrl, modelId, thinkingMode);
  const emit = (type, fields = {}) => onEvent({ sequence: ++sequence, timestamp: Date.now(), type, ...fields });
  const tools = toolRegistry.tools.map(registered => ({ ...registered, parameters: Type.Unsafe(registered.parameters),
    async execute(id, args, abortSignal) {
      const result = await registered.execute(args, abortSignal, id);
      if (signal?.aborted || abortSignal?.aborted) throw new Error('Simulated tool canceled');
      if (['keyboard_action', 'gamepad_action'].includes(registered.name) && result.content.some(c => c.type === 'image')) actionFeedback = true;
      completedTools++; return result;
    },
  }));
  const agent = new Agent({
    initialState: {
      systemPrompt: toolRegistry.systemPrompt,
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
      const rejection = toolRegistry.allow(toolCall.name);
      if (toolCalls > toolRegistry.maxCalls) limitReached = true;
      return signal?.aborted || timedOut || limitReached || rejection
        ? { block: true, reason: rejection || 'Runtime stopped or call budget exhausted', terminate: true } : undefined;
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
      finalResponseReceived = message.stopReason === 'stop' && Boolean(finalText);
      if (message.stopReason === 'error') modelError = message.errorMessage || 'Model request failed';
      if (message.stopReason === 'aborted') aborted = true;
      emit('model_end', { turn, stopReason: message.stopReason, error: modelError || undefined, warning: incompleteReason || undefined, diagnostics });
    } else if (event.type === 'tool_execution_start') {
      emit(event.type, { turn, toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, simulated });
    } else if (event.type === 'tool_execution_end') {
      if (event.isError) { toolErrors++; modelError = event.result?.content?.filter(c => c.type === 'text').map(c => c.text).join(' ') || '工具执行失败'; }
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
    else await agent.prompt(prompt, image ? [image] : undefined);
  } catch (error) { modelError = String(error.message || error); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  const status = timedOut ? 'timed_out' : limitReached ? 'budget_exceeded' : aborted ? 'canceled'
    : modelError || toolErrors ? 'failed' : finalResponseReceived ? (simulated ? (completedTools > 0 ? 'protocol_passed' : 'completed') : actionFeedback ? 'control_passed' : 'completed') : 'incomplete';
  if (status === 'incomplete' && !incompleteReason) incompleteReason = completedTools === 0
    ? '模型没有返回公开回复。' : '工具已执行，但没有收到后续公开回复。';
  const summary = { status, simulated, gameOutcome: 'unverified', turns: turn, completedTools, toolErrors, finalText,
    error: modelError || (status === 'incomplete' ? incompleteReason : undefined) };
  emit('validation_end', summary);
  return summary;
}
