import type { AgentEvent } from '../../contracts/debug';
export default function VerificationItem({ events, ended }: { events: AgentEvent[]; ended: boolean }) {
  const results = events.filter(event => event.type === 'verification_end');
  const last = events.at(-1);
  return <div className="verification-items">
    {results.map(event => {
      const result = event.verification; if (!result) return null;
      const label = result.verdict === 'passed' ? '目标条件通过（VLM）' : result.verdict === 'failed' ? '目标条件未达到' : '证据不足 / 无法判断';
      return <div className={`verification-item ${result.verdict}`} key={event.sequence}>
        <div>◇ VERIFICATION · {label} {typeof result.durationMs === 'number' && <span className="mono">{Math.round(result.durationMs)} ms</span>}</div>
        <p>{result.summary}</p>
        <details><summary>验证事实与截图引用</summary><pre className="json-block">{JSON.stringify(result, null, 2)}</pre></details>
      </div>;
    })}
    {!ended && last && last.type !== 'verification_end' && <div className="active-stage"><span className="activity-dot" />{events.some(e => e.type === 'verification_start') ? '正在独立验证目标' : '输入已释放，等待动作后新帧'}</div>}
  </div>;
}
