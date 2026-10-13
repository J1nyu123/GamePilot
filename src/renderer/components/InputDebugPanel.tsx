import { useEffect, useRef, useState } from 'react';
import type { InputDebugState, InputMode, ManualSkill, XboxButton } from '../../contracts/input';
import { buttons } from '../../input/skills';
import { GAMEPAD_TOOL_DEFINITIONS } from '../../mcp/tool-definitions';

// 2D Circular Joystick Crosshair Visualizer Component
function JoystickWidget({
  label,
  x,
  y,
  onChange,
  disabled,
}: {
  label: string;
  x: number;
  y: number;
  onChange?(newX: number, newY: number): void;
  disabled?: boolean;
}) {
  const size = 70;
  const radius = size / 2;
  const dotX = radius + x * (radius - 8);
  const dotY = radius - y * (radius - 8); // Invert Y so positive is up
  const magnitude = Math.sqrt(x * x + y * y);
  const isNeutral = Math.abs(x) < 0.05 && Math.abs(y) < 0.05;

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left - radius;
    const clickY = e.clientY - rect.top - radius;
    const normalizedX = Math.max(-1, Math.min(1, clickX / (radius - 8)));
    const normalizedY = Math.max(-1, Math.min(1, -clickY / (radius - 8)));
    onChange(Number(normalizedX.toFixed(2)), Number(normalizedY.toFixed(2)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
      <span style={{ fontSize: '9px', color: '#8fa597', fontWeight: 600 }}>{label}</span>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label} 摇杆偏转，当前 X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}`}
        onPointerDown={handlePointer}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 50%, #172421 0%, #0d1614 100%)',
          border: '1.5px solid #2f443e',
          boxShadow: 'inset 0 0 8px rgba(0,0,0,0.6)',
          position: 'relative',
          cursor: disabled ? 'default' : 'crosshair',
          userSelect: 'none',
          touchAction: 'none',
        }}
        title="可点击任意位置直接测试偏转"
      >
        {/* Horizontal & Vertical Crosshair axes */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${radius}px`, height: '1px', background: 'rgba(74, 105, 96, 0.4)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${radius}px`, width: '1px', background: 'rgba(74, 105, 96, 0.4)' }} />

        {/* Deadzone inner circle */}
        <div style={{
          position: 'absolute',
          left: `${radius - 7}px`,
          top: `${radius - 7}px`,
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          border: '1px dashed rgba(80, 115, 105, 0.5)',
        }} />

        {/* Deflection vector line from center to dot */}
        {!isNeutral && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <line
              x1={radius}
              y1={radius}
              x2={dotX}
              y2={dotY}
              stroke="#5eead4"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="2,2"
            />
          </svg>
        )}

        {/* Thumbstick physical indicator dot */}
        <div style={{
          position: 'absolute',
          left: `${dotX - 7}px`,
          top: `${dotY - 7}px`,
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: isNeutral ? '#406056' : '#2dd4bf',
          border: isNeutral ? '2px solid #5a7d72' : '2px solid #ffffff',
          boxShadow: isNeutral ? 'none' : '0 0 10px #2dd4bf',
          transition: 'transform 0.08s ease-out',
        }} />
      </div>

      {/* Coordinate & Magnitude label */}
      <div style={{ fontSize: '8.5px', fontFamily: 'monospace', color: isNeutral ? '#71887c' : '#5eead4' }}>
        X:{x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2)} Y:{y >= 0 ? `+${y.toFixed(2)}` : y.toFixed(2)} ({Math.min(100, Math.round(magnitude * 100))}%)
      </div>
    </div>
  );
}

