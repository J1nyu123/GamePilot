import type { DebugApi, AgentEvent, ConfigSummary, ImportedImage, RunSnapshot, ExecutionMode, Result } from '../contracts/debug';
import type { CaptureState, GameWindow, FrameEvidence } from '../contracts/capture';
import type { InputDebugState, InputMode, ManualSkill } from '../contracts/input';
import type { KeyObservation } from '../contracts/verification';
import type { Assignment } from '../benchmarks/campaign';
import { getArenaInstance, ARENA_TARGETS } from './components/ZeldaArenaCanvas';

// Procedural game screenshot generator for web preview & test runs
function generateGameCanvas(title: string, frameSeq: number, step = 0): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, 480);
  sky.addColorStop(0, '#1a3b5c');
  sky.addColorStop(0.5, '#4a7c9b');
  sky.addColorStop(1, '#a3c2cf');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1280, 480);

  // Distant mountains
  ctx.fillStyle = '#2d4b5a';
  ctx.beginPath();
  ctx.moveTo(0, 420);
  ctx.lineTo(240, 260);
  ctx.lineTo(460, 380);
  ctx.lineTo(680, 220); // Dueling Peaks
  ctx.lineTo(820, 310);
  ctx.lineTo(950, 190);
  ctx.lineTo(1140, 350);
  ctx.lineTo(1280, 310);
  ctx.lineTo(1280, 480);
  ctx.lineTo(0, 480);
  ctx.fill();

  // Hyrule Castle spire in distance
  ctx.fillStyle = '#1c2e3d';
  ctx.beginPath();
  ctx.moveTo(630, 360);
  ctx.lineTo(650, 180);
  ctx.lineTo(670, 360);
  ctx.fill();

  // Ground / Grassland
  const ground = ctx.createLinearGradient(0, 480, 0, 720);
  ground.addColorStop(0, '#4b6f38');
  ground.addColorStop(0.3, '#3a592a');
  ground.addColorStop(1, '#253d1b');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 480, 1280, 240);

  // Ruin pillar (Landmark for verification)
  const pillarX = 720 - step * 30;
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(pillarX, 390, 60 + step * 4, 180 + step * 8);
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(pillarX + 45 + step * 3, 390, 15 + step, 180 + step * 8);

  // Link character representation
  const linkX = 580;
  const linkY = 510;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(linkX, linkY + 65, 25, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body (Champion tunic blue)
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(linkX - 12, linkY + 15, 24, 35);
  // Head & hair
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(linkX, linkY, 14, 0, Math.PI * 2);
  ctx.fill();
  // Master sword on back
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(linkX + 8, linkY - 10, 4, 45);

  // HUD: Hearts in top left
  for (let i = 0; i < 3; i++) {
    const hx = 60 + i * 32;
    const hy = 50;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(hx - 6, hy, 7, Math.PI, 0, false);
    ctx.arc(hx + 6, hy, 7, Math.PI, 0, false);
    ctx.lineTo(hx, hy + 14);
    ctx.closePath();
    ctx.fill();
  }

  // HUD: Mini map circle in bottom right
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.beginPath();
  ctx.arc(1180, 620, 65, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Compass needle
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(1180, 570);
  ctx.lineTo(1175, 620);
  ctx.lineTo(1185, 620);
  ctx.fill();

  // Stamina wheel indicator near Link
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(linkX + 40, linkY + 20, 16, 0, Math.PI * 1.8);
  ctx.stroke();

  // Scene overlay info
  ctx.fillStyle = 'rgba(16, 20, 26, 0.75)';
  ctx.fillRect(20, 660, 420, 42);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px "Cascadia Code", Consolas, monospace';
  ctx.fillText(`${title} · 帧 #${frameSeq} · [1280x720 60FPS]`, 30, 686);

  return canvas.toDataURL('image/jpeg', 0.88);
}

export function createWebGamepilot(): DebugApi {
  const eventListeners = new Set<(event: AgentEvent) => void>();
  const captureListeners = new Set<(state: CaptureState) => void>();
  const inputListeners = new Set<(state: InputDebugState) => void>();

  let frameCounter = 100;
  let currentSnapshot: RunSnapshot | null = null;
  let activeCancel = false;
  let activePaused = false;

  const createEvidenceHelper = (sourceId: string, identity: string, frameSequence: number): FrameEvidence => {
    const now = Date.now();
    return {
      sourceId,
      title: 'Cemu 2.0-88 [塞尔达传说：旷野之息]',
      identity,
      generation: 1,
      frameSequence,
      sourceMediaTime: now,
      presentedFrames: 1,
      barrierMediaTime: now,
      barrierPresentedFrames: 1,
      barrierRequestedAt: now,
      capturedAt: now,
      receivedAt: now,
      clock: 'video-media-time',
      freshness: 'after-source-barrier',
    };
  };

  const defaultWindows: GameWindow[] = [
    { id: 'window:cemu:botw', title: 'Cemu 2.0-88 [塞尔达传说：旷野之息 (The Legend of Zelda: BOTW)]', processName: 'Cemu.exe', identity: 'cemu-botw-01', minimized: false, foreground: true, width: 1280, height: 720 },
    { id: 'window:cemu:mk8', title: 'Cemu 2.0-88 [马力欧卡丁车 8 (Mario Kart 8)]', processName: 'Cemu.exe', identity: 'cemu-mk8-02', minimized: false, foreground: false, width: 1280, height: 720 },
    { id: 'window:elden:ring', title: 'ELDEN RING (艾尔登法环 初始引导)', processName: 'eldenring.exe', identity: 'elden-01', minimized: false, foreground: false, width: 1280, height: 720 },
  ];

  let selectedWindow: GameWindow | undefined = defaultWindows[0];
  let captureState: CaptureState = {
    status: 'stopped',
    generation: 1,
    message: '预览未启动',
  };

  let inputState: InputDebugState = {
    status: 'disconnected',
    mode: 'dry-run',
    neutral: null,
    message: '手柄服务未连接',
    history: [],
  };

  const defaultImage: ImportedImage = {
    id: 'sample-botw-frame-01',
    name: 'Cemu · 旷野之息始生台地 · 帧 #100',
    path: '/observations/sample-botw-01.jpg',
    importedAt: Date.now(),
    mimeType: 'image/jpeg',
    width: 1280,
    height: 720,
    size: 245000,
    dataUrl: generateGameCanvas('塞尔达传说：旷野之息', 100, 0),
    source: 'window',
    evidence: createEvidenceHelper('window:cemu:botw', 'cemu-botw-01', 100),
  };

  let currentCapturedImage: ImportedImage = defaultImage;

  function broadcastEvent(event: AgentEvent) {
    for (const listener of eventListeners) {
      try { listener(event); } catch (e) { console.error(e); }
    }
  }

  function broadcastCapture(state: CaptureState) {
    captureState = state;
    for (const listener of captureListeners) {
      try { listener(state); } catch (e) { console.error(e); }
    }
  }

  function broadcastInput(state: InputDebugState) {
    inputState = state;
    for (const listener of inputListeners) {
      try { listener(state); } catch (e) { console.error(e); }
    }
  }

  // Pre-configured P4 benchmark trial plan
  let currentP4Index = 0;
  const p4Presets: Assignment[] = [
    { campaignId: 'p4-botw-eval', planHash: 'f83a21', group: 'move', trial: 1, timeoutMs: 60000, prompt: '观察当前安全可操作场景，调用一次 move_for 向前移动 500 毫秒，然后停止。依据固定成功条件及动作后独立验证报告结果。不要追加移动或等待工具。', successCondition: '视野前方石柱地标发生明显向前相对位移。' },
    { campaignId: 'p4-botw-eval', planHash: 'f83a21', group: 'wait', trial: 1, timeoutMs: 60000, prompt: '不要移动，只调用一次 wait_for_state 等待最多 10000 毫秒，检查固定可见条件。', successCondition: '游戏画面左上角可见红色生命值心形图标。' },
    { campaignId: 'p4-botw-eval', planHash: 'f83a21', group: 'blocked', trial: 1, timeoutMs: 60000, prompt: '不要移动，只调用一次 wait_for_state 等待最多 10000 毫秒。条件未满足或无法确认时报告受阻，不要声称完成。', successCondition: '游戏画面中清晰显示完整文字 GAMEPILOT_TEST_TARGET_7F3A。' },
    { campaignId: 'p4-botw-eval', planHash: 'f83a21', group: 'cancel-model', trial: 1, timeoutMs: 60000, prompt: '观察画面，然后只调用一次 wait_for_state，等待最多 10000 毫秒检查固定条件。不要移动。', successCondition: '游戏画面左上角可见红色生命值心形图标。' },
    { campaignId: 'p4-botw-eval', planHash: 'f83a21', group: 'cancel-action', trial: 1, timeoutMs: 60000, prompt: '观察当前安全可操作场景，调用一次 move_for 向前移动 1500 毫秒。不要追加任何动作。', successCondition: '视野前方石柱地标发生明显向前相对位移。' },
  ];

  const api: DebugApi = {
    async getConfig(): Promise<Result<ConfigSummary>> {
      return {
        ok: true,
        value: {
          status: 'ready',
          modelId: 'gemini-2.5-flash / visual-agent',
          provider: 'google-ai-studio',
          configPath: 'config/models.json',
          message: '已加载视觉模型与 Web 调试仿真器 (Ready)',
        },
      };
    },

    async getRuntimeCapabilities(): Promise<Result<{ realMovement: boolean; maxRealTools: number; goalVerification?: boolean; targetApproach?: boolean }>> {
      return {
        ok: true,
        value: {
          realMovement: true,
          maxRealTools: 2,
          goalVerification: true,
          targetApproach: true,
        },
      };
    },

    async listWindows(): Promise<Result<GameWindow[]>> {
      return { ok: true, value: defaultWindows };
    },

    async startPreview(sourceId: string): Promise<Result<null>> {
      selectedWindow = defaultWindows.find(w => w.id === sourceId) || defaultWindows[0];
      broadcastCapture({
        status: 'streaming',
        generation: captureState.generation + 1,
        window: selectedWindow,
        message: `正在推流: ${selectedWindow.title}`,
      });
      return { ok: true, value: null };
    },

    async stopPreview(): Promise<Result<null>> {
      broadcastCapture({
        status: 'stopped',
        generation: captureState.generation + 1,
        message: '预览已停止',
      });
      return { ok: true, value: null };
    },

    async captureFrame(): Promise<Result<ImportedImage>> {
      frameCounter += 5;
      const win = selectedWindow || defaultWindows[0];
      const dataUrl = generateGameCanvas(win.title.split(' ')[0], frameCounter, 0);
      currentCapturedImage = {
        id: `frame-${Date.now()}`,
        name: `${win.title.split(' ')[0]} · 帧 #${frameCounter}`,
        path: `/observations/frame-${frameCounter}.jpg`,
        importedAt: Date.now(),
        mimeType: 'image/jpeg',
        width: 1280,
        height: 720,
        size: 260000,
        dataUrl,
        evidence: createEvidenceHelper(win.id, win.identity, frameCounter),
      };
      return { ok: true, value: currentCapturedImage };
    },

    async importImage(): Promise<Result<ImportedImage | null>> {
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            resolve({ ok: true, value: null });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const img = new Image();
            img.onload = () => {
              const imported: ImportedImage = {
                id: `import-${Date.now()}`,
                name: file.name,
                path: file.name,
                importedAt: Date.now(),
                mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
                width: img.naturalWidth || 1280,
                height: img.naturalHeight || 720,
                size: file.size,
                dataUrl,
                source: 'import',
              };
              currentCapturedImage = imported;
              resolve({ ok: true, value: imported });
            };
            img.onerror = () => resolve({ ok: false, error: '无法解析选定图片文件' });
            img.src = dataUrl;
          };
          reader.onerror = () => resolve({ ok: false, error: '读取图片失败' });
          reader.readAsDataURL(file);
        };
        // If dismissed without choosing
        window.addEventListener('focus', () => {
          setTimeout(() => {
            if (!input.files?.length) resolve({ ok: true, value: null });
          }, 600);
        }, { once: true });
        input.click();
      });
    },

    async getInputState(): Promise<Result<InputDebugState>> {
      return { ok: true, value: inputState };
    },

    async connectInput(mode: InputMode): Promise<Result<null>> {
      broadcastInput({
        status: 'ready',
        mode,
        neutral: true,
        message: mode === 'virtual-xbox' ? '虚拟 Xbox 手柄驱动已连接 (Ready · 摇杆居中)' : 'Dry-run 空跑模式已就绪',
        history: inputState.history,
      });
      return { ok: true, value: null };
    },

    async disconnectInput(): Promise<Result<null>> {
      broadcastInput({
        status: 'disconnected',
        mode: 'dry-run',
        neutral: null,
        message: '手柄服务未连接',
        history: inputState.history,
      });
      return { ok: true, value: null };
    },

    async executeInput(skill: ManualSkill): Promise<Result<{ runId: string }>> {
      const runId = `skill-${Date.now()}`;
      const skillLabel = skill.skill === 'move_for' ? `${skill.direction} 摇杆` : `${skill.button} 按键`;
      broadcastInput({
        ...inputState,
        status: 'executing',
        neutral: false,
        message: `正在执行 ${skillLabel} (${skill.durationMs}ms)...`,
      });

      setTimeout(() => {
        const item = {
          runId,
          skill,
          reply: {
            ok: true,
            status: 'executed' as const,
            neutral: true,
            durationMs: skill.durationMs,
            stopTiming: {
              backend: inputState.mode,
              phase: 'ready',
              reason: '技能执行正常结束',
              resetSentAfterMs: skill.durationMs,
              ackAfterMs: skill.durationMs + 8,
            },
          },
        };
        broadcastInput({
          ...inputState,
          status: 'ready',
          neutral: true,
          message: `执行完毕：${skillLabel} 持续 ${skill.durationMs}ms 已释放归零`,
          history: [item, ...inputState.history].slice(0, 10),
        });
      }, Math.min(skill.durationMs, 1000));

      return { ok: true, value: { runId } };
    },

    async stopInput(): Promise<Result<null>> {
      broadcastInput({
        ...inputState,
        status: 'ready',
        neutral: true,
        message: '已紧急停止并强制摇杆归零 (Neutral confirmed)',
      });
      return { ok: true, value: null };
    },

    onInput(callback: (state: InputDebugState) => void): () => void {
      inputListeners.add(callback);
      callback(inputState);
      return () => inputListeners.delete(callback);
    },

    getCaptureState(): Promise<Result<CaptureState>> {
      return Promise.resolve({ ok: true, value: captureState });
    },

    onCapture(callback: (state: CaptureState) => void): () => void {
      captureListeners.add(callback);
      callback(captureState);
      return () => captureListeners.delete(callback);
    },

    async startRun(input: {
      imageId: string;
      prompt: string;
      timeoutMs: number;
      executionMode?: ExecutionMode;
      successCondition?: string;
      benchmark?: Assignment;
      approach?: any;
      executionStrategy?: any;
    }): Promise<Result<{ runId: string }>> {
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      activeCancel = false;
      activePaused = false;

      const isSimulation = input.executionMode === 'simulation';
      const isApproach = input.executionMode === 'approach-xbox';
      const isVerified = input.executionMode === 'verified-xbox';

      const initialImage = currentCapturedImage;
      const keyObservations: KeyObservation[] = [
        { phase: 'before', image: initialImage, relativePath: initialImage.path },
      ];

      currentSnapshot = {
        runId,
        status: 'running',
        imageId: input.imageId,
        prompt: input.prompt,
        events: [],
        input: initialImage,
        observations: keyObservations,
      };

      let seq = 0;
      const emit = (type: string, data: Record<string, any> = {}) => {
        if (activeCancel) return;
        const event: AgentEvent = {
          runId,
          sequence: ++seq,
          timestamp: Date.now(),
          type,
          ...data,
        };
        currentSnapshot?.events.push(event);
        broadcastEvent(event);
      };

      const arena = getArenaInstance();
      if (arena) {
        setTimeout(async () => {
          emit('validation_start', { simulated: isSimulation });
          await new Promise(r => setTimeout(r, 100));
          if (activeCancel) return;

          let globalTurn = 0;
          const { linkX: initX, linkY: initY } = arena.getState();

          // 1. High-Level Task Planning via Server API / Gemini 3.8 Flash
          let phases: {
            phaseIndex: number;
            targetId: 'red' | 'yellow' | 'blue';
            targetName: string;
            x: number;
            y: number;
            description?: string;
          }[] = [];
          let planReasoning = '';
          let planSource = 'local-planner';

          try {
            const planRes = await fetch('/api/gemini/plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: input.prompt,
                currentLinkPos: { x: initX, y: initY },
              }),
            });
            if (planRes.ok) {
              const data = await planRes.json();
              if (data.ok && data.intent === 'chat' && data.reply) {
                // Conversational intent: directly answer the user without moving gamepad
                arena.setPlannedRoute([], 0);
                globalTurn++;
                emit('turn_start', { turn: globalTurn });
                emit('model_request', {
                  turn: globalTurn,
                  modelId: data.source || 'gemini-3.8-flash',
                  maxTokens: 2048,
                });
                emit('model_text', { turn: globalTurn, text: data.reply });
                emit('model_end', {
                  turn: globalTurn,
                  stopReason: 'stop',
                  diagnostics: { contentTypes: ['text'], textChars: data.reply.length, thinkingChars: 0, toolCallCount: 0 },
                });
                emit('validation_end', {
                  status: 'succeeded',
                  summary: {
                    status: 'succeeded',
                    simulated: isSimulation,
                    gameOutcome: 'passed',
                    turns: globalTurn,
                    finalText: data.reply,
                  },
                });
                return;
              }

              if (data.ok && Array.isArray(data.phases) && data.phases.length > 0) {
                phases = data.phases;
                planReasoning = data.reasoning;
                planSource = data.source || 'gemini-3.8-flash';
              }
            }
          } catch {
            // Seamless fallback to local cognitive parsing
          }

          // Fallback parsing if backend route failed or offline
          if (phases.length === 0) {
            const promptLower = input.prompt.toLowerCase();
            const occ: { target: typeof ARENA_TARGETS[0]; index: number }[] = [];
            const check = (t: typeof ARENA_TARGETS[0], words: string[]) => {
              for (const w of words) {
                let idx = promptLower.indexOf(w);
                while (idx !== -1) {
                  occ.push({ target: t, index: idx });
                  idx = promptLower.indexOf(w, idx + 1);
                }
              }
            };
            check(ARENA_TARGETS[0], ['红', 'red', '火']);
            check(ARENA_TARGETS[1], ['黄', 'yellow', '雷']);
            check(ARENA_TARGETS[2], ['蓝', 'blue', '水']);
            occ.sort((a, b) => a.index - b.index);

            const seq: typeof ARENA_TARGETS[0][] = [];
            for (const item of occ) {
              if (seq.length === 0 || seq[seq.length - 1].id !== item.target.id) {
                seq.push(item.target);
              }
            }

            const moveVerbs = ['走', '去', '到', '移动', '前往', '导航', '抵达', '跑', '巡逻', 'move', 'go', 'to', 'walk', 'navigate'];
            const hasMoveVerb = moveVerbs.some(v => promptLower.includes(v));

            // If no navigation targets were recognized, reply conversationally rather than arbitrarily navigating to red!
            if (seq.length === 0) {
              arena.setPlannedRoute([], 0);
              globalTurn++;
              const chatReply = hasMoveVerb
                ? '收到移动意图，但尚未指定目标。沙盒周围有三个可选目标点：\n• 🔴 红色火之祭坛 (右上)\n• 🟡 黄色雷之祭坛 (左中)\n• 🔵 蓝色水之祭坛 (下中)\n请指示目标，例如「走到蓝色目标位置之后再走到红色目标位置」。'
                : `我是由 Google Gemini 3.8 Flash 模型架构驱动的 GamePilot 游戏智能体助手。\n` +
                  `在当前沙盒试验场中，我具备以下能力：\n` +
                  `1. 视觉感知：实时观测游戏画面及林克坐标 (当前位于 X:${Math.round(initX)}, Y:${Math.round(initY)})\n` +
                  `2. 任务规划：理解复杂多步长任务（如「走到蓝色目标位置之后再走到红色目标位置」）\n` +
                  `3. 零先验手柄控制：通过 MCP 虚拟手柄协议输出摇杆偏转矢量与动作按键\n` +
                  `周围地标包括：🔴 红色火之祭坛、🟡 黄色雷之祭坛、🔵 蓝色水之祭坛。你可以随时给我指派移动任务！`;

              emit('turn_start', { turn: globalTurn });
              emit('model_request', {
                turn: globalTurn,
                modelId: 'gemini-3.8-flash',
                maxTokens: 2048,
              });
              emit('model_text', { turn: globalTurn, text: chatReply });
              emit('model_end', {
                turn: globalTurn,
                stopReason: 'stop',
                diagnostics: { contentTypes: ['text'], textChars: chatReply.length, thinkingChars: 0, toolCallCount: 0 },
              });
              emit('validation_end', {
                status: 'succeeded',
                summary: {
                  status: 'succeeded',
                  simulated: isSimulation,
                  gameOutcome: 'passed',
                  turns: globalTurn,
                  finalText: chatReply,
                },
              });
              return;
            }

            phases = seq.map((target, idx) => ({
              phaseIndex: idx,
              targetId: target.id,
              targetName: target.name,
              x: target.x,
              y: target.y,
              description: `第 ${idx + 1} 阶段：前往【${target.name}】`,
            }));
            planReasoning = `多目标序列任务拆解（共 ${phases.length} 个目标阶段）：${phases.map(p => p.targetName).join(' ➔ ')}`;
          }

          // Update canvas route planner display
          arena.setPlannedRoute(phases, 0);

          // Emit High-Level Mission Plan
          globalTurn++;
          emit('turn_start', { turn: globalTurn });
          emit('model_request', {
            turn: globalTurn,
            modelId: planSource === 'gemini-3.8-flash' ? 'gemini-3.8-flash' : 'gamepilot-closed-loop',
            maxTokens: 2048,
          });

          const planAnnouncement = phases.length > 1
            ? `【任务规划中枢 (${planSource === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash 云端大模型' : '内置闭环引擎'})】已完成长任务序列拆解（共 ${phases.length} 个目标点）：\n${phases.map((p, idx) => `  ${idx + 1}. 前往【${p.targetName}】 (X:${p.x}, Y:${p.y})`).join('\n')}\n${planReasoning ? `\n规划推理：${planReasoning}\n` : ''}\n立即启动第 1 阶段导航推进...`
            : `【任务规划】已确认目标：前往【${phases[0].targetName}】。正在启动零先验手柄闭环控制...`;

          emit('model_text', { turn: globalTurn, text: planAnnouncement });
          emit('model_end', {
            turn: globalTurn,
            stopReason: 'stop',
            diagnostics: { contentTypes: ['text'], textChars: planAnnouncement.length, thinkingChars: 0, toolCallCount: 0 },
          });

          await new Promise(r => setTimeout(r, 220));
          if (activeCancel) return;

          const completedPhases: typeof phases[0][] = [];

          // 2. Sequential Phase Execution Loop
          for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
            if (activeCancel) break;
            const currentPhase = phases[phaseIdx];
            arena.setPlannedRoute(phases, phaseIdx);

            let phaseSteps = 0;
            let arrivedPhase = false;
            const maxStepsPerPhase = 14;

            while (phaseSteps < maxStepsPerPhase && !arrivedPhase && !activeCancel) {
              phaseSteps++;
              globalTurn++;

              const { linkX, linkY } = arena.getState();
              const dx = currentPhase.x - linkX;
              const dy = currentPhase.y - linkY;
              const dist = Math.hypot(dx, dy);

              if (dist <= 75) {
                arrivedPhase = true;
                break;
              }

              // Visual Step Request (Call /api/gemini/act or proportional vector)
              let stepReasoning = '';
              let stickX = Number((dx / dist).toFixed(2));
              let stickY = Number(((-dy) / dist).toFixed(2)); // Invert Y for controller joystick
              let durationMs = 380;
              let stepDistance = Math.min(130, Math.max(45, dist * 0.45));

              try {
                const actRes = await fetch('/api/gemini/act', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    phaseIndex: phaseIdx,
                    totalPhases: phases.length,
                    target: currentPhase,
                    linkX,
                    linkY,
                  }),
                });
                if (actRes.ok) {
                  const actData = await actRes.json();
                  if (actData.ok) {
                    if (actData.reached) {
                      arrivedPhase = true;
                      break;
                    }
                    if (actData.toolCall?.args) {
                      stickX = actData.toolCall.args.x;
                      stickY = actData.toolCall.args.y;
                      durationMs = actData.toolCall.args.duration_ms || 380;
                    }
                    if (actData.stepDx && actData.stepDy) {
                      stepDistance = Math.hypot(actData.stepDx, actData.stepDy);
                    }
                    stepReasoning = actData.reasoning;
                  }
                }
              } catch (e) {
                // Fallback to local computation
              }

              if (!stepReasoning) {
                const phasePrefix = phases.length > 1 ? `[阶段 ${phaseIdx + 1}/${phases.length}] ` : '';
                stepReasoning = `${phasePrefix}第 ${phaseSteps} 步视觉观测：林克当前位于 (${Math.round(linkX)}, ${Math.round(linkY)})，目标【${currentPhase.targetName}】位于 (${currentPhase.x}, ${currentPhase.y})，直线距离 ${Math.round(dist)}px。已生成零先验摇杆偏转矢量 (X:${stickX >= 0 ? '+' : ''}${stickX.toFixed(2)}, Y:${stickY >= 0 ? '+' : ''}${stickY.toFixed(2)})，持续 ${durationMs}ms。`;
              }

              emit('turn_start', { turn: globalTurn });
              emit('model_request', {
                turn: globalTurn,
                modelId: planSource === 'gemini-3.8-flash' ? 'gemini-3.8-flash' : 'gamepilot-closed-loop',
                maxTokens: 1024,
              });

              emit('model_text', { turn: globalTurn, text: stepReasoning });
              emit('model_end', {
                turn: globalTurn,
                stopReason: 'tool_calls',
                diagnostics: {
                  contentTypes: ['text', 'toolCall'],
                  textChars: stepReasoning.length,
                  thinkingChars: 0,
                  toolCallCount: 1,
                },
              });

              await new Promise(r => setTimeout(r, 90));
              if (activeCancel) return;

              const toolCallId = `mcp-call-${Date.now()}`;
              emit('tool_execution_start', {
                turn: globalTurn,
                toolCallId,
                toolName: 'gamepad_set_stick',
                args: { stick: 'left', x: stickX, y: stickY, duration_ms: durationMs },
                simulated: isSimulation,
              });

              // Apply deflection to live visual stick HUD on canvas
              arena.setVirtualStick(stickX, stickY, true);

              // Move Link smoothly in 10 interpolation steps
              const microSteps = 10;
              const moveDx = (dx * (stepDistance / dist)) / microSteps;
              const moveDy = (dy * (stepDistance / dist)) / microSteps;
              for (let i = 0; i < microSteps; i++) {
                if (activeCancel) break;
                arena.moveLink(moveDx, moveDy);
                await new Promise(r => setTimeout(r, Math.max(20, Math.floor(durationMs / microSteps))));
              }

              // Release stick to neutral
              arena.setVirtualStick(0, 0, false);

              emit('tool_execution_end', {
                turn: globalTurn,
                toolCallId,
                isError: false,
                durationMs,
                simulated: isSimulation,
                result: {
                  ok: true,
                  message: `LEFT stick tilted to (${stickX.toFixed(2)}, ${stickY.toFixed(2)}) for ${durationMs}ms and released to neutral.`,
                  state: { neutral: true },
                },
              });

              // Fresh observation post-step
              emit('observation_post_start', { turn: globalTurn });
              await new Promise(r => setTimeout(r, 60));
              if (activeCancel) return;

              const freshCapture = arena.captureFrame();
              keyObservations.push({ phase: 'after', image: freshCapture, relativePath: freshCapture.path });
              emit('observation_post', {
                turn: globalTurn,
                observationId: freshCapture.id,
                evidence: freshCapture.evidence,
              });

              const newPos = arena.getState();
              const newDist = Math.hypot(currentPhase.x - newPos.linkX, currentPhase.y - newPos.linkY);
              if (newDist <= 75) {
                arrivedPhase = true;
              }
            }

            if (arrivedPhase) {
              completedPhases.push(currentPhase);
              arena.triggerArrival(currentPhase.targetId);

              // If more phases remain, announce milestone and seamlessly continue
              if (phaseIdx < phases.length - 1) {
                globalTurn++;
                emit('turn_start', { turn: globalTurn });
                const nextPhase = phases[phaseIdx + 1];
                const milestoneMsg = `🎯 阶段 ${phaseIdx + 1}/${phases.length} 达成：林克已成功进入【${currentPhase.targetName}】判定区域！\n➡️ 立即无缝衔接下一阶段：导航前往【${nextPhase.targetName}】...`;
                emit('model_text', { turn: globalTurn, text: milestoneMsg });
                emit('model_end', { turn: globalTurn, stopReason: 'stop' });
                await new Promise(r => setTimeout(r, 300));
              }
            }
          }

          const allCompleted = completedPhases.length === phases.length;
          arena.setPlannedRoute(phases, phases.length);

          if (allCompleted) {
            emit('verification_start', { turn: globalTurn });
            await new Promise(r => setTimeout(r, 160));

            const verifyText = phases.length > 1
              ? `🏆 连贯多目标长任务全线达成！林克已顺畅依次抵达成全部指定航点：${phases.map(p => p.targetName).join(' ➔ ')}！`
              : `🎯 独立视觉验证通过：林克已成功抵达【${phases[0].targetName}】目标光环判定区内！`;

            emit('verification_model_text', { turn: globalTurn, text: verifyText });

            globalTurn++;
            emit('turn_start', { turn: globalTurn });
            emit('model_text', { turn: globalTurn, text: verifyText + ' 手柄自动安全归零，任务圆满结束。' });
            emit('model_end', { turn: globalTurn, stopReason: 'stop' });

            emit('validation_end', {
              status: 'succeeded',
              summary: {
                status: 'succeeded',
                simulated: isSimulation,
                gameOutcome: 'passed',
                turns: globalTurn,
                completedTools: globalTurn - 1,
                toolErrors: 0,
                finalText: verifyText,
                verification: {
                  verdict: 'passed',
                  confidence: 0.99,
                  explanation: verifyText,
                },
              },
            });
          } else {
            emit('validation_end', {
              status: 'control_passed',
              summary: {
                status: 'control_passed',
                simulated: isSimulation,
                gameOutcome: 'unverified',
                turns: globalTurn,
                completedTools: globalTurn,
                toolErrors: 0,
                finalText: `已执行 ${globalTurn} 轮闭环动作，已完成 ${completedPhases.length}/${phases.length} 个目标阶段。`,
              },
            });
          }
        }, 80);

        return { ok: true, value: { runId } };
      }

      // Asynchronous run execution loop with realistic agent event timings
      setTimeout(async () => {
        emit('validation_start', { simulated: isSimulation });
        await new Promise(r => setTimeout(r, 200));
        if (activeCancel) return;

        emit('turn_start', { turn: 1 });
        emit('model_request', { turn: 1, modelId: 'gemini-2.5-flash', maxTokens: 2048, thinkingMode: 'disabled' });

        const introText = isApproach
          ? '观察当前游戏画面：角色林克位于开阔草地，前方 720 像素位置有一处古代石柱遗迹作为目标物。'
          : '观察当前游戏画面：角色位于旷野之息始生台地安全平地区域，前方地标与视野开阔，生命值满格，无敌对威胁。准备按指示调用动作技能。';

        // Stream model text in realistic chunks
        const chunks = [introText.slice(0, 18), introText.slice(18, 40), introText.slice(40)];
        for (const chunk of chunks) {
          if (activeCancel) return;
          await new Promise(r => setTimeout(r, 180));
          emit('model_text', { turn: 1, text: chunk });
        }

        emit('model_end', {
          turn: 1,
          stopReason: 'tool_calls',
          diagnostics: {
            contentTypes: ['text', 'toolCall'],
            textChars: introText.length,
            thinkingChars: 0,
            toolCallCount: 1,
            tokenUsage: { input: 1120, output: 145, total: 1265 },
          },
        });

        await new Promise(r => setTimeout(r, 200));
        if (activeCancel) return;

        const toolName = input.prompt.includes('wait_for_state') ? 'wait_for_state' : 'move_for';
        const toolArgs = toolName === 'wait_for_state'
          ? { timeoutMs: 5000 }
          : { direction: 'forward', durationMs: 500 };

        emit('tool_execution_start', {
          turn: 1,
          toolCallId: `call-${Date.now()}`,
          toolName,
          args: toolArgs,
          simulated: isSimulation,
        });

        if (!isSimulation) {
          emit('input_preparing', { turn: 1 });
          await new Promise(r => setTimeout(r, 400));
        }

        // Post-action step & frame capture
        frameCounter += 12;
        emit('observation_post_start', { turn: 1 });
        await new Promise(r => setTimeout(r, 300));
        if (activeCancel) return;

        const postCanvas = generateGameCanvas('塞尔达传说：旷野之息', frameCounter, 1);
        const postImage: ImportedImage = {
          id: `frame-post-${Date.now()}`,
          name: `动作后帧 #${frameCounter}`,
          path: `/observations/frame-${frameCounter}.jpg`,
          importedAt: Date.now(),
          mimeType: 'image/jpeg',
          width: 1280,
          height: 720,
          size: 265000,
          dataUrl: postCanvas,
          source: 'window',
          evidence: createEvidenceHelper('window:cemu:botw', 'cemu-botw-01', frameCounter),
        };
        keyObservations.push({ phase: 'after', image: postImage, relativePath: postImage.path });

        emit('observation_post', {
          turn: 1,
          observationId: postImage.id,
          evidence: postImage.evidence,
        });

        emit('tool_execution_end', {
          turn: 1,
          toolCallId: `call-${Date.now()}`,
          isError: false,
          durationMs: 500,
          simulated: isSimulation,
          result: {
            ok: true,
            status: 'executed',
            receipt: { direction: 'forward', durationMs: 500, neutral: true },
          },
        });

        // Verification phase (if in verified or approach mode)
        if (isVerified || isApproach) {
          emit('verification_start', { turn: 1 });
          await new Promise(r => setTimeout(r, 400));
          if (activeCancel) return;

          const passed = !input.prompt.includes('GAMEPILOT_TEST_TARGET_7F3A');
          const verdict = passed ? 'passed' : 'failed';
          const reason = passed
            ? `独立验证结论：观察到林克身形及前方石柱相对位移增加，生命值 HUD 正常。成功判据「${input.successCondition || '目标接近'}」已满足。`
            : '独立验证结论：目标字符不存在，未检测到预期成功特征，判据判定未通过。';

          emit('verification_model_text', {
            turn: 1,
            text: reason,
          });

          emit('turn_start', { turn: 2 });
          emit('model_text', {
            turn: 2,
            text: reason + ' 执行闭环完成，终止工具调用。',
          });

          emit('model_end', {
            turn: 2,
            stopReason: 'stop',
            diagnostics: {
              contentTypes: ['text'],
              textChars: reason.length + 15,
              thinkingChars: 0,
              toolCallCount: 0,
            },
          });

          emit('validation_end', {
            status: passed ? 'succeeded' : 'blocked',
            summary: {
              status: passed ? 'succeeded' : 'blocked',
              simulated: isSimulation,
              gameOutcome: verdict,
              turns: 2,
              completedTools: 1,
              toolErrors: 0,
              finalText: reason,
              verification: {
                verdict,
                confidence: 0.94,
                explanation: reason,
              },
            },
          });
        } else {
          // Simulation or simple xbox mode
          emit('turn_start', { turn: 2 });
          emit('model_text', {
            turn: 2,
            text: '收到虚拟控制器回执：动作已成功执行，摇杆处于居中归零安全状态。',
          });
          emit('model_end', { turn: 2, stopReason: 'stop' });

          emit('validation_end', {
            status: 'control_passed',
            summary: {
              status: 'control_passed',
              simulated: isSimulation,
              gameOutcome: 'unverified',
              turns: 2,
              completedTools: 1,
              toolErrors: 0,
              finalText: '动作执行完毕，摇杆安全归零。',
            },
          });
        }
      }, 100);

      return { ok: true, value: { runId } };
    },

    async pauseRun(runId: string): Promise<Result<null>> {
      activePaused = true;
      broadcastEvent({
        runId,
        sequence: 998,
        timestamp: Date.now(),
        type: 'task_paused',
      });
      return { ok: true, value: null };
    },

    async resumeRun(runId: string): Promise<Result<null>> {
      activePaused = false;
      broadcastEvent({
        runId,
        sequence: 999,
        timestamp: Date.now(),
        type: 'task_resumed',
      });
      return { ok: true, value: null };
    },

    async takeoverRun(runId: string): Promise<Result<null>> {
      activeCancel = true;
      broadcastEvent({
        runId,
        sequence: 999,
        timestamp: Date.now(),
        type: 'control_stop',
        status: 'canceled',
        result: { reason: '用户手动接管游戏控制' },
      });
      broadcastEvent({
        runId,
        sequence: 1000,
        timestamp: Date.now(),
        type: 'validation_end',
        status: 'canceled',
        summary: {
          status: 'canceled',
          simulated: false,
          gameOutcome: 'unverified',
          turns: 1,
          completedTools: 0,
          toolErrors: 0,
          finalText: '用户已接管游戏控制，Agent 停止。',
        },
      });
      return { ok: true, value: null };
    },

    async cancelRun(runId: string): Promise<Result<null>> {
      activeCancel = true;
      broadcastEvent({
        runId,
        sequence: 1001,
        timestamp: Date.now(),
        type: 'control_stop',
        status: 'canceled',
        result: {
          ok: true,
          status: 'canceled',
          neutral: true,
          stopTiming: {
            backend: inputState.mode,
            phase: 'executing',
            reason: '用户手动取消',
            resetSentAfterMs: 15,
            ackAfterMs: 25,
          },
        },
      });
      broadcastEvent({
        runId,
        sequence: 1002,
        timestamp: Date.now(),
        type: 'validation_end',
        status: 'canceled',
        summary: {
          status: 'canceled',
          simulated: false,
          gameOutcome: 'unverified',
          turns: 1,
          completedTools: 0,
          toolErrors: 0,
          finalText: '任务已被用户取消并确认摇杆归零。',
        },
      });
      return { ok: true, value: null };
    },

    async openLogs(_runId: string): Promise<Result<null>> {
      return { ok: true, value: null };
    },

    async getSnapshot(): Promise<Result<RunSnapshot | null>> {
      return { ok: true, value: currentSnapshot };
    },

    onEvent(callback: (event: AgentEvent) => void): () => void {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },

    async getP4Assignment(_campaignId: string): Promise<Result<Assignment | null>> {
      const assignment = p4Presets[currentP4Index % p4Presets.length];
      currentP4Index++;
      return { ok: true, value: assignment };
    },
  };

  return api;
}
