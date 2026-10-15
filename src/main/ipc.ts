import { ipcMain, dialog, nativeImage, shell, BrowserWindow } from 'electron';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { channels, captureChannels, type ImportedImage, type Result, type ExecutionMode } from '../contracts/debug';
import { loadModelConfig } from './model-config';
import { ModelConnection } from '../models/connection';
import { modelChannels, type ModelConnectionInput } from '../contracts/model-connection';
import { DebugSession } from '../runtime/session';
import { runValidation, type ValidationOptions } from '../agent/validation-runtime';
import { runConversation, type ConversationMessage } from '../agent/conversation';
import type { RunSummary } from '../contracts/debug';
import type { FrameEvidence } from '../contracts/capture';
import { NativeWindows } from '../capture/native-window';
import { WindowStream } from '../capture/window-stream';
import { CaptureController } from '../capture/controller';
import { toObservation } from '../capture/observation';
import { gameLoopRegistry } from '../agent/game-loop';
import { VirtualGamepad } from '../input/virtual-gamepad';
import { gamepadLoopRegistry } from '../agent/gamepad-loop';
import { sendGameKeys } from '../input/windows-keyboard';
import { SimulatedInputController } from '../input/simulated-controller';
import { inputChannels, type InputMode, type InputCommand } from '../contracts/input';

