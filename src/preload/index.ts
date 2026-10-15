import { contextBridge, ipcRenderer } from 'electron';
import { channels, captureChannels, type DebugApi, type AgentEvent } from '../contracts/debug';
import type { CaptureState } from '../contracts/capture';
import { inputChannels, type InputDebugState } from '../contracts/input';
import { modelChannels } from '../contracts/model-connection';
const api: DebugApi = {
  getModelConnection: () => ipcRenderer.invoke(modelChannels.get),
  saveModelConnection: input => ipcRenderer.invoke(modelChannels.save, input),
  testModelConnection: () => ipcRenderer.invoke(modelChannels.test),
  resetModelConnection: () => ipcRenderer.invoke(modelChannels.reset),
  getRuntimeCapabilities: () => ipcRenderer.invoke(channels.capabilities),
  getInputState: () => ipcRenderer.invoke(inputChannels.state), connectInput: mode => ipcRenderer.invoke(inputChannels.connect, mode),
  disconnectInput: () => ipcRenderer.invoke(inputChannels.disconnect), executeInput: command => ipcRenderer.invoke(inputChannels.execute, command),
  stopInput: () => ipcRenderer.invoke(inputChannels.stop),
  onInput: callback => { const listener = (_event: unknown, state: InputDebugState) => callback(state);
    ipcRenderer.on(inputChannels.update, listener); return () => ipcRenderer.removeListener(inputChannels.update, listener); },
  getConfig: () => ipcRenderer.invoke(channels.config), importImage: () => ipcRenderer.invoke(channels.image),
  connectGamepad: () => ipcRenderer.invoke(channels.gamepadConnect),
  disconnectGamepad: () => ipcRenderer.invoke(channels.gamepadDisconnect),
  sendMessage: input => ipcRenderer.invoke(channels.message, input),
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
