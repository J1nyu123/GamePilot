import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditRun } from './audit';
import { approachLimits as limits, normalizeApproach, type ApproachStats, type TargetState } from '../contracts/approach';
import { approachDecision, parseDetection, stateRejection } from '../state/target-estimator';
import type { AgentEvent, RunSummary } from '../contracts/debug';

export async function auditApproach(directory: string) {
  const trace = await auditRun(directory), checks: { name: string; ok: boolean }[] = [];
  const check = (name: string, ok: unknown) => checks.push({ name, ok: Boolean(ok) });
  check('完整运行证据与最终归零通过通用审计', trace.technicalPassed);
  let feedbackCorrections = 0, steps = 0, stopReason = 'unknown';
  try {
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
    const summary = JSON.parse(await readFile(resolve(directory, 'summary.json'), 'utf8')) as RunSummary;
    const events = (await readFile(resolve(directory, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line)) as AgentEvent[];
    const spec = normalizeApproach({ description: manifest.experiment?.spec?.description, region: manifest.experiment?.spec?.region, minArea: manifest.experiment?.spec?.minArea, requireInteraction: manifest.experiment?.spec?.requireInteraction });
    check('独立 P3 配置与固定控制上限', manifest.experiment?.kind === 'p3-approach' && JSON.stringify(manifest.experiment.limits) === JSON.stringify(limits)
      && manifest.experiment.spec.targetId === spec.targetId && !manifest.benchmark);
    const stats = summary.approach as ApproachStats;
    const modern = manifest.schemaVersion === 3;
    stopReason = summary.runResult?.stopReason ?? stats.stopReason;
    check('技能调用、动作和观测均在固定预算内', (modern ? Number.isInteger(stats.calls) && stats.calls >= 1 && stats.calls <= limits.maxObservations / limits.stableFrames : stats.calls === 1) && Number.isInteger(stats.steps) && stats.steps >= 0 && stats.steps <= limits.maxSteps
      && Number.isInteger(stats.executedSteps) && stats.executedSteps >= 0 && stats.executedSteps <= stats.steps
      && stats.observations <= limits.maxObservations && stats.trackingCalls <= stats.observations);
    const tools = events.filter(e => ['tool_execution_start', 'skill_execution_start'].includes(e.type));
    check('执行路径只调用固定目标技能并引用最新观察', tools.length === stats.calls && tools.every((tool, index) => {
      const observed = [...events].reverse().find(e => e.type === 'observation_post' && e.sequence < tool.sequence)?.observationId ?? manifest.input.id;
      return tool.toolName === 'approach_target' && tool.args?.targetId === spec.targetId && tool.args?.observationId === (index ? observed : manifest.input.id)
        && (!modern || tool.type === (manifest.executionStrategy === 'direct' ? 'skill_execution_start' : 'tool_execution_start'));
    }));
    if (modern) check('Runner 预算跨调用累计，动作与观测上限未放宽', summary.runResult?.budget
      && summary.runResult.budget.steps === stats.steps && summary.runResult.budget.steps <= limits.maxSteps
      && summary.runResult.budget.observations >= stats.observations && summary.runResult.budget.observations <= limits.maxObservations
      && summary.runResult.budget.elapsedMs >= 0
      && manifest.executionStrategy === manifest.experiment.strategy);
    const states = events.filter(e => e.type === 'tracking_state');
    check('状态版本递增且引用实际保存的新帧', states.every((event, index) => {
      const s = event.result as TargetState;
      return s.version === index + 1 && s.observationId === event.observationId && s.targetId === spec.targetId && s.clock === 'main-monotonic'
        && s.confidenceSource === 'vlm-self-report' && manifest.observations.some((o: { observationId: string }) => o.observationId === s.observationId);
    }) && new Set(states.map(e => e.observationId)).size === states.length);
    const sends = events.filter(e => e.type === 'approach_input'); steps = sends.length;
    let previousDirection: string | undefined, previousObservation: string | undefined;
    for (const [sendIndex, send] of sends.entries()) {
      const input = send.result as { stateVersion: number; ageMs: number; direction: string; durationMs: number; strength: number; skill: string };
      const event = states.find(e => e.observationId === send.observationId && (e.result as TargetState).version === input.stateVersion);
      const state = event?.result as TargetState | undefined;
      const parsed = state && parseDetection(JSON.stringify({ mode: state.mode, visible: state.visible, sameTarget: state.sameTarget, sceneStable: state.sceneStable, pathClear: state.pathClear, box: state.box, confidence: state.confidence, facts: state.facts, ...(state.interaction ? { interaction: state.interaction } : {}) }));
      const previous = event && [...states].reverse().find(e => e.sequence < event.sequence)?.result as TargetState | undefined;
      check(`输入 ${send.sequence} 使用有效新状态并执行匹配纠偏`, state && !parsed?.invalidReason && event!.sequence < send.sequence && Number.isFinite(input.ageMs) && input.ageMs >= 0
        && !stateRejection(state, spec, send.observationId!, state.observedAt + input.ageMs, previous)
        && approachDecision(state, spec) === input.direction && input.skill === 'move_for' && input.durationMs === limits.stepMs && input.strength === limits.strength
        && previousObservation !== send.observationId);
      const ack = events.find(e => e.type === 'skill_released' && e.sequence > send.sequence && e.sequence < (sends[sendIndex + 1]?.sequence ?? Infinity));
      if (ack?.release?.receipt.ok === true && ack.release.receipt.neutral === true && ack.release.receipt.status === 'executed') {
        if (previousDirection && previousDirection !== input.direction) feedbackCorrections++;
        previousDirection = input.direction;
      } else check(`未确认执行的输入 ${send.sequence} 后不再发送下一段`, sendIndex === sends.length - 1 && summary.status !== 'succeeded');
      previousObservation = send.observationId;
    }
    const released = events.filter(e => e.type === 'skill_released');
    check('实际发送、执行归零与摘要一致', sends.length <= stats.steps && released.length === stats.executedSteps && stats.executedSteps <= sends.length && sends.length <= limits.maxSteps && stats.corrections === feedbackCorrections);
    const end = [...events].reverse().find(e => e.type === (modern ? 'runner_execution' : 'approach_end'));
    check('反馈结果与 summary 一致', end && JSON.stringify(end.result) === JSON.stringify(stats));
    if (summary.status === 'succeeded') {
      const holds = events.filter(e => e.type === 'approach_decision').slice(-limits.stableFrames);
      const finalStates = holds.map(e => states.find(s => s.observationId === e.observationId)?.result as TargetState | undefined);
      check('成功前有连续保持帧与独立 VLM 通过', holds.length === limits.stableFrames && holds.every(e => (e.result as { decision: string }).decision === 'hold')
        && finalStates.every((s, index) => s && approachDecision(s, spec) === 'hold' && !stateRejection(s, spec, s.observationId, s.observedAt + (holds[index].result as { ageMs: number }).ageMs))
        && finalStates[1]!.observedAt - finalStates[0]!.observedAt >= limits.stableMs && stopReason === (modern ? 'verified' : 'arrived')
        && summary.verification?.method === 'vlm' && summary.verification.verdict === 'passed');
    }
  } catch { check('P3 结构完整，缺失或损坏不能推定通过', false); }
  return { schemaVersion: 1, runId: trace.runId, technicalPassed: checks.every(c => c.ok), testData: trace.testData,
    humanReview: 'required', physicalInputVerified: null, status: trace.status, gameOutcome: trace.gameOutcome, steps, feedbackCorrections, stopReason,
    feedbackDemonstrated: checks.every(c => c.ok) && feedbackCorrections > 0, checks,
    limitations: ['纠偏仅指根据不同新帧选择了不同输入方向；语义目标身份和实际游戏效果仍需人工复核。', '模型自报置信度未校准；此审计不等于 5 次实验或与冻结原型的对比验收。'] };
}