// Host-only dependency injection for isolated tests; no renderer or environment bypass.
export function registerIpc(window: BrowserWindow, root: string) {
  const modelConnection = new ModelConnection(() => loadModelConfig(root));
  let inputController: SimulatedInputController;
  let selected: { image: ImportedImage; bytes: Buffer; selectedAt?: number } | undefined;
  const native = new NativeWindows(resolve(root, 'dist/capture/native-window.ps1'));
  const stream = new WindowStream(resolve(root, 'dist/capture/capture.html'));
  const capture = new CaptureController({
    list: async () => {
      const ownIds = BrowserWindow.getAllWindows().map(w => { const b = w.getNativeWindowHandle(); return `window:${b.length >= 8 ? b.readBigUInt64LE().toString() : b.readUInt32LE()}:0`; });
      return (await native.list()).filter(w => !ownIds.includes(w.id)).sort((a, b) => Number(b.processName.toLowerCase().startsWith('cemu')) - Number(a.processName.toLowerCase().startsWith('cemu')) || a.title.localeCompare(b.title));
    }, info: id => native.info(id), start: id => stream.start(id), frame: () => stream.frame(), stop: () => stream.close(),
  }, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) try { window.webContents.send(captureChannels.update, state); } catch { /* Window is closing. */ }
  });
  const gamepad = new VirtualGamepad(root);
  const history: ConversationMessage[] = [];
  const executeTask = async (options: ValidationOptions, evidence?: FrameEvidence): Promise<RunSummary> => {
    if (options.executionMode === 'keyboard' || options.executionMode === 'gamepad') {
      if (!evidence) throw new Error('真实输入需要实时游戏窗口');
      const assertSource = () => capture.assertCurrent(evidence.sourceId, evidence.generation, evidence.identity);
      const captureFrame = async (signal: AbortSignal) => {
          signal.throwIfAborted(); await assertSource();
          const frame = await captureInput();
          await assertSource(); signal.throwIfAborted();
          await options.recordObservation?.(frame.image, frame.bytes);
          return { id: frame.image.id, data: frame.bytes.toString('base64'), mimeType: frame.image.mimeType };
      };
      const focus = async (signal: AbortSignal) => {
        signal.throwIfAborted(); await assertSource();
        await native.focus(evidence.sourceId, evidence.identity); signal.throwIfAborted();
      };
      if (options.executionMode === 'gamepad') {
        await gamepad.connect();
        const registry = gamepadLoopRegistry({ capture: captureFrame, act: async (args, signal) => {
          await focus(signal); return gamepad.action(evidence.sourceId, evidence.identity, args, signal);
        } }, options.signal);
        try { return await runValidation({ ...options, toolRegistry: registry }); }
        finally { if (options.signal.aborted) await gamepad.close(); }
      }
      const registry = gameLoopRegistry({
        capture: captureFrame,
        act: async (keys, durationMs, signal) => {
          signal.throwIfAborted(); await assertSource();
          await native.focus(evidence.sourceId, evidence.identity);
          signal.throwIfAborted();
          return sendGameKeys(resolve(root, 'dist/capture/windows-keyboard.ps1'), evidence.sourceId, evidence.identity, keys, durationMs, signal);
        },
      }, options.signal);
      return runValidation({ ...options, toolRegistry: registry });
    }
    return inputController.withRun(options.signal,
    registry => runValidation({ ...options, toolRegistry: registry }),
    () => options.onEvent({ sequence: 0, timestamp: Date.now(), type: 'input_released', simulated: true, result: { neutral: true }, text: '模拟手柄已归零' }));
  };
  const session: DebugSession = new DebugSession(resolve(root, 'runs'), async (options): Promise<RunSummary> => {
    if (!options.conversation) return executeTask(options, session.current?.input?.evidence);
    const imported = selected?.image.source === 'import' ? selected : undefined;
    const visualContext = { source: imported ? 'import' as const : capture.state.status === 'streaming' ? 'window' as const : 'none' as const,
      supportsImages: (await modelConnection.summary()).supportsImages === true,
      name: imported?.image.name ?? (capture.state.status === 'streaming' ? capture.state.window?.title : undefined) };
    const result = await runConversation({ ...options, visualContext }, history, async decision => {
      const reply = (text: string): RunSummary => {
        options.onEvent({ sequence: 0, timestamp: Date.now(), type: 'model_text', text });
        return { status: 'blocked', simulated: !['keyboard', 'gamepad'].includes(options.executionMode ?? 'simulation'), gameOutcome: 'unverified', turns: 1, completedTools: 0, toolErrors: 0, finalText: text };
      };
      if (!(await modelConnection.summary()).supportsImages) return reply('已识别游戏任务，但当前模型不支持图片。请在模型 API 中选择视觉模型。');
      if (decision.intent === 'act' && ['keyboard', 'gamepad'].includes(options.executionMode ?? 'simulation') && capture.state.status !== 'streaming') return reply('已识别游戏操作任务。请先选择游戏窗口并开始预览，然后重新发送指令。');
      let frame;
      if (decision.intent === 'observe' && imported) frame = imported;
      else if (capture.state.status === 'streaming') frame = await captureInput();
      else if (imported) frame = imported;
      else return reply('已识别需要游戏画面的任务。请先启动窗口预览或导入截图。');
      options.signal.throwIfAborted();
      await options.recordObservation?.(frame.image, frame.bytes);
      const taskOptions = { ...options, conversation: false, prompt: `用户消息：${options.prompt}\n识别任务：${decision.task}`,
        image: { type: 'image' as const, data: frame.bytes.toString('base64'), mimeType: frame.image.mimeType },
        // Keep Trace cycles distinct from the text-only routing request.
        onEvent: (event: Parameters<ValidationOptions['onEvent']>[0]) => options.onEvent({ ...event, turn: event.turn === undefined ? undefined : event.turn + 1 }),
      };
      if (decision.intent === 'observe') return runValidation({ ...taskOptions, toolRegistry: {
        tools: [], maxCalls: 0, allow: () => '观察意图不允许操作游戏',
        systemPrompt: 'You are GamePilot. Answer the user in Chinese based only on the supplied game image. Describe uncertainty. This is a read-only observation request: do not claim to have moved or interacted with anything.',
      } });
      return executeTask(taskOptions, frame.image.evidence);
    });
    if (!options.signal.aborted && ['completed', 'blocked', 'control_passed', 'protocol_passed'].includes(result.status)) {
      history.push({ role: 'user', text: options.prompt }, { role: 'assistant', text: result.finalText });
      history.splice(0, Math.max(0, history.length - 12));
    }
    return result;
  }, event => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try { window.webContents.send(channels.event, event); } catch { /* A closing renderer must not break trace persistence. */ }
    }
  });
  inputController = new SimulatedInputController(state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) try { window.webContents.send(inputChannels.update, state); } catch { /* Closing renderer. */ }
  });
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: '无效请求来源' };
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
  });
  handle(channels.gamepadConnect, async () => { if (session.busy) throw new Error('任务运行中'); await gamepad.connect(); return { connected: gamepad.connected }; });
  handle(channels.gamepadDisconnect, async () => { session.cancelActive('断开真实手柄'); await session.waitForEnd(); await gamepad.close(); return null; });
  handle(channels.config, () => modelConnection.summary());
  const assertModelEditable = () => { if (session.busy || inputController.busy) throw new Error('任务或手柄输入执行期间不能更改或测试模型配置'); };
  handle(modelChannels.get, () => modelConnection.info());
  handle(modelChannels.save, (input: ModelConnectionInput) => { assertModelEditable(); return modelConnection.save(input); });
  handle(modelChannels.reset, () => { assertModelEditable(); return modelConnection.reset(); });
  handle(modelChannels.test, () => { assertModelEditable(); return modelConnection.test(); });
  handle(channels.capabilities, () => ({ realMovement: true, maxRealTools: 4, simulatedMcp: true }));
  handle(channels.snapshot, () => session.current);
  handle(inputChannels.state, () => inputController.state);
  handle(inputChannels.connect, (mode: InputMode) => { if (session.busy) throw new Error('运行期间不能连接手柄'); inputController.connect(mode); return null; });
  handle(inputChannels.disconnect, async () => { session.cancelActive('断开模拟手柄'); await session.waitForEnd(); inputController.disconnect(); return null; });
  handle(inputChannels.stop, () => { session.cancelActive('手柄归零'); inputController.stop(); return null; });
  handle(inputChannels.execute, (command: InputCommand) => { if (session.busy) throw new Error('运行期间不能发送手动输入'); return inputController.execute(command); });
  handle(captureChannels.list, () => capture.list());
  handle(captureChannels.state, () => capture.state);
  handle(captureChannels.start, async (id: string) => {
    if (session.busy || inputController.busy) throw new Error('执行期间不能切换捕获窗口');
    if (typeof id !== 'string' || !(await capture.list()).some(w => w.id === id)) throw new Error('请从窗口列表选择有效窗口');
    await capture.start(id); return null;
  });
  handle(captureChannels.stop, async () => { session.cancelActive('停止窗口预览'); await session.waitForEnd(); capture.stop(); return null; });
  const captureInput = async () => {
    const frame = await capture.freshFrame();
    const selectedAt = performance.now();
    await capture.assertCurrent(frame.sourceId, frame.generation, frame.identity);
    const { dataUrl, width, height } = frame;
    const observation = toObservation(frame), evidence = observation.evidence, bytes = observation.image;
    const id = observation.observationId, path = resolve(root, 'observations', `${id}.jpg`);
    await mkdir(resolve(root, 'observations'), { recursive: true }); await writeFile(path, bytes);
    await writeFile(resolve(root, 'observations', `${id}.json`), JSON.stringify(evidence, null, 2));
    await capture.assertCurrent(frame.sourceId, frame.generation, frame.identity);
    const image: ImportedImage = { id, path, name: `${frame.title} · 帧 ${frame.frameSequence}`, importedAt: Date.now(), mimeType: 'image/jpeg', width, height, size: bytes.length, dataUrl, source: 'window', evidence };
    return { image, bytes, selectedAt };
  };
  handle(captureChannels.frame, async () => {
    if (session.busy) throw new Error('运行期间不能替换本次输入');
    const captured = await captureInput();
    if (session.busy) throw new Error('运行期间不能替换本次输入');
    selected = captured; return captured.image;
  });
  handle(channels.image, async () => {
    if (session.busy) throw new Error('运行期间不能替换图片');
    const result = await dialog.showOpenDialog(window, { title: '选择游戏截图', properties: ['openFile'], filters: [{ name: 'PNG / JPEG', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (result.canceled) return null;
    if (session.busy) throw new Error('运行期间不能替换图片');
    const path = result.filePaths[0], extension = extname(path).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('仅支持 PNG / JPEG');
    if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MiB');
    const bytes = await readFile(path);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg) throw new Error('文件不是有效 PNG / JPEG');
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw new Error('图片无法解码');
    const { width, height } = decoded.getSize();
    if (width * height > 40000000) throw new Error('图片像素过大，请使用游戏窗口截图');
    const mimeType = png ? 'image/png' as const : 'image/jpeg' as const;
    const image: ImportedImage = { id: randomUUID(), path, name: basename(path), width, height, size: bytes.length, importedAt: Date.now(), mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, source: 'import' };
    if (session.busy) throw new Error('运行期间不能替换图片');
    selected = { image, bytes }; return image;
  });
  handle(channels.start, async (input: { imageId: string; prompt: string; timeoutMs: number; executionMode?: ExecutionMode }) => {
    if (session.busy || inputController.busy) throw new Error('已有运行正在进行');
    if (!input || !selected || input.imageId !== selected.image.id) throw new Error('请先导入或截取本次输入图片');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000) throw new Error('任务需为 1–8000 字符');
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 300000) throw new Error('超时需为 1–300 秒');
    if (input.executionMode !== undefined && !['simulation', 'keyboard', 'gamepad'].includes(input.executionMode)) throw new Error('无效执行模式');
    if (['keyboard', 'gamepad'].includes(input.executionMode ?? 'simulation') && !selected.image.evidence) throw new Error('真实输入模式必须选择实时窗口，不能使用导入图片');
    const fixed = selected, config = await modelConnection.runtimeConfig();
    if (fixed.image.evidence) {
      const evidence = fixed.image.evidence;
      if (fixed.selectedAt === undefined || performance.now() - fixed.selectedAt > 3000) throw new Error('窗口截图已过期，请截取新帧');
      await capture.assertCurrent(evidence.sourceId, evidence.generation, evidence.identity);
    }
    return session.start(fixed.image, fixed.bytes, input.prompt.trim(), input.timeoutMs, config, input.executionMode);
  });
  handle(channels.message, async (input: { prompt: string; timeoutMs: number; executionMode?: ExecutionMode }) => {
    if (session.busy || inputController.busy) throw new Error('已有运行正在进行');
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000) throw new Error('消息需为 1–8000 字符');
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 300000) throw new Error('超时需为 1–300 秒');
    if (input.executionMode !== undefined && !['simulation', 'keyboard', 'gamepad'].includes(input.executionMode)) throw new Error('无效执行模式');
    const config = await modelConnection.runtimeConfig(false);
    return session.start(undefined, Buffer.alloc(0), input.prompt.trim(), input.timeoutMs, config, input.executionMode, true);
  });
  handle(channels.cancel, (runId: string) => { session.cancel(runId); return null; });
  handle(channels.logs, async (runId: string) => {
    const dir = session.runDirectory(runId);
    if (!dir) throw new Error('没有此运行的日志');
    const error = await shell.openPath(dir);
    if (error) throw new Error('无法打开日志目录'); return null;
  });
  return { session, closeCapture: () => { capture.stop(); native.close(); },
    closeInput: async () => { session.cancelActive('应用关闭'); inputController.close(); await session.waitForEnd(); await gamepad.close(); },
    inputBusy: () => gamepad.connected || inputController.busy || inputController.state.status !== 'disconnected' };
}
