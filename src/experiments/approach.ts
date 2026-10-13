import { randomUUID } from 'node:crypto';
import { approachCondition, approachLimits, normalizeApproach, type ApproachSpec } from '../contracts/approach';
import { freezeTask, type ExecutionStrategy, type TaskSpec } from '../contracts/run';
import type { RunSummary } from '../contracts/debug';

export interface ApproachExperiment {
  kind: 'p3-approach'; spec: ApproachSpec; task: TaskSpec; limits: typeof approachLimits;
  strategy: ExecutionStrategy; trials: number; startingConditions: string; baseline?: string;
}
export function createApproachExperiment(input: unknown, condition: string, strategy: ExecutionStrategy = 'agent',
  options: { trials?: number; startingConditions?: string; baseline?: string } = {}): ApproachExperiment {
  if (!['direct', 'agent'].includes(strategy)) throw new Error('无效执行策略');
  if (typeof condition !== 'string' || !condition.trim() || condition.length > 2000) throw new Error('需固定可见成功条件');
  const normalized = normalizeApproach(input);
  const spec = Object.freeze({ ...normalized, region: Object.freeze([...normalized.region]) as unknown as ApproachSpec['region'] });
  const trials = options.trials ?? 1;
  if (!Number.isInteger(trials) || trials < 1 || trials > 100) throw new Error('试次数需为 1–100');
  return Object.freeze({ kind: 'p3-approach', spec, task: freezeTask({ id: randomUUID(), successCondition: approachCondition(spec, condition.trim()) }, spec),
    limits: approachLimits, strategy, trials, startingConditions: options.startingConditions ?? '操作者在每个试次前确认固定起点与可控场景', baseline: options.baseline });
}
/** The caller confirms/reset starting conditions; this module never controls a device or chooses an action. */
export async function runExperiment(plan: ApproachExperiment, services: {
  prepareTrial(trial: number, startingConditions: string): Promise<void>;
  runTrial(plan: ApproachExperiment, trial: number): Promise<RunSummary>;
}, signal: AbortSignal) {
  const rows: { trial: number; summary: RunSummary }[] = [];
  for (let trial = 1; trial <= plan.trials; trial++) {
    signal.throwIfAborted();
    try {
      await services.prepareTrial(trial, plan.startingConditions); signal.throwIfAborted();
      rows.push({ trial, summary: await services.runTrial(plan, trial) });
    } catch (error) {
      signal.throwIfAborted();
      rows.push({ trial, summary: { status: 'failed', gameOutcome: 'unverified', simulated: false,
        turns: 0, completedTools: 0, toolErrors: 0, finalText: '', error: error instanceof Error ? error.message : '试次启动失败' } });
    }
  }
  return { strategy: plan.strategy, baseline: plan.baseline, trials: rows,
    statistics: { attempted: rows.length, succeeded: rows.filter(r => r.summary.status === 'succeeded').length,
      taskPassed: rows.filter(r => r.summary.gameOutcome === 'passed').length,
      failed: rows.filter(r => r.summary.gameOutcome === 'failed').length,
      inconclusive: rows.filter(r => r.summary.gameOutcome === 'inconclusive').length,
      unverified: rows.filter(r => r.summary.gameOutcome === 'unverified').length,
      steps: rows.reduce((n, r) => n + (r.summary.approach?.executedSteps ?? 0), 0) } };
}
