export type Box = [number, number, number, number]; // normalized x, y, width, height
export interface TargetDetection {
  mode: 'gameplay' | 'menu' | 'dialog' | 'loading' | 'unknown';
  visible: boolean; sameTarget: boolean; sceneStable: boolean; pathClear: boolean;
  interaction?: { status: 'present' | 'absent' | 'unknown'; text: string };
  box: Box | null; confidence: number; facts: string[];
}
export interface TargetState extends TargetDetection {
  version: number; observationId: string; targetId: string; capturedAt: number | null;
  observedAt: number; validUntil: number; clock: 'main-monotonic'; confidenceSource: 'vlm-self-report';
  invalidReason?: string;
  responseDiagnostic?: { length: number; preview: string };
}
export interface ApproachStats { calls: number; steps: number; executedSteps: number; observations: number; trackingCalls: number; corrections: number; stopReason: string }
