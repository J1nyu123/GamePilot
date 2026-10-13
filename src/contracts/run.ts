import type { ImportedImage, RunSummary } from './debug';
import type { ApproachSpec, ApproachStats } from './approach';
import type { GoalSpec, ReleaseEvidence, VerificationResult, Verdict } from './verification';

export interface SuccessCriterion { readonly id: string; readonly description: string; readonly required: boolean }
export interface TaskSpec {
  readonly id: string; readonly successCondition: string; readonly targetId?: string;
  readonly criteria: readonly SuccessCriterion[];
}
export interface Observation {
  readonly id: string; readonly source: ImportedImage['source']; readonly image: ImportedImage;
  readonly observedAt: number; readonly validUntil: number; readonly clock: 'main-monotonic';
  readonly release?: ReleaseEvidence;
}
export interface ExecutionResult {
  status: 'completed' | 'blocked' | 'budget-exhausted' | 'canceled' | 'failed';
  stopReason: string; arrivalCandidate: boolean; evidenceIds: string[];
  observations: Observation[]; release?: ReleaseEvidence; receipt?: ReleaseEvidence['receipt'];
  stats: ApproachStats; detail?: string;
}
export type ExecutionStrategy = 'direct' | 'agent';
export type ExecutionReport = Omit<ExecutionResult, 'observations'> & { observations: Omit<Observation, 'image'>[] };
export interface RunResult {
  status: RunSummary['status']; taskOutcome: 'unverified' | Verdict; stopReason: string;
  strategy: ExecutionStrategy; verification?: VerificationResult; execution?: ExecutionReport;
  agentSummaryError?: string;
  finishedAt?: number; clock?: 'main-monotonic';
  budget?: { steps: number; observations: number; elapsedMs: number };
}

/** Copies and deeply freezes criteria; the original caller cannot change a running task. */
export function freezeTask(goal: GoalSpec, spec?: ApproachSpec): TaskSpec {
  const criteria = goal.criteria ?? (spec ? [
    { id: 'same-target', description: `与初始图中指定目标 ${JSON.stringify(spec.description)} 是同一目标`, required: true },
    { id: 'gameplay', description: '正常且稳定的游戏场景', required: true },
    { id: 'region', description: `目标框中心位于归一化区域 ${JSON.stringify(spec.region)}`, required: true },
    { id: 'area', description: `归一化目标框面积至少 ${spec.minArea}`, required: true },
    ...(spec.requireInteraction ? [{ id: 'interaction', description: '连续两帧出现明确对应指定目标的交互按键及文字提示；通用移动帮助不算', required: true }] : []),
    { id: 'visible-condition', description: goal.successCondition, required: true },
  ] : [{ id: 'visible-condition', description: goal.successCondition, required: true }]);
  if (!goal.id.trim() || !goal.successCondition.trim() || !criteria.length
    || new Set(criteria.map(c => c.id)).size !== criteria.length
    || criteria.some(c => !c.id.trim() || !c.description.trim() || typeof c.required !== 'boolean')
    || !criteria.some(c => c.required)) throw new Error('任务身份与成功标准无效');
  return Object.freeze({ id: goal.id, successCondition: goal.successCondition,
    ...(spec ? { targetId: spec.targetId } : goal.targetId ? { targetId: goal.targetId } : {}),
    criteria: Object.freeze(criteria.map(c => Object.freeze({ ...c }))) });
}

/** Read old summaries without upgrading an execution receipt to a task verdict. */
export function readRunResult(summary: RunSummary): RunResult {
  return summary.runResult ?? { status: summary.status, taskOutcome: summary.gameOutcome ?? 'unverified',
    stopReason: summary.approach?.stopReason ?? summary.error ?? summary.status, strategy: 'agent', verification: summary.verification };
}
