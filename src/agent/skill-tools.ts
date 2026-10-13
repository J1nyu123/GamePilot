import type { TaskSpec } from '../contracts/run';
import type { RegisteredTool, ToolRegistry } from '../contracts/tools';

/** Adapts host-owned skills to a planner without giving it task, device, or budget ownership. */
export function skillTools(task: TaskSpec, observationId: string, tools: RegisteredTool[],
  maxCalls: number, allow: ToolRegistry['allow']): ToolRegistry {
  return { tools, maxCalls, allow,
    systemPrompt: `You are a visual game planner. Initial observationId=${JSON.stringify(observationId)}. The host owns an immutable task: ${JSON.stringify(task)}. Inspect evidence and select only registered skills. Use one tool per turn, wait for new evidence before another decision. Use the latest returned observationId for each call. Arguments cannot change task criteria or control limits. If verification passed, stop. If failed, a bounded next skill is allowed only by the host. If inconclusive or blocked, stop; do not move blindly. Execution and arrival candidates are not proof of completion. Summarize public verification facts without private reasoning.` };
}
