import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditRun } from '../trace/audit';
import type { AgentEvent, RunSummary } from '../contracts/debug';
import type { InputReply } from '../contracts/input';

export const groups = ['move', 'wait', 'blocked', 'cancel-model', 'cancel-action'] as const;
export type Group = typeof groups[number];
export interface CampaignPlan {
  schemaVersion: 1; timeoutMs: number; game: string; scene: string; resetProcedure: string;
  environment: { machine: string; cemu: string; gameVersion: string; controller: string; modelId: string; provider: string };
  tasks: Record<Group, { prompt: string; successCondition: string }>;
}
export interface Assignment { campaignId: string; planHash: string; group: Group; trial: number; timeoutMs: number; runId?: string; prompt: string; successCondition: string }
export const checklist = ['window-identity', 'window-minimize-close', 'model-stream', 'scroll-retention', 'pause-model', 'pause-action', 'resume-fresh-frame', 'takeover-model', 'takeover-action', 'model-timeout', 'capture-failure', 'python-exit', 'cancel-race', 'log-write-failure'] as const;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
function directory(root: string, id: string) { if (!uuid.test(id)) throw new Error('无效验收批次 ID'); return resolve(root, 'benchmarks', id); }
export function validatePlan(plan: CampaignPlan) {
  if (plan?.schemaVersion !== 1) throw new Error('无效 P4 配置版本');
  const fields = [plan.game, plan.scene, plan.resetProcedure, ...(['machine', 'cemu', 'gameVersion', 'controller', 'modelId', 'provider'] as const).map(key => plan.environment?.[key]), ...groups.flatMap(g => [plan.tasks?.[g]?.prompt, plan.tasks?.[g]?.successCondition])];
  if (Object.keys(plan.environment ?? {}).length !== 6 || fields.some(v => typeof v !== 'string' || !v.trim() || /待填写|TODO|<填写/.test(v))) throw new Error('先填写场景、复位步骤、环境、五类任务和固定判据，再冻结');
  if (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 30000 || plan.timeoutMs > 300000) throw new Error('固定总超时需为 30–300 秒');
  for (const task of Object.values(plan.tasks)) if (task.prompt.length > 8000 || task.successCondition.length > 2000) throw new Error('任务或判据过长');
}
export async function freezeCampaign(root: string, plan: CampaignPlan) {
  validatePlan(plan);
  const id = randomUUID(), dir = directory(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'plan.json'), JSON.stringify({ plan, planHash: hash(plan), frozenAt: Date.now() }, null, 2), { flag: 'wx' });
  return id;
}
export async function loadCampaign(root: string, id: string) {
  const saved = await json(resolve(directory(root, id), 'plan.json'));
  validatePlan(saved.plan);
  if (hash(saved.plan) !== saved.planHash || !Number.isFinite(saved.frozenAt)) throw new Error('冻结配置被修改或损坏，请建立新批次');
  return saved as { plan: CampaignPlan; planHash: string; frozenAt: number };
}
export async function nextAssignment(root: string, id: string): Promise<Assignment | null> {
  const { plan, planHash } = await loadCampaign(root, id), names = await readdir(directory(root, id));
  for (const group of groups) for (let trial = 1; trial <= (group.startsWith('cancel-') ? 10 : 5); trial++) {
    if (!names.includes(`${group}-${trial}.json`)) return { campaignId: id, planHash, group, trial, timeoutMs: plan.timeoutMs, ...plan.tasks[group] };
  }
  return null;
}
export async function reserveAssignment(root: string, assignment: Assignment, config: { modelId: string; provider: string }) {
  const current = await nextAssignment(root, assignment.campaignId);
  if (!current || JSON.stringify(current) !== JSON.stringify(assignment)) throw new Error('验收项已过期，请重新载入下一项');
  const { plan } = await loadCampaign(root, assignment.campaignId);
  if (plan.environment.modelId !== config.modelId || plan.environment.provider !== config.provider) throw new Error('模型与冻结配置不一致');
  const reserved = { ...current, runId: randomUUID(), reservedAt: Date.now() };
  // Reserve before execution: crashes and failed setup consume a slot, never disappear from the report.
  await writeFile(resolve(directory(root, current.campaignId), `${current.group}-${current.trial}.json`), JSON.stringify(reserved, null, 2), { flag: 'wx' });
  return reserved;
}
export async function reviewTrial(root: string, id: string, group: Group, trial: number, review: { reviewer: string; sceneRestored: boolean; outcome: 'passed' | 'failed'; notes: string }) {
  if (!groups.includes(group) || !Number.isInteger(trial) || trial < 1 || trial > (group.startsWith('cancel-') ? 10 : 5) || !review.reviewer?.trim() || !review.notes?.trim() || typeof review.sceneRestored !== 'boolean' || !['passed', 'failed'].includes(review.outcome)) throw new Error('人工复核字段无效');
  const dir = directory(root, id); await json(resolve(dir, `${group}-${trial}.json`));
  await writeFile(resolve(dir, `${group}-${trial}.review.json`), JSON.stringify({ ...review, reviewedAt: Date.now() }, null, 2), { flag: 'wx' });
}
export async function recordChecklist(root: string, id: string, key: string, review: { reviewer: string; outcome: 'passed' | 'failed'; notes: string; evidence: string }) {
  await loadCampaign(root, id);
  if (!(checklist as readonly string[]).includes(key) || !review.reviewer?.trim() || !review.notes?.trim() || !review.evidence?.trim() || !['passed', 'failed'].includes(review.outcome)) throw new Error('验收检查项无效');
  await writeFile(resolve(directory(root, id), `check-${key}.json`), JSON.stringify({ ...review, reviewedAt: Date.now() }, null, 2), { flag: 'wx' });
}
export const percentile95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
export async function campaignReport(root: string, id: string) {
  const { plan, planHash, frozenAt } = await loadCampaign(root, id), dir = directory(root, id);
  const rows: { group: Group; trial: number; runId?: string; status: string; passed: boolean; evidenceValid: boolean; reasons: string[]; resetMs?: number; ackMs?: number }[] = [];
  const seen = new Set<string>();
  for (const group of groups) for (let trial = 1; trial <= (group.startsWith('cancel-') ? 10 : 5); trial++) {
    const row: typeof rows[number] = { group, trial, status: 'pending', passed: false, evidenceValid: false, reasons: [] }; rows.push(row);
    let reservation;
    try { reservation = await json(resolve(dir, `${group}-${trial}.json`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { row.status = 'invalid'; row.reasons.push('预约记录损坏'); } continue; }
    row.status = 'failed'; row.runId = reservation.runId;
    const require = (condition: unknown, reason: string) => { if (!condition) row.reasons.push(reason); };
    try {
      require(uuid.test(reservation.runId) && !seen.has(reservation.runId), '运行 ID 无效或重复');
      if (!uuid.test(reservation.runId)) continue;
      seen.add(reservation.runId);
      require(reservation.planHash === planHash && reservation.group === group && reservation.trial === trial && reservation.reservedAt >= frozenAt, '预约不匹配冻结计划');
      const runDir = resolve(root, 'runs', reservation.runId);
      const manifest = await json(resolve(runDir, 'manifest.json')), summary = await json(resolve(runDir, 'summary.json')) as RunSummary;
      const events = (await readFile(resolve(runDir, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) as AgentEvent[];
      const audit = await auditRun(runDir);
      require(!manifest.experiment, 'P3 实验不能混入 P4 基础验收');
      require(audit.technicalPassed && !audit.testData && summary.simulated === false, '记录结构不通过或属于模拟数据');
      require(manifest.runId === reservation.runId && manifest.startedAt >= reservation.reservedAt && manifest.benchmark?.planHash === planHash && manifest.benchmark?.group === group && manifest.benchmark?.trial === trial && manifest.benchmark?.campaignId === id, '运行未绑定预登记验收项');
      require(manifest.timeoutMs === plan.timeoutMs && manifest.modelId === plan.environment.modelId && manifest.provider === plan.environment.provider && manifest.prompt === plan.tasks[group].prompt && manifest.goal?.successCondition === plan.tasks[group].successCondition, '模型、任务或固定判据变化');
      const envelopeValid = row.reasons.length === 0;
      const tools = events.filter(e => e.type === 'tool_execution_start');
      if (group === 'move') require(summary.status === 'succeeded' && summary.gameOutcome === 'passed' && summary.metrics?.moves === 1 && tools.length === 1 && tools[0].toolName === 'move_for' && tools[0].args?.direction === 'forward' && tools[0].args?.durationMs === 500, '移动任务未独立验证成功或动作数不匹配');
      if (group === 'wait') require(summary.status === 'succeeded' && summary.gameOutcome === 'passed' && tools.length === 1 && tools[0].toolName === 'wait_for_state', '只读等待未验证成功');
      if (group === 'blocked') require(summary.status === 'blocked' && ['failed', 'inconclusive'].includes(summary.gameOutcome) && tools.length === 1 && tools[0].toolName === 'wait_for_state' && !events.some(e => e.verification?.verdict === 'passed'), '条件未满足任务没有按预期受阻或曾误判成功');
      if (group.startsWith('cancel-')) {
        const stop = events.find(e => e.type === 'control_stop');
        const timing = (stop?.result as InputReply | undefined)?.stopTiming;
        require(summary.status === 'canceled' && summary.gameOutcome === 'unverified' && timing?.backend === 'virtual-xbox' && /用户取消|F8/.test(timing?.reason ?? ''), '缺少用户/F8 取消和真实归零计时');
        require(group === 'cancel-action' ? timing?.phase === 'executing' && tools.length === 1 && tools[0].toolName === 'move_for' && tools[0].args?.direction === 'forward' && tools[0].args?.durationMs === 1500 : timing?.phase === 'ready' && events.some(e => e.type === 'model_request' && e.sequence < (stop?.sequence ?? 0)) && tools.length === 0, '取消发生阶段不匹配');
        require(timing && Number.isFinite(timing.resetSentAfterMs) && timing.resetSentAfterMs >= 0 && Number.isFinite(timing.ackAfterMs) && timing.ackAfterMs >= timing.resetSentAfterMs, '取消时延无效');
        if (timing) { row.resetMs = timing.resetSentAfterMs; row.ackMs = timing.ackAfterMs; }
      }
      const review = await json(resolve(dir, `${group}-${trial}.review.json`));
      require(review.reviewer?.trim() && review.notes?.trim() && review.sceneRestored === true && review.outcome === 'passed' && review.reviewedAt >= manifest.startedAt, '人工画面/场景复核未通过');
      row.evidenceValid = envelopeValid && Boolean(review.reviewer?.trim() && review.notes?.trim() && review.sceneRestored === true && ['passed', 'failed'].includes(review.outcome) && review.reviewedAt >= manifest.startedAt);
      row.passed = row.reasons.length === 0; row.status = row.passed ? 'passed' : 'failed';
    } catch { row.reasons.push('运行或人工复核记录缺失/损坏，不能推定通过'); }
  }
  const totals = groups.map(group => { const selected = rows.filter(r => r.group === group); return { group, required: selected.length, recorded: selected.filter(r => r.status !== 'pending').length, passed: selected.filter(r => r.passed).length }; });
  const controls = await Promise.all(checklist.map(async key => { try { const item = await json(resolve(dir, `check-${key}.json`)); return { key, passed: item.outcome === 'passed' && Boolean(item.reviewer?.trim() && item.notes?.trim() && item.evidence?.trim()) && item.reviewedAt >= frozenAt }; } catch { return { key, passed: false }; } }));
  const cancels = rows.filter(r => r.group.startsWith('cancel-') && r.passed);
  const timing = { samples: cancels.length, resetP95Ms: percentile95(cancels.map(r => r.resetMs!)), ackP95Ms: percentile95(cancels.map(r => r.ackMs!)), targetMs: 500, measurement: 'Main stop handler entry → reset dispatch / Python neutral acknowledgement; excludes OS hotkey delivery and physical game animation' };
  const accepted = rows.every(r => r.evidenceValid) && totals.every(t => t.recorded === t.required && t.passed >= (t.group === 'move' || t.group === 'wait' ? 4 : t.required)) && controls.every(c => c.passed) && timing.samples >= 20 && timing.ackP95Ms! <= 500;
  return { schemaVersion: 1, campaignId: id, planHash, game: plan.game, scene: plan.scene, status: accepted ? 'accepted' : 'not_accepted', totals, timing, checklist: controls, rows, limitations: ['人工复核由操作者署名，不由结构审计代替；本工具不证明日志真实性。', '实机故障、暂停/接管与 UI 检查须逐项附证据。失败和缺失样例保留，不覆盖、不择优。'] };
}