export default function InputDebugPanel({ state, modelBusy, onConnect, onDisconnect, onExecute, onStop }: {
  state: InputDebugState; modelBusy: boolean; onConnect(mode: InputMode): void; onDisconnect(): void; onExecute(skill: ManualSkill): void; onStop(): void;
}) {
  const [tab, setTab] = useState<'mcp' | 'legacy'>('mcp');
  const [mode, setMode] = useState<InputMode>('dry-run');
  const [selectedTool, setSelectedTool] = useState('gamepad_set_stick');
  const [mcpButton, setMcpButton] = useState<XboxButton>('A');
  const [mcpDuration, setMcpDuration] = useState(250);
  const [stickType, setStickType] = useState<'left' | 'right'>('left');
  const [stickX, setStickX] = useState(0.8);
  const [stickY, setStickY] = useState(0.0);
  const [rightStickX, setRightStickX] = useState(0.0);
  const [rightStickY, setRightStickY] = useState(0.0);
  const [triggerType, setTriggerType] = useState<'left' | 'right'>('right');
  const [triggerVal, setTriggerVal] = useState(1.0);
  const [copiedMcp, setCopiedMcp] = useState(false);

  // Legacy skill controls
  const [skill, setSkill] = useState('move_for');
  const [direction, setDirection] = useState<'left' | 'right' | 'forward' | 'backward'>('left');
  const [button, setButton] = useState<XboxButton>('A');
  const [duration, setDuration] = useState(200);
  const [strength, setStrength] = useState(0.5);

  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (modelBusy && panel.current) panel.current.open = false; }, [modelBusy]);

  const connected = state.status !== 'disconnected' && state.status !== 'connecting';
  const busy = ['connecting', 'preparing', 'executing', 'resetting'].includes(state.status);

  // Reflect live deflection during executing state
  const liveLeftStickX = state.status === 'executing' && state.lastCommand?.skill === 'move_for'
    ? (state.lastCommand.direction === 'left' ? -state.lastCommand.strength : state.lastCommand.direction === 'right' ? state.lastCommand.strength : 0)
    : stickX;

  const liveLeftStickY = state.status === 'executing' && state.lastCommand?.skill === 'move_for'
    ? (state.lastCommand.direction === 'forward' ? state.lastCommand.strength : state.lastCommand.direction === 'backward' ? -state.lastCommand.strength : 0)
    : stickY;

  const mcpConfigSnippet = JSON.stringify({
    mcpServers: {
      "virtual-gamepad": {
        command: "node",
        args: ["--import", "tsx", "src/mcp/gamepad-mcp-server.ts"]
      }
    }
  }, null, 2);

  const handleExecuteMcpTool = () => {
    if (selectedTool === 'gamepad_press_button') {
      onExecute({ skill: 'press_button', button: mcpButton, durationMs: mcpDuration });
    } else if (selectedTool === 'gamepad_set_stick') {
      const activeX = stickType === 'left' ? stickX : rightStickX;
      const activeY = stickType === 'left' ? stickY : rightStickY;
      const dir = Math.abs(activeX) > Math.abs(activeY)
        ? (activeX > 0 ? 'right' : 'left')
        : (activeY > 0 ? 'forward' : 'backward');
      onExecute({ skill: 'move_for', direction: dir, strength: Math.max(Math.abs(activeX), Math.abs(activeY), 0.1), durationMs: mcpDuration });
    } else if (selectedTool === 'gamepad_reset_all') {
      setStickX(0);
      setStickY(0);
      setRightStickX(0);
      setRightStickY(0);
      onStop();
    } else {
      onExecute({ skill: 'press_button', button: mcpButton, durationMs: mcpDuration });
    }
  };

  return <details className="input-debug-panel" ref={panel} open>
    <summary>
      <span>🎮 虚拟手柄工具 <span className="muted">/ MCP & ViGEm 零先验硬件驱动</span></span>
      <span className="input-summary">{state.message}</span>
      <span className={state.neutral === true ? 'success-color' : 'muted'}>
        {state.neutral === true ? '● 摇杆已安全居中 (Neutral)' : state.neutral === false ? '▲ 动作执行中' : '未知状态'}
      </span>
    </summary>

    {/* Live Gamepad Hardware Visualizer HUD */}
    <div style={{
      margin: '6px 0 10px',
      padding: '8px 12px',
      background: '#111715',
      border: '1px solid #23332c',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '18px',
      flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: '9px', color: '#6e8578', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '95px' }}>
        <b style={{ color: '#8de8c7' }}>🎯 摇杆与轴偏转</b>
        <span>点击圆盘可直接调向</span>
        <span style={{ color: '#52665b' }}>绿点: 偏转矢量</span>
        <span style={{ color: '#52665b' }}>虚线: 摇杆死区</span>
      </div>

      {/* Left Stick Visualizer */}
      <JoystickWidget
        label="左摇杆 LS (移动矢量)"
        x={liveLeftStickX}
        y={liveLeftStickY}
        onChange={(nx, ny) => {
          setStickType('left');
          setStickX(nx);
          setStickY(ny);
          setSelectedTool('gamepad_set_stick');
        }}
        disabled={busy}
      />

      {/* Right Stick Visualizer */}
      <JoystickWidget
        label="右摇杆 RS (镜头视角)"
        x={rightStickX}
        y={rightStickY}
        onChange={(nx, ny) => {
          setStickType('right');
          setRightStickX(nx);
          setRightStickY(ny);
          setSelectedTool('gamepad_set_stick');
        }}
        disabled={busy}
      />

      {/* Triggers Gauge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '90px' }}>
        <span style={{ fontSize: '9px', color: '#8fa597', fontWeight: 600 }}>扳机模拟量 (Triggers)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: '#8fa597' }}>
          <span>LT:</span>
          <div style={{ flex: 1, height: '7px', background: '#192622', borderRadius: '3px', overflow: 'hidden', border: '1px solid #2d4039' }}>
            <div style={{ width: `${triggerType === 'left' ? triggerVal * 100 : 0}%`, height: '100%', background: '#38bdf8' }} />
          </div>
          <span style={{ fontFamily: 'monospace' }}>{triggerType === 'left' ? triggerVal.toFixed(1) : '0.0'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: '#8fa597' }}>
          <span>RT:</span>
          <div style={{ flex: 1, height: '7px', background: '#192622', borderRadius: '3px', overflow: 'hidden', border: '1px solid #2d4039' }}>
            <div style={{ width: `${triggerType === 'right' ? triggerVal * 100 : 0}%`, height: '100%', background: '#38bdf8' }} />
          </div>
          <span style={{ fontFamily: 'monospace' }}>{triggerType === 'right' ? triggerVal.toFixed(1) : '0.0'}</span>
        </div>
      </div>

      {/* Key Quick-Pad */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginLeft: 'auto' }}>
        <span style={{ fontSize: '9px', color: '#8fa597', fontWeight: 600 }}>常用按键快速点按</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['A', 'B', 'X', 'Y', 'LB', 'RB'] as XboxButton[]).map(b => (
            <button
              key={b}
              type="button"
              className="button secondary"
              style={{
                fontSize: '9px',
                padding: '3px 6px',
                minWidth: '24px',
                background: mcpButton === b ? '#29433b' : '#141d1a',
                borderColor: mcpButton === b ? '#5eead4' : '#283832',
                color: mcpButton === b ? '#5eead4' : '#a2b6ab',
              }}
              disabled={busy || state.status !== 'ready'}
              onClick={() => {
                setMcpButton(b);
                setSelectedTool('gamepad_press_button');
                onExecute({ skill: 'press_button', button: b, durationMs: 150 });
              }}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </div>

    {/* Mode & Protocol Switcher */}
    <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #2a3430', paddingBottom: '6px', margin: '6px 0' }}>
      <button
        type="button"
        className={`button ${tab === 'mcp' ? 'primary' : 'secondary'}`}
        style={{ fontSize: '10px', padding: '4px 8px' }}
        onClick={() => setTab('mcp')}
      >
        MCP 零先验工具调用 (Standard Tools)
      </button>
      <button
        type="button"
        className={`button ${tab === 'legacy' ? 'primary' : 'secondary'}`}
        style={{ fontSize: '10px', padding: '4px 8px' }}
        onClick={() => setTab('legacy')}
      >
        传统宏测试 (P2-B Legacy)
      </button>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <select aria-label="手柄服务模式" value={mode} disabled={connected || busy} onChange={e => setMode(e.target.value as InputMode)}>
          <option value="dry-run">内存仿真 · 跨平台无驱动</option>
          <option value="virtual-xbox">ViGEm 真实虚拟 Xbox (Windows)</option>
        </select>
        {!connected ? (
          <button type="button" className="button secondary" disabled={busy || modelBusy} onClick={() => onConnect(mode)}>
            连接虚拟手柄
          </button>
        ) : (
          <button type="button" className="button secondary" onClick={onDisconnect}>
            断开手柄
          </button>
        )}
      </div>
    </div>

    {tab === 'mcp' ? (
      <div>
        <div className="input-controls" style={{ padding: '6px 0' }}>
          <label style={{ color: '#d1caff' }}>MCP 工具：
            <select aria-label="MCP 工具选择" value={selectedTool} disabled={busy} onChange={e => setSelectedTool(e.target.value)}>
              {GAMEPAD_TOOL_DEFINITIONS.map(t => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>

          {selectedTool === 'gamepad_press_button' || selectedTool === 'gamepad_release_button' ? (
            <label>按键：
              <select aria-label="按键选择" value={mcpButton} disabled={busy} onChange={e => setMcpButton(e.target.value as XboxButton)}>
                {buttons.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          ) : null}

          {selectedTool === 'gamepad_set_stick' ? (
            <>
              <label>摇杆：
                <select aria-label="摇杆类型" value={stickType} disabled={busy} onChange={e => setStickType(e.target.value as 'left' | 'right')}>
                  <option value="left">左摇杆 (Left Stick)</option>
                  <option value="right">右摇杆 (Right Stick)</option>
                </select>
              </label>
              <label>X轴：
                <input
                  aria-label="摇杆X轴"
                  type="number"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={stickType === 'left' ? stickX : rightStickX}
                  disabled={busy}
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (stickType === 'left') setStickX(val);
                    else setRightStickX(val);
                  }}
                />
              </label>
              <label>Y轴：
                <input
                  aria-label="摇杆Y轴"
                  type="number"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={stickType === 'left' ? stickY : rightStickY}
                  disabled={busy}
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (stickType === 'left') setStickY(val);
                    else setRightStickY(val);
                  }}
                />
              </label>
            </>
          ) : null}

          {selectedTool === 'gamepad_set_trigger' ? (
            <>
              <label>扳机：
                <select aria-label="扳机类型" value={triggerType} disabled={busy} onChange={e => setTriggerType(e.target.value as 'left' | 'right')}>
                  <option value="left">左扳机 (LT)</option>
                  <option value="right">右扳机 (RT)</option>
                </select>
              </label>
              <label>深度：
                <input aria-label="扳机深度" type="number" min="0" max="1" step="0.1" value={triggerVal} disabled={busy} onChange={e => setTriggerVal(Number(e.target.value))} />
              </label>
            </>
          ) : null}

          {['gamepad_press_button', 'gamepad_set_stick', 'gamepad_set_trigger'].includes(selectedTool) ? (
            <label>持续时间：
              <input aria-label="持续时间" type="number" min="20" max="5000" step="50" value={mcpDuration} disabled={busy} onChange={e => setMcpDuration(Number(e.target.value))} /> ms
            </label>
          ) : null}

          <button
            type="button"
            className="button primary"
            disabled={modelBusy || state.status !== 'ready'}
            onClick={handleExecuteMcpTool}
          >
            {selectedTool === 'gamepad_reset_all' ? '执行强制归零' : '模拟 AI 调用此工具'}
          </button>
          <button
            type="button"
            className="button danger"
            disabled={!connected || state.status === 'resetting'}
            onClick={() => {
              setStickX(0);
              setStickY(0);
              setRightStickX(0);
              setRightStickY(0);
              onStop();
            }}
          >
            安全看门狗归零
          </button>
        </div>

        <div style={{ marginTop: '8px', fontSize: '9px', color: '#9bb0a4', display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span>💡 <b>零先验设计保证</b>：本工具只暴露物理按键与轴偏转量，绝不含走跑跳击打等游戏动词。AI 需自行观察画面并将意图转化为摇杆矢量与按键组合。</span>
          <button
            type="button"
            className="button secondary"
            style={{ padding: '2px 6px', fontSize: '9px', marginLeft: 'auto' }}
            onClick={() => {
              navigator.clipboard?.writeText(mcpConfigSnippet);
              setCopiedMcp(true);
              setTimeout(() => setCopiedMcp(false), 2000);
            }}
          >
            {copiedMcp ? '✓ 已复制 MCP 配置' : '复制 MCP 客户端配置 JSON'}
          </button>
        </div>
      </div>
    ) : (
      <div className="input-controls">
        <select aria-label="手柄调试技能" value={skill} disabled={busy} onChange={e => setSkill(e.target.value)}>
          <option value="move_for">move_for</option>
          <option value="press_button">press_button</option>
        </select>
        {skill === 'move_for' ? (
          <>
            <select aria-label="移动方向" value={direction} disabled={busy} onChange={e => setDirection(e.target.value as typeof direction)}>
              <option value="left">向左</option>
              <option value="right">向右</option>
              <option value="forward">向前</option>
              <option value="backward">向后</option>
            </select>
            <label>力度 <input aria-label="摇杆力度" type="number" min="0.1" max="1" step="0.1" value={strength} disabled={busy} onChange={e => setStrength(Number(e.target.value))} /></label>
          </>
        ) : (
          <select aria-label="Xbox 按钮" value={button} disabled={busy} onChange={e => setButton(e.target.value as XboxButton)}>
            {buttons.map(b => <option key={b}>{b}</option>)}
          </select>
        )}
        <label>时长 <input aria-label="手柄动作时长" type="number" min="20" max="1500" step="10" value={duration} disabled={busy} onChange={e => setDuration(Number(e.target.value))} /> ms</label>
        <button
          type="button"
          className="button secondary"
          disabled={modelBusy || state.status !== 'ready'}
          onClick={() => onExecute(skill === 'move_for' ? { skill: 'move_for', direction, strength, durationMs: duration } : { skill: 'press_button', button, durationMs: duration })}
        >
          {state.mode === 'virtual-xbox' ? '执行（3秒准备）' : '执行调试动作'}
        </button>
        <button type="button" className="button danger" disabled={!connected || state.status === 'resetting'} onClick={onStop}>
          停止并归零
        </button>
      </div>
    )}

    {state.lastResult && (
      <div className="input-result" role="status">
        {state.lastResult.status === 'executed' ? '输入执行完成' : state.lastResult.status === 'cancelled' ? '输入已取消' : '输入异常'} · 零先验物理输入回执
        <details>
          <summary>输入协议与历史队列 (History & Neutral ACK)</summary>
          <pre className="json-block">{JSON.stringify({ lastCommand: state.lastCommand, lastResult: state.lastResult, history: state.history }, null, 2)}</pre>
        </details>
      </div>
    )}
  </details>;
}
