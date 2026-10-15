import { useEffect, useRef, useState, useMemo } from 'react';
import type { AgentEvent, RunStatus } from '../../contracts/debug';
import ApproachProgress from './ApproachProgress';
import VerificationItem from './VerificationItem';

export const statusLabel: Record<RunStatus, string> = {
  pausing: '正在暂停',
  paused: '已暂停',
  idle: '等待任务',
  completed: '回复完成',
  running: '运行中',
  canceling: '正在取消',
  protocol_passed: '模拟链路通过',
  control_passed: '真实输入链路通过',
  succeeded: '目标验证通过',
  blocked: '任务受阻 / 未通过验证',
  failed: '运行失败',
  canceled: '已取消',
  timed_out: '请求超时',
  budget_exceeded: '预算耗尽',
  incomplete: '链路未完成',
};

type StageKind = 'OBSERVE' | 'DECIDE' | 'ACT' | 'VERIFY' | 'ALERT' | 'PROMPT' | 'SYSTEM';

interface TimelineGroup {
  id: string;
  type: 'cycle' | 'prep' | 'direct' | 'settlement';
  title: string;
  subtitle: string;
  turn?: number;
  events: AgentEvent[];
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'running' | 'completed' | 'error' | 'success';
}

function getEventStage(e: AgentEvent): StageKind {
  if (e.isError || e.type === 'input_interrupted' || e.error) return 'ALERT';
  if (e.type === 'user_message') return 'PROMPT';
  if (['observation', 'observation_post', 'input_preparing', 'tracking_state'].includes(e.type)) {
    return 'OBSERVE';
  }
  if (['intent_resolved', 'model_text', 'model_end', 'approach_decision', 'tool_arguments_delta'].includes(e.type)) {
    return 'DECIDE';
  }
  if (['tool_execution_start', 'tool_execution_end', 'skill_released', 'input_released', 'skill_execution_start', 'approach_step', 'runner_execution'].includes(e.type)) {
    return 'ACT';
  }
  if (e.type.startsWith('verification_')) {
    return 'VERIFY';
  }
  return 'SYSTEM';
}

function getEventSummary(e: AgentEvent): { title: string; subtitle?: string; highlight?: string } {
  switch (e.type) {
    case 'user_message':
      return { title: '指令下达', subtitle: e.text || '' };
    case 'intent_resolved':
      return { title: '消息意图识别', subtitle: e.text };
    case 'input_preparing':
      return { title: '输入就绪准备', subtitle: e.text || '等待输入通道就绪' };
    case 'observation':
      return {
        title: '观察画面捕获',
        subtitle: e.evidence?.frameSequence != null ? `窗口源帧 #${e.evidence.frameSequence}` : '静态/导入源帧',
        highlight: e.simulated === false ? '真实链路' : e.simulated === true ? '模拟链路' : '窗口采集证据',
      };
    case 'observation_post':
      return {
        title: '新画面取证',
        subtitle: e.observationId ? `帧标识 #${e.observationId.slice(0, 8)}` : '新动作完成帧',
      };
    case 'model_text': {
      const clean = (e.text || '').replace(/\s+/g, ' ').trim();
      return {
        title: '模型 / 规划输出',
        subtitle: clean.length > 80 ? `${clean.slice(0, 80)}...` : clean,
      };
    }
    case 'tool_arguments_delta':
      return { title: '流式参数组装', subtitle: e.text?.slice(0, 48) || '接收参数包...' };
    case 'tool_execution_start': {
      const argStr = Object.entries(e.args || {})
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      return {
        title: `MCP · ${e.toolName || 'tool'}`,
        subtitle: argStr || '无参数',
        highlight: e.toolName,
      };
    }
    case 'tool_execution_end':
      return {
        title: `MCP 回执 · ${e.toolName || 'tool'}`,
        subtitle: e.isError ? (e.error || '执行异常') : '执行成功完成',
        highlight: typeof e.durationMs === 'number' ? `${e.durationMs}ms` : undefined,
      };
    case 'skill_released':
      return {
        title: '手柄输入释放与归零',
        subtitle: e.release?.receipt ? `回执: ${e.release.receipt.status}` : '归零回执见事件详情；尚未确认',
      };
    case 'input_released':
      return { title: '虚拟输入通道释放', subtitle: e.text || '输入通道空闲' };
    case 'verification_start':
      return { title: '目标验证启动', subtitle: e.text || '独立多模态/证据验证' };
    case 'verification_end': {
      const verdict = e.verification?.verdict;
      const verdictLabel = verdict === 'passed' ? '✓ 目标达成' : verdict === 'failed' ? '✗ 目标未达到' : '证据不足 / 待确认';
      return {
        title: `目标验证结论 · ${verdictLabel}`,
        subtitle: `${e.verification?.method === 'vlm' ? '独立视觉验证' : '规则验证'} · ${e.verification?.summary || ''}`,
        highlight: typeof e.verification?.durationMs === 'number' ? `${Math.round(e.verification.durationMs)}ms` : undefined,
      };
    }
    case 'tracking_state':
      return { title: '目标视觉伺服跟踪', subtitle: e.text || '更新目标像素坐标与置信度' };
    case 'approach_step':
      return { title: '逼近纠偏步进', subtitle: e.text || '执行微调输入' };
    case 'approach_decision':
      return { title: '逼近策略决策', subtitle: e.text || '计算位移偏角' };
    case 'approach_end':
      return { title: '逼近任务终止', subtitle: e.text || '达到停止条件' };
    case 'model_end':
      return {
        title: '模型响应收尾',
        subtitle: e.stopReason === 'toolUse' ? '请求调用 MCP 工具' : e.stopReason === 'stop' ? '完整输出完成' : `结束状态: ${e.stopReason || 'ok'}`,
      };
    case 'input_interrupted':
      return { title: '输入强制中断', subtitle: e.text || '操作被中断或触发保护' };
    case 'control_stop': {
      const receipt = e.result as { reason?: string; stopTiming?: { reason?: string } } | undefined;
      return { title: '控制停止', subtitle: receipt?.stopTiming?.reason || receipt?.reason || e.text || '停止原因见回执' };
    }
    case 'runner_end':
      return { title: '执行链路完成', subtitle: `状态: ${statusLabel[e.status || 'idle']}` };
    default:
      return { title: e.type, subtitle: e.error || e.text || '' };
  }
}

