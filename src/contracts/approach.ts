export type Box = [number, number, number, number]; // normalized x, y, width, height
export interface ApproachSpec { targetId: string; description: string; region: Box; minArea: number; requireInteraction?: boolean }
export const approachLimits = Object.freeze({ maxSteps: 8, stepMs: 200, strength: .35, maxObservations: 12,
  timeoutMs: 60000, stateMaxAgeMs: 8000, minConfidence: .85, stableFrames: 2, stableMs: 300, completionMaxAgeMs: 15000 });
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
export function validBox(box: unknown): box is Box {
  return Array.isArray(box) && box.length === 4 && box.every(n => typeof n === 'number' && Number.isFinite(n))
    && box[0] >= 0 && box[1] >= 0 && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 1 && box[1] + box[3] <= 1;
}
export function normalizeApproach(input: unknown): ApproachSpec {
  const value = input as Partial<ApproachSpec> | null;
  if (!value || Object.keys(value).some(k => !['description', 'region', 'minArea', 'requireInteraction'].includes(k))
    || (value.requireInteraction !== undefined && typeof value.requireInteraction !== 'boolean')
    || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 500
    || !validBox(value.region) || value.region[2] < .1 || value.region[3] < .1
    || typeof value.minArea !== 'number' || !Number.isFinite(value.minArea) || value.minArea < .01 || value.minArea > .4) throw new Error('P3 需填写唯一可见目标、归一化到达区域和 0.01–0.4 的目标面积占比');
  return { targetId: 'fixed-target', description: value.description.trim(), region: [...value.region], minArea: value.minArea, ...(value.requireInteraction !== undefined ? { requireInteraction: value.requireInteraction } : {}) };
}
export function approachCondition(spec: ApproachSpec, condition: string) {
  return `P3 屏幕视觉接近实验。固定目标：${JSON.stringify(spec.description)}。目标框为归一化 [x,y,w,h]，目标框中心须在区域 ${JSON.stringify(spec.region)} 内，且目标框面积 w*h >= ${spec.minArea}。必须是同一目标、正常游戏场景。只判断屏幕视觉条件，不推断世界距离。${spec.requireInteraction ? '必须连续两帧出现明确对应此目标的交互按键及文字提示；通用操作帮助不算。' : ''}附加固定可见条件：${condition}`;
}
