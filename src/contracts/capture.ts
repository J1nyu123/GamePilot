export interface GameWindow { id: string; title: string; processName: string; identity: string; minimized: boolean; foreground: boolean; width: number; height: number }
export interface FrameEvidence {
  sourceId: string; title: string; identity: string; generation: number;
  frameSequence: number; sourceMediaTime: number; presentedFrames: number;
  barrierMediaTime: number; barrierPresentedFrames: number;
  barrierRequestedAt: number;
  capturedAt: number | null; receivedAt: number; clock: 'video-media-time';
  freshness: 'after-source-barrier';
}
export interface CaptureFrame extends FrameEvidence { dataUrl: string; width: number; height: number }
export interface CaptureState { status: 'stopped' | 'starting' | 'streaming' | 'error'; generation: number; window?: GameWindow; message: string; frame?: CaptureFrame }
// Node-internal observation. Renderer receives a reference/data URL through IPC.
export interface GameObservation {
  observationId: string; image: Buffer; capturedAt: number | null;
  mode: 'gameplay' | 'menu' | 'unknown'; evidence: FrameEvidence;
}
