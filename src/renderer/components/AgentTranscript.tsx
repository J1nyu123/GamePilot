import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, RunStatus } from '../../contracts/debug';
import ToolCallItem from './ToolCallItem';
export const statusLabel: Record<RunStatus, string> = { pausing: '正在暂停', paused: '已暂停', idle: '等待任务', running: '运行中', canceling: '正在取消', protocol_passed: '模拟链路通过', control_passed: '真实输入链路通过', succeeded: '目标验证通过', blocked: '任务受阻 / 未通过验证', failed: '运行失败', canceled: '已取消', timed_out: '请求超时', budget_exceeded: '预算耗尽', incomplete: '链路未完成' };
export default function AgentTranscript({ events, status, phase }: { events: AgentEvent[]; status: RunStatus; phase: string }) {
  const viewport = useRef<HTMLDivElement>(null), follow = useRef(true);
  const [unread, setUnread] = useState(false), [copyNote, setCopyNote] = useState('');
  const previousRun = useRef('');
  useEffect(() => {
    const run = events[0]?.runId || '';
    if (run !== previousRun.current) { follow.current = true; previousRun.current = run; setUnread(false); }
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    else if (events.length) setUnread(true);
  }, [events]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopyNote('已复制'); }
    catch { setCopyNote('复制失败，请选择文本复制'); }
  };
  const turns = [...new Set(events.filter(e => e.turn).map(e => e.turn!))];
  const user = events.find(e => e.type === 'user_message');
  const completed = !['running', 'canceling', 'pausing', 'paused'].includes(status);
  const final = [...events].reverse().find(e => e.type === 'validation_end');
  const observation = events.find(e => e.type === 'observation');
  const real = events.some(e => e.simulated === false);
  return <div className="transcript-wrap">
    <div className="transcript" ref={viewport} aria-label="Agent 执行记录" onScroll={() => {
      const el = viewport.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      if (follow.current) setUnread(false);
    }}>
      {!events.length ? <div className="transcript-empty"><span className="terminal-mark">❯_</span><h3>每一步，都看得见</h3>
        <p>模型反馈、工具参数与执行结果<br />将按决策轮次出现在这里。</p><div className="legend"><span>● 模型反馈</span><span>● 工具调用</span><span>● 执行结果</span></div></div> : <>
        {user && <div className="user-message"><div className="event-label"><span>❯</span> USER <time>{new Date(user.timestamp).toLocaleTimeString()}</time></div><p>{user.text}</p></div>}
        {events.filter(e => e.type === 'input_preparing').map(e => <div className="observation-row" key={e.sequence}>{e.text}</div>)}
        <div className="observation-row"><span>◉</span> {real && !observation ? '等待准备完成后截图' : '已固定本次图片输入'} <span className="muted">{observation?.evidence ? `· 窗口源帧 #${observation.evidence.frameSequence} · 屏障后新帧` : real ? '' : '· 手动导入，采集时间未知'}</span></div>
        {turns.map(turn => {
          const rows = events.filter(e => e.turn === turn), text = rows.filter(e => e.type === 'model_text').map(e => e.text).join('');
          const argsDelta = rows.filter(e => e.type === 'tool_arguments_delta').map(e => e.text).join('');
          const tools = rows.filter(e => e.type === 'tool_execution_start');
          const modelEnd = rows.find(e => e.type === 'model_end');
          return <section className="turn" key={turn}>
            <div className="turn-label"><span className="mono">CYCLE {String(turn).padStart(2, '0')}</span><span />
              <time>{new Date(rows[0].timestamp).toLocaleTimeString()}</time></div>
            <div className="model-label">✦ MODEL <span>{modelEnd ? modelEnd.stopReason === 'toolUse' ? '返回工具调用' : modelEnd.stopReason === 'stop' ? '回复完成' : '请求结束' : '等待 / 接收响应'}</span></div>
            {text && <p className="model-text">{text}</p>}
            {modelEnd?.warning && <div className="model-warning">{modelEnd.warning}</div>}
            {modelEnd?.diagnostics && <details className="response-diagnostics"><summary>响应诊断 · 正文 {modelEnd.diagnostics.textChars} 字符 · 工具 {modelEnd.diagnostics.toolCallCount} 次</summary><pre className="json-block">{JSON.stringify(modelEnd.diagnostics, null, 2)}</pre></details>}
            {argsDelta && <details className="stream-args"><summary>工具参数接收过程{!modelEnd && <span className="activity-dot" />}</summary><pre className="json-block">{argsDelta}</pre></details>}
            {tools.map(start => <ToolCallItem key={start.toolCallId} start={start} ended={completed} verificationEvents={events.filter(e => e.toolCallId === start.toolCallId && (e.type.startsWith('verification_') || e.type.startsWith('observation_post') || e.type.startsWith('tracking_') || e.type.startsWith('approach_')))} end={events.find(e => e.type === 'tool_execution_end' && e.toolCallId === start.toolCallId)} />)}
            {modelEnd?.error && <div className="error-row"><span>× {modelEnd.error}</span><button onClick={() => copy(modelEnd.error!)}>复制详情</button></div>}
          </section>;
        })}
        {events.filter(e => e.type === 'input_interrupted' || e.type === 'input_released' || e.type.startsWith('task_')).map(e => <div className="observation-row" key={e.sequence}>{e.text}</div>)}
        {final && <div className={`run-end ${status === 'failed' || status === 'timed_out' ? 'error-color' : ''}`}><span>■ {statusLabel[status]}</span>
          <span>{final.summary?.gameOutcome === 'passed' && status === 'succeeded' ? '固定条件已通过独立 VLM 验证' : final.summary?.gameOutcome === 'failed' ? '固定目标未达到' : final.summary?.gameOutcome === 'inconclusive' ? '无法确认目标，未判成功' : '游戏效果未经验证'}</span>{final.summary?.error && <div className="error-row"><span>{final.summary.error}</span><button onClick={() => copy(final.summary!.error!)}>复制详情</button></div>}</div>}
        {!completed && <div className="active-stage"><span className="activity-dot" />{phase}</div>}
      </>}
    </div>
    {unread && <button className="new-events" onClick={() => { follow.current = true; setUnread(false); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}>↓ 有新事件</button>}
    {copyNote && <div className="copy-note" role="status" onClick={() => setCopyNote('')}>{copyNote}</div>}
  </div>;
}
