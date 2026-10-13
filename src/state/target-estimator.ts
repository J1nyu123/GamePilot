import type { ImportedImage } from '../contracts/debug';
import { approachLimits, validBox, type ApproachSpec, type TargetDetection, type TargetState } from '../contracts/approach';

const unknown = (reason: string): TargetDetection & { invalidReason: string } => ({ mode: 'unknown', visible: false, sameTarget: false, sceneStable: false, pathClear: false, box: null, confidence: 0, facts: [], invalidReason: reason });
export function parseDetection(text: string): TargetDetection & { invalidReason?: string } {
  try {
    // Accept only a single complete Markdown envelope; never extract JSON from prose.
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
    let data = JSON.parse(fenced ? fenced[1] : trimmed);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return unknown('定位响应必须是 JSON 对象');
    const interaction = data.interaction;
    if (Object.hasOwn(data, 'interaction')) {
      if (!interaction || Object.keys(interaction).sort().join(',') !== 'status,text'
        || !['present', 'absent', 'unknown'].includes(interaction.status)
        || typeof interaction.text !== 'string' || interaction.text.length > 200
        || (interaction.status === 'present' && !interaction.text.trim())) return unknown('interaction 必须包含提示状态和可见提示原文');
      delete data.interaction;
    }
    // Explicit versioned wire contract: no heuristic unit detection or coordinate repair.
    if (data.coordinateSystem === 'ltrb-1000') {
      if (Object.keys(data).sort().join(',') !== 'bounds1000,confidence,coordinateSystem,facts,mode,pathClear,sameTarget,sceneStable,visible') return unknown('ltrb-1000 定位字段不完整或包含额外字段');
      const b = data.bounds1000;
      if (data.visible === true && (!b || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'bottom,left,right,top'
        || !Object.values(b).every(n => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 1000)
        || b.left >= b.right || b.top >= b.bottom)) return unknown('bounds1000 必须是 0–1000 整数角点对象，left<right 且 top<bottom');
      if (data.visible !== true && b !== null) return unknown('目标不可见时 bounds1000 必须为 null');
      const { coordinateSystem: _unit, bounds1000: _bounds, ...rest } = data;
      data = { ...rest, box: b === null ? null : [b.left / 1000, b.top / 1000, (b.right - b.left) / 1000, (b.bottom - b.top) / 1000] };
    }
    if (Object.hasOwn(data, 'coordinateSystem') || Object.hasOwn(data, 'box1000')) {
      const wireKeys = 'box1000,confidence,coordinateSystem,facts,mode,pathClear,sameTarget,sceneStable,visible';
      if (Object.keys(data).sort().join(',') !== wireKeys || data.coordinateSystem !== 'xywh-1000') return unknown('定位坐标协议必须是 xywh-1000，且字段完整');
      const box = data.box1000;
      if (data.visible === true && (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isInteger)
        || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1000 || box[1] + box[3] > 1000)) {
        return unknown(`box1000=${JSON.stringify(box).slice(0, 160)} 无效；四项必须统一使用 0–1000 整数坐标，禁止混合单位`);
      }
      if (data.visible !== true && box !== null) return unknown('目标不可见时 box1000 必须为 null');
      const { coordinateSystem: _unit, box1000: _box, ...rest } = data;
      data = { ...rest, box: box === null ? null : box.map((n: number) => n / 1000) };
    }
    const expected = ['box', 'confidence', 'facts', 'mode', 'pathClear', 'sameTarget', 'sceneStable', 'visible'];
    const missing = expected.filter(k => !Object.hasOwn(data, k));
    const extra = Object.keys(data).filter(k => !expected.includes(k));
    if (missing.length || extra.length) return unknown(`定位字段不匹配：缺少 ${missing.join(', ') || '无'}；额外字段 ${extra.map(k => k.slice(0, 40)).slice(0, 10).join(', ') || '无'}`);
    if (!['gameplay', 'menu', 'dialog', 'loading', 'unknown'].includes(data.mode)) return unknown('mode 必须是 gameplay/menu/dialog/loading/unknown');
    for (const key of ['visible', 'sameTarget', 'sceneStable', 'pathClear']) {
      if (typeof data[key] !== 'boolean') return unknown(`${key} 必须是布尔值`);
    }
    if (typeof data.confidence !== 'number' || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) return unknown('confidence 必须是 0–1 的数字');
    if (data.visible ? !validBox(data.box) : data.box !== null) return unknown(data.visible
      ? `box=${JSON.stringify(data.box).slice(0, 160)} 无效；必须是归一化 [x,y,width,height]，宽高大于 0，x+width 和 y+height 不超过 1；不会自动猜测或转换坐标单位`
      : 'visible=false 时 box 必须为 null');
    if (!Array.isArray(data.facts) || data.facts.length > 6 || data.facts.some((f: unknown) => typeof f !== 'string' || !f.trim() || f.length > 500)
      || data.visible && data.facts.length === 0) return unknown('facts 必须是最多 6 条非空短字符串；目标可见时至少 1 条');
    return { ...data, ...(interaction ? { interaction } : {}) };
  } catch { return unknown(text.trim() ? '目标定位响应不是有效 JSON（响应可能截断或包含说明文字）' : '目标定位响应为空'); }
}
export interface TrackRequest { spec: ApproachSpec; initial: ImportedImage; previous?: ImportedImage; image: ImportedImage; signal: AbortSignal }
export class TargetEstimator {
  private version = 0;
  constructor(private request: (input: TrackRequest) => Promise<string>) {}
  async estimate(input: TrackRequest, observedAt: number): Promise<TargetState> {
    input.signal.throwIfAborted();
    const text = await this.request(input); input.signal.throwIfAborted();
    const parsed = parseDetection(text);
    return { ...parsed, ...(parsed.invalidReason ? { responseDiagnostic: { length: text.length, preview: text.slice(0, 2000) } } : {}), version: ++this.version, observationId: input.image.id, targetId: input.spec.targetId,
      capturedAt: input.image.evidence?.capturedAt ?? null, observedAt, validUntil: observedAt + approachLimits.stateMaxAgeMs,
      clock: 'main-monotonic', confidenceSource: 'vlm-self-report' };
  }
}
export function stateRejection(state: TargetState, spec: ApproachSpec, observationId: string, now: number, previous?: TargetState): string | undefined {
  if (state.invalidReason) return 'invalid-state';
  if (!Number.isFinite(now) || !Number.isFinite(state.capturedAt) || state.clock !== 'main-monotonic' || state.confidenceSource !== 'vlm-self-report' || state.targetId !== spec.targetId || state.observationId !== observationId || !Number.isFinite(state.observedAt) || state.validUntil !== state.observedAt + approachLimits.stateMaxAgeMs || now < state.observedAt || now >= state.validUntil) return 'stale-state';
  if (state.mode !== 'gameplay' || !state.sceneStable) return 'scene-changed';
  if (!state.visible || !state.sameTarget || !validBox(state.box)) return 'target-lost';
  if (state.confidence < approachLimits.minConfidence) return 'low-confidence';
  if (spec.requireInteraction && (!state.interaction || state.interaction.status === 'unknown')) return 'interaction-unknown';
  if (!state.pathClear) return 'path-unclear';
  if (previous?.box) {
    if (state.version <= previous.version || state.observationId === previous.observationId) return 'stale-state';
    const [x,y,w,h] = state.box, [px,py,pw,ph] = previous.box;
    if (Math.hypot(x+w/2-px-pw/2,y+h/2-py-ph/2) > .35 || w*h/(pw*ph) > 3 || w*h/(pw*ph) < 1/3) return 'target-jump';
  }
}
export function approachDecision(state: TargetState, spec: ApproachSpec): 'left' | 'right' | 'forward' | 'hold' | 'unsupported-position' {
  if (!state.box) throw new Error('没有可用目标框');
  const [x,y,w,h] = state.box, [rx,ry,rw,rh] = spec.region, cx = x+w/2, cy = y+h/2;
  if (cx < rx) return 'left';
  if (cx > rx+rw) return 'right';
  if (w*h < spec.minArea) return 'forward';
  if (spec.requireInteraction && state.interaction?.status !== 'present') return 'forward';
  return cy >= ry && cy <= ry+rh ? 'hold' : 'unsupported-position';
}
