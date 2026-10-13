import type { AgentEvent } from '../../contracts/debug';
import type { TargetState, ApproachStats } from '../../contracts/approach';
export default function ApproachProgress({ events }: { events: AgentEvent[] }) {
  const states = events.filter(e => e.type === 'tracking_state'), state = states.at(-1)?.result as TargetState | undefined;
  const steps = events.filter(e => e.type === 'approach_step'), end = events.find(e => e.type === 'approach_end')?.result as ApproachStats | undefined;
  return <div className="approach-progress" aria-label="P3 反馈进度">
    <strong>视觉反馈 · {steps.length}/8 段 · {end ? end.stopReason : '运行中'}</strong>
    {state && <p>目标{state.visible ? '可见' : '丢失'} · {state.mode} · 置信度 {state.confidence.toFixed(2)}（模型自报）<br />帧 {state.observationId.slice(0, 8)} · 状态 v{state.version} · 框 {JSON.stringify(state.box)}</p>}
    {state?.interaction && <p>目标交互提示：{state.interaction.status} · {state.interaction.text || "无可确认文字"}</p>}
    {state?.invalidReason && <p role="alert">定位响应无效：{state.invalidReason}</p>}
    <details><summary>目标跟踪与纠偏证据</summary>{events.filter(e => e.type.startsWith('tracking_') || e.type.startsWith('approach_')).map(event => <div key={event.sequence}><p>{event.text}</p>{event.result != null && <pre className="json-block">{JSON.stringify(event.result, null, 2)}</pre>}</div>)}</details>
  </div>;
}