export default function AgentTranscript({
  events,
  status,
  phase,
}: {
  events: AgentEvent[];
  status: RunStatus;
  phase: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [unread, setUnread] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const previousRun = useRef('');

  useEffect(() => {
    const run = events[0]?.runId || '';
    if (run !== previousRun.current) {
      follow.current = true;
      previousRun.current = run;
      setUnread(false);
      setExpandedNodes({});
      setCollapsedGroups({});
    }
    if (follow.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    } else if (events.length) {
      setUnread(true);
    }
  }, [events]);

  const copy = async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote(label);
      setTimeout(() => setCopyNote(''), 2500);
    } catch {
      setCopyNote('复制失败，请手动选择');
      setTimeout(() => setCopyNote(''), 2500);
    }
  };

  // Group events chronologically into Decision Cycles / Execution Phases
  const timelineGroups = useMemo<TimelineGroup[]>(() => {
    if (!events.length) return [];

    const turns = Array.from(new Set(events.filter(e => typeof e.turn === 'number').map(e => e.turn!))).sort((a, b) => a - b);
    const groups: TimelineGroup[] = [];

    if (turns.length === 0) {
      const hasError = events.some(e => e.isError || e.type === 'input_interrupted');
      const hasSuccess = events.some(e => e.verification?.verdict === 'passed');
      groups.push({
        id: 'direct-execution',
        type: 'direct',
        title: 'DIRECT · 连续技能执行链路',
        subtitle: `${events.length} 个事件节点`,
        events,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1].timestamp,
        durationMs: Math.max(0, events[events.length - 1].timestamp - events[0].timestamp),
        status: hasError ? 'error' : hasSuccess ? 'success' : status === 'running' ? 'running' : 'completed',
      });
      return groups;
    }

    // 1. Initial / Prep Phase (events before first turn)
    const firstTurn = turns[0];
    const firstTurnFirstEventSeq = events.find(e => e.turn === firstTurn)?.sequence ?? Infinity;
    const prepEvents = events.filter(e => e.sequence < firstTurnFirstEventSeq);
    if (prepEvents.length > 0) {
      groups.push({
        id: 'group-prep',
        type: 'prep',
        title: 'PHASE 00 · 初始化与输入感知',
        subtitle: '建立视觉感知源与指令确认',
        events: prepEvents,
        startTime: prepEvents[0].timestamp,
        endTime: prepEvents[prepEvents.length - 1].timestamp,
        durationMs: Math.max(0, prepEvents[prepEvents.length - 1].timestamp - prepEvents[0].timestamp),
        status: 'completed',
      });
    }

    // 2. Decision Cycle Groups
    const lastTurn = turns[turns.length - 1];
    let lastTurnLastEventSeq = -1;

    for (const turn of turns) {
      const turnEvents = events.filter(e => e.turn === turn);
      const firstSeq = turnEvents[0]?.sequence ?? Infinity;
      const nextTurn = turns[turns.indexOf(turn) + 1];
      const endSeq = nextTurn === undefined ? (turnEvents.at(-1)?.sequence ?? -1) + 1 : events.find(e => e.turn === nextTurn)!.sequence;
      // Host events such as focus loss and pause have no Agent turn number.
      // Keep those events in their chronological interval instead of dropping them.
      const cycleEvents = events.filter(e => e.turn === turn || (e.turn === undefined && e.sequence >= firstSeq && e.sequence < endSeq));
      if (!cycleEvents.length) continue;
      const lastSeq = cycleEvents[cycleEvents.length - 1].sequence;
      if (lastSeq > lastTurnLastEventSeq) lastTurnLastEventSeq = lastSeq;

      const hasError = cycleEvents.some(e => e.isError || e.type === 'input_interrupted');
      const hasSuccess = cycleEvents.some(e => e.verification?.verdict === 'passed');
      const isRunning = status === 'running' && turn === lastTurn;

      groups.push({
        id: `cycle-${turn}`,
        type: 'cycle',
        turn,
        title: `CYCLE ${String(turn).padStart(2, '0')}`,
        subtitle: `决策与执行回路 #${turn}`,
        events: cycleEvents,
        startTime: cycleEvents[0].timestamp,
        endTime: cycleEvents[cycleEvents.length - 1].timestamp,
        durationMs: Math.max(0, cycleEvents[cycleEvents.length - 1].timestamp - cycleEvents[0].timestamp),
        status: hasError ? 'error' : hasSuccess ? 'success' : isRunning ? 'running' : 'completed',
      });
    }

    // 3. Settlement / Outcome Phase (events after last turn)
    const postEvents = events.filter(e => e.sequence > lastTurnLastEventSeq);
    if (postEvents.length > 0) {
      const hasError = postEvents.some(e => e.isError || e.summary?.error);
      const hasSuccess = postEvents.some(e => e.summary?.gameOutcome === 'passed' || e.verification?.verdict === 'passed');
      groups.push({
        id: 'group-settlement',
        type: 'settlement',
        title: 'SETTLEMENT · 目标验证与结算',
        subtitle: '终局判定与手柄释放',
        events: postEvents,
        startTime: postEvents[0].timestamp,
        endTime: postEvents[postEvents.length - 1].timestamp,
        durationMs: Math.max(0, postEvents[postEvents.length - 1].timestamp - postEvents[0].timestamp),
        status: hasError ? 'error' : hasSuccess ? 'success' : 'completed',
      });
    }

    return groups;
  }, [events, status]);

  const expandAllNodes = () => {
    const next: Record<number, boolean> = {};
    for (const e of events) next[e.sequence] = true;
    setExpandedNodes(next);
  };

  const collapseAllNodes = () => {
    setExpandedNodes({});
  };

  const toggleNode = (seq: number) => {
    setExpandedNodes(prev => ({ ...prev, [seq]: !prev[seq] }));
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const turnsCount = useMemo(() => new Set(events.filter(e => e.turn).map(e => e.turn!)).size, [events]);
  const actsCount = useMemo(() => events.filter(e => ['tool_execution_start', 'skill_released'].includes(e.type)).length, [events]);
  const verificationsCount = useMemo(() => events.filter(e => e.type === 'verification_end').length, [events]);
  const latestVerdict = useMemo(() => {
    return [...events].reverse().find(e => e.type === 'verification_end')?.verification?.verdict;
  }, [events]);

  const copyFullTrace = () => {
    copy(JSON.stringify(events, null, 2), '全量 Trace 数据已复制');
  };

  return (
    <div className="tui-trace-wrap">
      {/* TUI Monospace Metrics & Quick Action Line */}
      <div className="tui-trace-topbar">
        <div className="tui-trace-stats">
          <span className="tui-stat-tag">
            cycles: <b>{turnsCount}</b>
          </span>
          <span className="tui-stat-sep">·</span>
          <span className="tui-stat-tag">
            actions: <b>{actsCount}</b>
          </span>
          <span className="tui-stat-sep">·</span>
          <span className="tui-stat-tag">
            verifications: <b>{verificationsCount}</b>
          </span>
          {latestVerdict && (
            <>
              <span className="tui-stat-sep">·</span>
              <span className={`tui-stat-verdict ${latestVerdict}`}>
                {latestVerdict === 'passed' ? '✔ passed' : latestVerdict === 'failed' ? '✖ failed' : '⋯ pending'}
              </span>
            </>
          )}
        </div>

        <div className="tui-trace-actions">
          <button
            type="button"
            className="tui-action-link"
            onClick={expandAllNodes}
            title="全部展开树状回执详情"
          >
            [+] 展开全部
          </button>
          <button
            type="button"
            className="tui-action-link"
            onClick={collapseAllNodes}
            title="收起为单行摘要"
          >
            [-] 折叠全部
          </button>
          <button
            type="button"
            className="tui-action-link copy"
            onClick={copyFullTrace}
            title="复制完整 Trace JSON 到剪贴板"
          >
            [📋 复制 Trace]
          </button>
        </div>
      </div>

      {/* Main Connected CLI Tree Stream */}
      <div
        className="tui-trace-viewport transcript"
        ref={viewport}
        aria-label="Agent 执行时间轴 (Claude Code TUI)"
        onScroll={() => {
          if (!viewport.current) return;
          const el = viewport.current;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (follow.current) setUnread(false);
        }}
      >
        {!events.length ? (
          <div className="tui-empty-trace">
            <span className="tui-prompt-symbol">❯_</span>
            <div className="tui-empty-trace-title">TRACE STREAM READY</div>
            <div className="tui-empty-trace-desc">
              等待第一条 Trace 执行流。任务启动后，决策回路、MCP 工具调用与视觉验证将以 Claude Code 树状折线流实时呈现。
            </div>
            <div className="tui-tree-legend">
              <span className="tui-legend-item">│ ⏺ OBSERVE</span>
              <span className="tui-legend-item">│ ✢ DECIDE</span>
              <span className="tui-legend-item">│ ⏺ ACT</span>
              <span className="tui-legend-item">│ ✔ VERIFY</span>
            </div>
          </div>
        ) : (
          <div className="tui-tree-stream">
            {timelineGroups.map(group => {
              const isCollapsed = Boolean(collapsedGroups[group.id]);
              const durationText = group.durationMs > 0 ? `${(group.durationMs / 1000).toFixed(2)}s` : '<10ms';

              return (
                <div key={group.id} className={`tui-cycle-group ${group.status}`}>
                  {/* Cycle Header Line: ASCII border bracket style */}
                  <div
                    className="tui-cycle-header"
                    onClick={() => toggleGroup(group.id)}
                    title="点击折叠/展开本周期"
                  >
                    <span className="tui-tree-bracket">
                      {isCollapsed ? '▸' : '▾'} ┌──
                    </span>
                    <span className="tui-cycle-title">{group.title}</span>
                    <span className="tui-cycle-line">───</span>
                    <span className="tui-cycle-subtitle">{group.subtitle}</span>
                    <span className="tui-cycle-line fill">────────────────────────</span>
                    <span className="tui-cycle-meta">
                      {group.events.length} evts · {durationText}
                    </span>
                    <span className={`tui-cycle-status ${group.status}`}>
                      [{group.status}]
                    </span>
                  </div>

                  {/* Nodes in this Cycle */}
                  {!isCollapsed && (
                    <div className="tui-cycle-body">
                      {group.events.some(e => e.type === 'model_text') && <p className="model-text">{group.events.filter(e => e.type === 'model_text').map(e => e.text).join('')}</p>}
                      {group.events.filter(e => e.type === 'model_end').map(e => <div key={`diagnostics-${e.sequence}`}>
                        {e.warning && <div className="model-warning">{e.warning}</div>}
                        {e.error && <div className="error-row">{e.error}</div>}
                        {e.diagnostics && <details className="response-diagnostics"><summary>响应诊断 · 正文 {e.diagnostics.textChars} 字符 · 工具 {e.diagnostics.toolCallCount} 次</summary><pre>{JSON.stringify(e.diagnostics, null, 2)}</pre></details>}
                      </div>)}
                      {group.events.map((event, idx) => {
                        const isLastInGroup = idx === group.events.length - 1;
                        const stage = getEventStage(event);
                        const isExpanded = Boolean(expandedNodes[event.sequence]);
                        const { title, subtitle, highlight } = getEventSummary(event);
                        const timeStr = new Date(event.timestamp).toLocaleTimeString();

                        // Glyph selection by stage
                        let glyph = '⏺';
                        let glyphClass = 'glyph-dot';
                        if (stage === 'ALERT') {
                          glyph = '✖';
                          glyphClass = 'glyph-err';
                        } else if (stage === 'PROMPT') {
                          glyph = '❯';
                          glyphClass = 'glyph-prompt';
                        } else if (stage === 'DECIDE') {
                          glyph = '✢';
                          glyphClass = 'glyph-spark';
                        } else if (stage === 'VERIFY') {
                          const verdict = event.verification?.verdict;
                          if (verdict === 'passed') {
                            glyph = '✔';
                            glyphClass = 'glyph-ok';
                          } else if (verdict === 'failed') {
                            glyph = '✖';
                            glyphClass = 'glyph-err';
                          } else {
                            glyph = '⏺';
                            glyphClass = 'glyph-verify';
                          }
                        }

                        // Structured details payload for expansion
                        const detailsPayload =
                          event.verification ??
                          event.result ??
                          event.args ??
                          event.release ??
                          (event.diagnostics ? { diagnostics: event.diagnostics } : null) ??
                          { type: event.type, text: event.text };

                        return (
                          <div
                            key={event.sequence}
                            className={`tui-tree-row ${isExpanded ? 'is-expanded' : ''}`}
                          >
                            {/* Tree Main Line */}
                            <div
                              className="tui-row-header"
                              onClick={() => toggleNode(event.sequence)}
                            >
                              <span className="tui-tree-stem">│</span>
                              <span className={`tui-node-glyph ${glyphClass}`}>
                                {glyph}
                              </span>
                              <span className={`tui-node-stage stage-${stage.toLowerCase()}`}>
                                {stage}
                              </span>
                              <span className="tui-node-title">{title}</span>
                              {highlight && (
                                <span className="tui-node-highlight">({highlight})</span>
                              )}
                              <span className="tui-row-spacer" />
                              <span className="tui-node-time">{timeStr}</span>
                              <span className="tui-node-toggle">
                                {isExpanded ? '[-]' : '[+]'}
                              </span>
                            </div>

                            {/* Short subtitle preview line if present */}
                            {subtitle && !isExpanded && (
                              <div
                                className="tui-row-preview"
                                onClick={() => toggleNode(event.sequence)}
                              >
                                <span className="tui-tree-stem">│</span>
                                <span className="tui-tree-indent"> </span>
                                <span className="tui-preview-text">{subtitle}</span>
                              </div>
                            )}

                            {/* Expanded Tree Branches: ⎿ tree branches */}
                            {isExpanded && (
                              <div className="tui-expanded-branches">
                                {subtitle && (
                                  <div className="tui-branch-line">
                                    <span className="tui-tree-stem">│</span>
                                    <span className="tui-tree-corner">⎿</span>
                                    <span className="tui-branch-label">desc:</span>
                                    <span className="tui-branch-val">{subtitle}</span>
                                  </div>
                                )}

                                {/* Arguments breakdown */}
                                {Boolean(event.args) && Object.keys(event.args || {}).length > 0 && (
                                  <div className="tui-branch-line">
                                    <span className="tui-tree-stem">│</span>
                                    <span className="tui-tree-corner">⎿</span>
                                    <span className="tui-branch-label">params:</span>
                                    <span className="tui-branch-args">
                                      {Object.entries(event.args || {}).map(([k, v]) => (
                                        <span key={k} className="tui-arg-item">
                                          {k}=
                                          <span className="tui-arg-val">
                                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                          </span>
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                )}

                                {/* Execution Result & Duration */}
                                {Boolean(event.result) && (
                                  <div className="tui-branch-line">
                                    <span className="tui-tree-stem">│</span>
                                    <span className="tui-tree-corner">⎿</span>
                                    <span className="tui-branch-label">result:</span>
                                    <span className="tui-branch-val">
                                      {typeof event.durationMs === 'number' && `(took ${event.durationMs}ms) `}
                                      {typeof event.result === 'object'
                                        ? JSON.stringify(event.result)
                                        : String(event.result)}
                                    </span>
                                  </div>
                                )}

                                {/* Verification Verdict details */}
                                {event.verification && (
                                  <div className="tui-branch-line">
                                    <span className="tui-tree-stem">│</span>
                                    <span className="tui-tree-corner">⎿</span>
                                    <span className="tui-branch-label">verification:</span>
                                    <span className={`tui-branch-verdict ${event.verification.verdict}`}>
                                      [{event.verification.verdict.toUpperCase()}]
                                    </span>
                                    <span className="tui-branch-val">
                                      {event.verification.method === 'vlm' ? '多模态视觉判断' : '规则判定'}
                                      {event.verification.summary ? ` · ${event.verification.summary}` : ''}
                                    </span>
                                  </div>
                                )}

                                {/* Specialized Subcomponents if needed */}
                                {event.type.startsWith('verification_') && (
                                  <div className="tui-branch-subview">
                                    <VerificationItem
                                      events={[event]}
                                      ended={status !== 'running'}
                                    />
                                  </div>
                                )}


                                {/* Collapsible JSON Tree Leaf */}
                                <div className="tui-branch-line json-row">
                                  <span className="tui-tree-stem">│</span>
                                  <span className="tui-tree-corner">⎿</span>
                                  <span className="tui-branch-label">raw json:</span>
                                  <button
                                    type="button"
                                    className="tui-mini-copy-btn"
                                    onClick={() => copy(JSON.stringify(detailsPayload, null, 2), `节点 #${event.sequence} JSON 已复制`)}
                                  >
                                    [copy]
                                  </button>
                                </div>
                                <div className="tui-raw-json-block">
                                  <span className="tui-tree-stem">│</span>
                                  <span className="tui-json-pad" />
                                  <pre className="tui-mono-pre">
                                    {JSON.stringify(detailsPayload, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}

                            {/* Spacing between nodes or cycle end */}
                            {isLastInGroup && (
                              <div className="tui-cycle-tail">
                                <span className="tui-tree-bracket">└──</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {events.some(e => e.type.startsWith('approach_') || e.type === 'tracking_state') && <section aria-label={events.some(e => e.type === 'skill_execution_start') ? '直接技能执行记录' : '反馈技能执行记录'}><ApproachProgress events={events} /></section>}
            {events.some(e => e.type === 'verification_end') && <VerificationItem events={events.filter(e => e.type === 'verification_end')} ended={!['running', 'canceling', 'pausing', 'paused'].includes(status)} />}
            {events.filter(e => e.type === 'validation_end').map(e => <div className="run-end" key={`end-${e.sequence}`}>
              <span>■ {statusLabel[e.summary?.status || status]} · {e.summary?.gameOutcome === 'passed' ? '固定条件在引用观察时点通过独立验证' : '游戏目标未经验证或未通过'}</span>
              {e.summary?.runResult && <span>停止原因：{e.summary.runResult.stopReason} · 执行路径：{e.summary.runResult.strategy === 'direct' ? '直接技能' : 'Agent'}</span>}
              {e.summary?.error && <div className="error-row">{e.summary.error}</div>}
            </div>)}
            {/* In-Progress Live Activity Pulse */}
            {status === 'running' && (
              <div className="tui-live-stream-pulse">
                <span className="activity-dot dot-amber" />
                <span className="tui-pulse-symbol">✢</span>
                <span className="tui-pulse-text">{phase || 'Agent 正在进行下一轮决策与输入...'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Unread Notification */}
      {unread && (
        <button
          className="tui-floating-unread"
          onClick={() => {
            follow.current = true;
            setUnread(false);
            if (viewport.current) {
              viewport.current.scrollTop = viewport.current.scrollHeight;
            }
          }}
        >
          ↓ 新的 Trace 执行流输出
        </button>
      )}

      {/* Toast Notification */}
      {copyNote && (
        <div className="tui-toast-msg" role="status" onClick={() => setCopyNote('')}>
          {copyNote}
        </div>
      )}
    </div>
  );
}
