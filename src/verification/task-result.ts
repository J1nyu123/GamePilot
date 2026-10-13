import type { TaskSpec } from '../contracts/run';
import type { CriterionResult, VerificationResult, Verdict } from '../contracts/verification';
import { parseVerdict } from './evidence';

export function aggregateCriteria(task: TaskSpec, criteria: readonly CriterionResult[]): Verdict {
  const required = task.criteria.filter(c => c.required).map(c => criteria.find(r => r.id === c.id));
  if (required.some(c => c?.verdict === 'failed')) return 'failed';
  return required.every(c => c?.verdict === 'passed') ? 'passed' : 'inconclusive';
}
export function unknownCriteria(task: TaskSpec, reason: string): CriterionResult[] {
  return task.criteria.map(c => ({ id: c.id, verdict: 'inconclusive', evidenceIds: [], reason }));
}
export function parseTaskVerdict(text: string, task: TaskSpec, evidenceIds: string[], observationId: string) {
  const invalid = { verdict: 'inconclusive' as const, summary: '验证模型没有返回完整的逐项判定及有效证据引用', facts: [] as string[],
    criteria: unknownCriteria(task, '逐项判定缺失或格式无效') };
  try {
    const data = JSON.parse(text);
    // Old single-condition responses remain readable. Multi-condition tasks require explicit item results.
    if (!Object.hasOwn(data, 'criteria') && task.criteria.length === 1) {
      const parsed = parseVerdict(text);
      return { ...parsed, criteria: [{ id: task.criteria[0].id, verdict: parsed.verdict,
        evidenceIds: parsed.facts.length ? [observationId] : [], reason: parsed.summary }] };
    }
    if (!Array.isArray(data.criteria) || data.criteria.length !== task.criteria.length) return invalid;
    const { criteria: raw, ...rest } = data;
    const parsed = parseVerdict(JSON.stringify(rest));
    if (parsed.verdict === 'inconclusive' && parsed.summary === '验证模型没有返回符合契约的可核对结论') return invalid;
    const criteria = raw as CriterionResult[];
    if (new Set(criteria.map(c => c.id)).size !== criteria.length || criteria.some(c => !c
      || Object.keys(c).sort().join(',') !== 'evidenceIds,id,reason,verdict'
      || !task.criteria.some(s => s.id === c.id) || !['passed', 'failed', 'inconclusive'].includes(c.verdict)
      || typeof c.reason !== 'string' || !c.reason.trim() || c.reason.length > 1500
      || !Array.isArray(c.evidenceIds) || c.evidenceIds.some(id => !evidenceIds.includes(id))
      || c.verdict !== 'inconclusive' && !c.evidenceIds.includes(observationId)
      || c.id === 'interaction' && c.verdict === 'passed' && evidenceIds.filter(id => id !== evidenceIds[0]).some(id => !c.evidenceIds.includes(id)))) return invalid;
    if (aggregateCriteria(task, criteria) !== parsed.verdict) return invalid;
    return { ...parsed, criteria };
  } catch { return invalid; }
}
export function validTaskVerification(result: VerificationResult, task: TaskSpec, beforeId: string, afterId: string, releaseId: string): boolean {
  return result.taskId === task.id && result.goalId === task.id && result.targetId === task.targetId
    && result.releaseId === releaseId && result.observationId === afterId
    && result.evidenceIds.includes(beforeId) && result.evidenceIds.includes(afterId)
    && !!result.criteria && result.criteria.length === task.criteria.length
    && new Set(result.criteria.map(c => c.id)).size === task.criteria.length
    && task.criteria.every(c => result.criteria!.some(r => r.id === c.id))
    && result.criteria.every(c => ['passed', 'failed', 'inconclusive'].includes(c.verdict)
      && !!c.reason.trim() && c.evidenceIds.every(id => result.evidenceIds.includes(id))
      && (c.verdict === 'inconclusive' || c.evidenceIds.includes(afterId)))
    && aggregateCriteria(task, result.criteria) === result.verdict
    && (result.verdict === 'inconclusive' || result.method === 'vlm' && result.facts.length > 0);
}
