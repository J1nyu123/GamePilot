import ApproachProgress from './ApproachProgress';
import { useState } from 'react';
import type { AgentEvent } from '../../contracts/debug';
import VerificationItem from './VerificationItem';
export default function ToolCallItem({ start, end, ended, verificationEvents = [] }: { start: AgentEvent; end?: AgentEvent; ended: boolean; verificationEvents?: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  const approach = start.toolName === 'approach_target';
  const wait = start.toolName === 'wait_for_state' || approach;
  const details = (end?.result as { details?: { execution?: string; verification?: { verdict: string } } } | undefined)?.details;
  const waitPassed = details?.verification?.verdict === 'passed';
  const status = end ? (end.isError ? '执行异常' : wait ? waitPassed ? '条件已满足' : '等待已结束，条件未通过' : '执行完成') : ended ? '未完成' : '校验 / 执行中';
  return <div className="tool-item">
    <button className="tool-toggle" onClick={() => setOpen(x => !x)} aria-expanded={open}>
      <span className="chevron">{open ? '▾' : '▸'}</span><span className="tool-name mono">{start.toolName}</span>
      <span className="tool-args mono">{Object.entries(start.args || {}).map(([k, v]) => `${k}=${String(v)}`).join(' ')}</span>
      <span className={`tool-state ${end?.isError ? 'error-color' : end && (!wait || waitPassed) ? 'success-color' : ''}`}>{status}</span>
    </button>
    {open && <pre className="json-block">{JSON.stringify(start.args, null, 2)}</pre>}
    {end && <div className="tool-result"><span className={end.isError ? 'error-color' : wait && !waitPassed ? 'muted' : 'success-color'}>{end.isError ? '×' : wait && !waitPassed ? '·' : '✓'}</span>
      <span>{end.isError ? '工具返回异常 / 未完成' : approach ? '反馈技能结束 · 执行和目标结果见证据' : wait ? '只读观察结束 · 未发送移动输入' : end.simulated === false ? details?.verification ? '真实输入已执行并释放 · 目标结论见验证记录' : '真实输入已执行并释放 · 游戏效果未验证' : '模拟动作已完成'}</span>{typeof end.durationMs === 'number' && <span className="mono">{end.durationMs} ms</span>}
      <details><summary>结果 JSON</summary><pre className="json-block">{JSON.stringify(end.result, null, 2)}</pre></details></div>}
    {approach && <ApproachProgress events={verificationEvents} />}
    <VerificationItem events={verificationEvents} ended={ended || Boolean(end)} />
  </div>;
}
