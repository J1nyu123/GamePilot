import { contextBridge, ipcRenderer } from 'electron';
import { channels, captureChannels, type DebugApi, type AgentEvent } from '../contracts/debug';
import type { CaptureState } from '../contracts/capture';
import { inputChannels, type InputDebugState } from '../contracts/input';
const api: DebugApi = {
  getP4Assignment: id => ipcRenderer.invoke(channels.p4, id),
  pauseRun: id => ipcRenderer.invoke(channels.pause, id), resumeRun: id => ipcRenderer.invoke(channels.resume, id), takeoverRun: id => ipcRenderer.invoke(channels.takeover, id),
  getRuntimeCapabilities: () => ipcRenderer.invoke(channels.capabilities),
  getInputState: () => ipcRenderer.invoke(inputChannels.state), connectInput: mode => ipcRenderer.invoke(inputChannels.connect, mode),
  disconnectInput: () => ipcRenderer.invoke(inputChannels.disconnect), executeInput: skill => ipcRenderer.invoke(inputChannels.execute, skill),
  stopInput: () => ipcRenderer.invoke(inputChannels.stop),
  onInput: callback => { const listener = (_event: unknown, state: InputDebugState) => callback(state);
    ipcRenderer.on(inputChannels.update, listener); return () => ipcRenderer.removeListener(inputChannels.update, listener); },
  getConfig: () => ipcRenderer.invoke(channels.config), importImage: () => ipcRenderer.invoke(channels.image),
  startRun: input => ipcRenderer.invoke(channels.start, input), cancelRun: id => ipcRenderer.invoke(channels.cancel, id),
  openLogs: id => ipcRenderer.invoke(channels.logs, id), getSnapshot: () => ipcRenderer.invoke(channels.snapshot),
  onEvent: callback => { const listener = (_event: unknown, event: AgentEvent) => callback(event);
    ipcRenderer.on(channels.event, listener); return () => ipcRenderer.removeListener(channels.event, listener); },
  listWindows: () => ipcRenderer.invoke(captureChannels.list), startPreview: id => ipcRenderer.invoke(captureChannels.start, id),
  stopPreview: () => ipcRenderer.invoke(captureChannels.stop), captureFrame: () => ipcRenderer.invoke(captureChannels.frame),
  getCaptureState: () => ipcRenderer.invoke(captureChannels.state),
  onCapture: callback => { const listener = (_event: unknown, state: CaptureState) => callback(state);
    ipcRenderer.on(captureChannels.update, listener); return () => ipcRenderer.removeListener(captureChannels.update, listener); },
};
contextBridge.exposeInMainWorld('gamepilot', api);
