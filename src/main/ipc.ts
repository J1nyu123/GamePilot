import type { ApproachSpec } from '../contracts/approach';
import type { ExecutionStrategy } from '../contracts/run';
import { createApproachExperiment } from '../experiments/approach';
import { createRealExecution } from '../runtime/real-execution';
import { nextAssignment, reserveAssignment, type Assignment } from '../benchmarks/campaign';
import { ipcMain, dialog, nativeImage, shell, BrowserWindow, globalShortcut } from 'electron';
import { readFile, stat, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { channels, captureChannels, type ImportedImage, type Result, type ExecutionMode } from '../contracts/debug';
import { configSummary, loadModelConfig } from './model-config';
import { DebugSession } from './session';
import { runValidation } from '../agent/validation-runtime';
import { NativeWindows } from '../capture/native-window';
import { WindowStream } from '../capture/window-stream';
import { CaptureController } from '../capture/controller';
import { toObservation } from '../capture/observation';
import { ManualInputController } from '../input/manual-controller';
import { findPython } from '../input/python-client';
import { inputChannels, type InputMode, type ManualSkill } from '../contracts/input';
import type { GoalSpec } from '../contracts/verification';

// Host-only dependency injection for isolated tests; no renderer or environment bypass.
export function registerIpc(window: BrowserWindow, root: string, overrides: {
  input?: ConstructorParameters<typeof ManualInputController>[3]; emergencyShortcut?: string;
  isForeground?: (sourceId: string) => Promise<boolean>;
} = {}) {
  const emergencyShortcut = overrides.emergencyShortcut ?? 'F8';
  let inputController: ManualInputController;
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
  const session = new DebugSession(resolve(root, 'runs'), runValidation, event => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try { window.webContents.send(channels.event, event); } catch { /* A closing renderer must not break trace persistence. */ }
    }
  });
  let inputLog = Promise.resolve(), inputLogFailed = false;
  inputController = new ManualInputController(findPython(root), resolve(root, 'dist/python/gamepad_service.py'), state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) try { window.webContents.send(inputChannels.update, state); } catch { /* Closing. */ }
    if (inputLogFailed) return;
    // Minimal P2-B diagnostic log, kept separate from model sessions.
    const record = { timestamp: Date.now(), ...state }; delete (record as { history?: unknown }).history;
    inputLog = inputLog.then(async () => { await mkdir(resolve(root, 'input-debug'), { recursive: true });
      await appendFile(resolve(root, 'input-debug/events.jsonl'), JSON.stringify(record) + '\n'); }).catch(() => {
        if (!inputLogFailed) { inputLogFailed = true; session.cancelActive(); void inputController.stop('输入日志写入失败').catch(() => {}); }
      });
  }, overrides.input);
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: '无效请求来源' };
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
  });
  handle(channels.p4, (id: string) => nextAssignment(root, id));
  handle(channels.config, () => configSummary(root));
  handle(channels.capabilities, () => ({ realMovement: true, maxRealTools: 1, goalVerification: true, targetApproach: true }));
  handle(channels.snapshot, () => session.current);
  handle(inputChannels.state, () => inputController.state);
  handle(inputChannels.connect, async (mode: InputMode) => {
    if (session.busy) throw new Error('模型任务执行期间不能连接手柄');
    if (mode === 'virtual-xbox' && !globalShortcut.register(emergencyShortcut, () => { if (session.controlsInput) session.cancelActive(`${emergencyShortcut} 紧急停止`); void inputController.stop(`${emergencyShortcut} 紧急停止`).catch(() => {}); })) throw new Error(`${emergencyShortcut} 被占用，请退出原型或其他占用程序后重试`);
    try { await inputController.connect(mode); } catch (error) { if (mode === 'virtual-xbox') globalShortcut.unregister(emergencyShortcut); throw error; }
    return null;
  });
  handle(inputChannels.disconnect, async () => { if (session.controlsInput) { session.cancelActive(); await session.close(); } try { await inputController.disconnect(); } finally { globalShortcut.unregister(emergencyShortcut); } return null; });
  handle(inputChannels.stop, async () => { if (session.controlsInput) session.cancelActive(); await inputController.stop(); return null; });
  handle(inputChannels.execute, async (skill: ManualSkill) => {
    if (inputLogFailed) throw new Error('输入日志写入失败，请检查目录权限并重启应用');
    if (session.busy) throw new Error('模型任务执行期间不能发送手柄输入');
    const state = capture.state, selectedWindow = state.window;
    const guard = async () => {
      if (!selectedWindow) throw new Error('真实输入需先选择游戏窗口并开始预览');
      await capture.assertCurrent(selectedWindow.id, state.generation, selectedWindow.identity);
      const info = await native.info(selectedWindow.id);
      if (!info || info.identity !== selectedWindow.identity || !(overrides.isForeground ? await overrides.isForeground(selectedWindow.id) : info.foreground)) throw new Error('游戏窗口失焦或已关闭，已停止输入');
    };
    if (inputController.state.mode === 'virtual-xbox' && (!selectedWindow || state.status !== 'streaming')) throw new Error('真实输入需先选择游戏窗口并开始预览');
    return inputController.execute(skill, guard);
  });
  handle(captureChannels.list, () => capture.list());
  handle(captureChannels.state, () => capture.state);
  handle(captureChannels.start, async (id: string) => {
    if (session.busy || inputController.busy) throw new Error('执行期间不能切换捕获窗口');
    if (typeof id !== 'string' || !(await capture.list()).some(w => w.id === id)) throw new Error('请从窗口列表选择有效窗口');
    await capture.start(id); return null;
  });
  handle(captureChannels.stop, async () => { if (session.controlsInput) { session.cancelActive(); await session.close(); } if (inputController.busy) await inputController.stop('停止窗口预览'); capture.stop(); return null; });
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
  handle(channels.start, async (input: { imageId: string; prompt: string; timeoutMs: number; executionMode?: ExecutionMode; successCondition?: string; benchmark?: Assignment; approach?: Omit<ApproachSpec, 'targetId'>; executionStrategy?: ExecutionStrategy }) => {
    if (session.busy) throw new Error('已有运行正在进行');
    if (inputController.busy) throw new Error('请等待手柄调试输入结束后运行模型');
    if (!input || !selected || input.imageId !== selected.image.id) throw new Error('请先导入本次输入图片');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000) throw new Error('任务需为 1–8000 字符');
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 300000) throw new Error('超时需为 1–300 秒');
    const mode = input.executionMode ?? 'simulation';
    if (!['simulation', 'virtual-xbox', 'verified-xbox', 'approach-xbox'].includes(mode)) throw new Error('无效模型工具模式');
    let goal: GoalSpec | undefined;
    if (input.executionStrategy !== undefined && (mode !== 'approach-xbox' || !['direct', 'agent'].includes(input.executionStrategy))) throw new Error('执行策略仅用于 P3，且必须为 direct/agent');
    const experiment = mode === 'approach-xbox' ? createApproachExperiment(input.approach, input.successCondition!, input.executionStrategy) : undefined;
    if (mode === 'verified-xbox' || experiment) {
      if (typeof input.successCondition !== 'string' || !input.successCondition.trim() || input.successCondition.length > 2000) throw new Error('目标验证需填写 1–2000 字符的可见成功条件');
      goal = experiment?.task ?? Object.freeze({ id: randomUUID(), successCondition: input.successCondition.trim() });
    }
    const fixed = selected;
    const config = await loadModelConfig(root);
    if (fixed.image.evidence) {
      const evidence = fixed.image.evidence;
      if (fixed.selectedAt === undefined || performance.now() - fixed.selectedAt > 3000) throw new Error('窗口截图已过期，请截取新帧或在实时模式运行');
      await capture.assertCurrent(evidence.sourceId, evidence.generation, evidence.identity);
    }
    if (input.benchmark && (mode !== 'verified-xbox' || input.timeoutMs !== input.benchmark.timeoutMs || input.prompt.trim() !== input.benchmark.prompt || input.successCondition?.trim() !== input.benchmark.successCondition)) throw new Error('P4 必须使用冻结的目标验证任务，不能修改指令或判据');
    if (mode === 'simulation') return session.start(fixed.image, fixed.bytes, input.prompt.trim(), input.timeoutMs, config);
    if (inputLogFailed) throw new Error('输入日志写入失败，请检查目录权限并重启应用');
    if (fixed.image.source !== 'window' || !fixed.image.evidence || capture.state.status !== 'streaming') throw new Error('真实模型工具必须使用预览中的游戏窗口，不接受导入图片');
    if (inputController.state.mode !== 'virtual-xbox' || inputController.state.status !== 'ready') throw new Error('请先在手柄调试区连接真实虚拟 Xbox');
    if (!globalShortcut.isRegistered(emergencyShortcut)) throw new Error(`${emergencyShortcut} 紧急停止未就绪，拒绝真实输入`);
    const evidence = fixed.image.evidence;
    const guard = async () => {
      if (inputLogFailed) throw new Error('输入日志写入失败');
      await capture.assertCurrent(evidence.sourceId, evidence.generation, evidence.identity);
      const info = await native.info(evidence.sourceId);
      if (!info || info.identity !== evidence.identity || !(overrides.isForeground ? await overrides.isForeground(evidence.sourceId) : info.foreground)) throw new Error('游戏窗口失焦或已关闭，已停止 Agent');
    };
    const benchmark = input.benchmark ? await reserveAssignment(root, input.benchmark, config) : undefined;
    const execution = createRealExecution({ inputController, guard, captureInput, config, evidence, goal, experiment, interrupt: () => session.cancelActive() });
    return session.start(fixed.image, fixed.bytes, input.prompt.trim(), input.timeoutMs, config, {
      simulated: false, goal, benchmark, experiment, pausable: !experiment, ...execution,
    });
  });
  handle(channels.pause, (runId: string) => { session.pause(runId); return null; });
  handle(channels.resume, (runId: string) => { session.resume(runId); return null; });
  handle(channels.takeover, async (runId: string) => {
    const bound = session.current?.input?.evidence;
    if (!bound || session.current?.runId !== runId || !session.controlsInput) throw new Error('没有可接管的真实任务');
    session.cancel(runId, '用户接管'); await session.waitForEnd();
    if (inputController.state.neutral !== true || session.current?.summary?.status !== 'canceled') throw new Error('未确认安全取消，不能接管');
    await native.focus(bound.sourceId, bound.identity); return null;
  });
  handle(channels.cancel, (runId: string) => { session.cancel(runId); return null; });
  handle(channels.logs, async (runId: string) => {
    const dir = session.runDirectory(runId);
    if (!dir) throw new Error('没有此运行的日志');
    const error = await shell.openPath(dir);
    if (error) throw new Error('无法打开日志目录'); return null;
  });
  return { session, closeCapture: () => { capture.stop(); native.close(); }, closeInput: async () => {
    try { await inputController.disconnect(); } finally { globalShortcut.unregister(emergencyShortcut); await inputLog; }
  }, inputBusy: () => inputController.busy || inputController.state.status !== 'disconnected' };
}
