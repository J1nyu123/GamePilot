import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AgentEvent, ImportedImage, RunSummary } from '../contracts/debug';
import type { FrameEvidence } from '../contracts/capture';
import type { GoalSpec, ReleaseEvidence } from '../contracts/verification';
import { acceptanceCases, type AcceptanceCaseId } from '../contracts/acceptance';
import { checkEvidence, parseVerdict } from '../verification/evidence';

interface SavedObservation { observationId: string; phase: 'before' | 'after'; path: string; evidence: FrameEvidence; release?: ReleaseEvidence }
interface Manifest { schemaVersion: number; runId: string; simulated: boolean; input: { id: string; source: string }; goal: GoalSpec; observations: SavedObservation[]; endpoint: string }
export interface AuditReport {
  schemaVersion: 1; runId?: string; caseId?: AcceptanceCaseId; technicalPassed: boolean;
  humanReview: 'required'; physicalInputVerified: null; testData: boolean;
  status?: string; gameOutcome?: string;
  checks: { name: string; ok: boolean }[];
  limitations: string[];
}

// Offline consistency check, not replay, execution, visual proof or a P4 success-rate evaluator.
export async function auditRun(directory: string, caseId?: AcceptanceCaseId): Promise<AuditReport> {
  const report: AuditReport = { schemaVersion: 1, caseId, technicalPassed: false, humanReview: 'required', physicalInputVerified: null,
    testData: false, checks: [], limitations: ['必须人工对照关键截图和游戏反应；结构通过不等于视觉判定正确。',
      '只核对已记录的证据，不验证日志真实性，不推算停止时延，不从 canceled 推断按过 F8。'] };
  const check = (name: string, ok: unknown) => { report.checks.push({ name, ok: Boolean(ok) }); };
  try {
    const root = await realpath(directory);
    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as Manifest;
    const summary = JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8')) as RunSummary;
    const events = (await readFile(resolve(root, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) as AgentEvent[];
    report.runId = manifest.runId; report.status = summary.status; report.gameOutcome = summary.gameOutcome;
    let localEndpoint = false;
    try { localEndpoint = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(manifest.endpoint).hostname); } catch { check('模型端点格式有效', false); }
    report.testData = localEndpoint || await stat(resolve(root, 'test-context.json')).then(() => true, () => false)
      || manifest.observations?.some(o => /非游戏|测试窗口/.test(o.evidence?.title ?? '')) || manifest.simulated === true;
    check('schemaVersion=2，固定目标和窗口输入', manifest.schemaVersion === 2 && manifest.goal?.id && manifest.goal.successCondition?.trim() && manifest.input?.source === 'window');
    check('模拟标志在 manifest/summary 一致', typeof manifest.simulated === 'boolean' && manifest.simulated === summary.simulated);
    check('事件 runId、时间戳及递增 sequence 完整', events.length > 0 && events.every((e, i) => e.runId === manifest.runId && e.sequence === i + 1 && Number.isFinite(e.timestamp)));
    const completion = events.at(-1);
    check('最终事件与 summary 完全一致', completion?.type === 'validation_end' && JSON.stringify(completion.summary) === JSON.stringify(summary));
    const released = [...events].reverse().find(e => e.type === 'input_released');
    check('最终完成前服务确认归零', (released?.result as { neutral?: boolean })?.neutral === true && released!.sequence < (completion?.sequence ?? 0));
    const records = manifest.observations;
    check('关键帧 ID 唯一且初始帧匹配模型输入', Array.isArray(records) && records.length > 0 && records[0].phase === 'before'
      && records[0].observationId === manifest.input.id && new Set(records.map(o => o.observationId)).size === records.length);
    const image = (o: SavedObservation) => ({ id: o.observationId, source: 'window', evidence: o.evidence }) as ImportedImage;
    let inputMatches = false;
    if (/^observations\/[a-zA-Z0-9-]{1,80}\.(jpg|png)$/.test(records[0].path)) {
      try {
        const initial = await readFile(resolve(root, records[0].path));
        const input = await readFile(resolve(root, records[0].path.endsWith('.png') ? 'input.png' : 'input.jpg'));
        inputMatches = initial.length > 0 && initial.equals(input);
      } catch { /* Incomplete trace, not accepted evidence. */ }
    }
    check('实际初始模型输入与初始关键帧字节一致', inputMatches);
    for (const [index, record] of records.entries()) {
      let fileValid = false;
      if (/^[a-zA-Z0-9-]{1,80}$/.test(record.observationId) && record.path === `observations/${record.observationId}.${record.path.endsWith('.png') ? 'png' : 'jpg'}`) {
        try {
          const target = await realpath(resolve(root, record.path));
          const rel = relative(root, target);
          const info = await stat(target);
          fileValid = !isAbsolute(rel) && !rel.startsWith('..') && info.isFile() && info.size > 0;
        } catch { /* Missing files and escaping symlinks fail, without printing private file contents. */ }
      }
      check(`关键帧 ${index + 1} 文件非空且位于运行目录`, fileValid);
      if (index > 0) check(`关键帧 ${index + 1} 释放与源屏障有效`, record.phase === 'after' && record.release
        && !checkEvidence(image(records[index - 1]), image(record), record.release));
    }
    for (const event of events.filter(e => e.type === 'verification_end')) {
      const v = event.verification;
      const after = records.find(o => o.phase === 'after' && o.release?.id === v?.releaseId && v?.evidenceIds?.includes(o.observationId));
      check(`验证事件 ${event.sequence} 三态与公开事实格式有效`, v && ['vlm', 'evidence-check'].includes(v.method)
        && JSON.stringify(parseVerdict(JSON.stringify({ verdict: v.verdict, summary: v.summary, facts: v.facts })))
          === JSON.stringify({ verdict: v.verdict, summary: v.summary, facts: v.facts }));
      // Evidence-check failures legitimately may have no after frame. A conclusive VLM result cannot.
      check(`验证事件 ${event.sequence} 固定目标及证据引用`, v?.goalId === manifest.goal.id
        && (v.method === 'evidence-check' && v.verdict === 'inconclusive' || (after && v.evidenceIds.includes(records[0].observationId) && v.evidenceIds.includes(after.observationId))));
    }
    const latest = [...events].reverse().find(e => e.type === 'verification_end')?.verification;
    if (summary.verification) check('summary 引用最新验证结果', JSON.stringify(summary.verification) === JSON.stringify(latest));
    if (summary.status === 'succeeded' || summary.gameOutcome === 'passed') {
      const after = records.at(-1);
      check('完成有独立 passed 与最终关键帧引用', summary.status === 'succeeded' && summary.gameOutcome === 'passed'
        && summary.verification?.id === latest?.id
        && latest?.verdict === 'passed' && latest.method === 'vlm' && latest.goalId === manifest.goal.id
        && after?.phase === 'after' && latest.releaseId === after.release?.id && latest.evidenceIds.includes(after.observationId)
        && latest.facts.length > 0);
    }
    if (['canceled', 'timed_out', 'failed'].includes(summary.status)) check('中止/故障不接受目标成功', summary.gameOutcome === 'unverified');
    if (summary.status === 'blocked') check('受阻不误报通过且结论匹配最新验证', summary.gameOutcome !== 'passed'
      && (!latest || summary.gameOutcome === latest.verdict));
    const tools = events.filter(e => e.type === 'tool_execution_start');
    const moves = tools.filter(e => e.toolName === 'move_for');
    const waits = tools.filter(e => e.toolName === 'wait_for_state');
    if (caseId) {
      const preset = acceptanceCases.find(item => item.id === caseId)!;
      check('验收候选不是模拟/本地模型测试数据', manifest.simulated === false && !report.testData);
      check('验收目标与所选样例一致', caseId === 'move' ? Boolean(manifest.goal.successCondition.trim()) : manifest.goal.successCondition === preset.condition);
      if (caseId === 'move') {
        check('恰好一次前移 500ms，无额外工具', tools.length === 1 && moves.length === 1 && moves[0].args?.direction === 'forward' && moves[0].args.durationMs === 500);
        check('移动后完成独立 VLM 验证', events.some(e => e.type === 'verification_end' && e.verification?.method === 'vlm'));
        check('移动目标判定通过（仍须人工复核）', summary.status === 'succeeded' && latest?.verdict === 'passed');
      } else {
        check('只读样例没有移动或其他游戏工具', moves.length === 0 && tools.length === waits.length && waits.length === 1);
        if (caseId === 'cancel') {
          check('验证阶段取消且不误报成功', summary.status === 'canceled' && summary.gameOutcome === 'unverified'
            && events.some(e => e.type === 'verification_start' && e.sequence < (released?.sequence ?? 0)));
        } else {
          const expected = caseId === 'hud' ? 'passed' : caseId === 'negative' ? 'failed' : 'inconclusive';
          check('独立 VLM 得到样例预期三态', latest?.method === 'vlm' && latest.verdict === expected);
          check('最终状态与预期三态一致', caseId === 'hud' ? summary.status === 'succeeded' && summary.gameOutcome === 'passed'
            : summary.status === 'blocked' && summary.gameOutcome === expected);
        }
      }
    }
  } catch { check('运行文件可读取且符合结构，缺少/损坏记录不推定成功', false); }
  report.technicalPassed = report.checks.length > 0 && report.checks.every(item => item.ok);
  return report;
}
