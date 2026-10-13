import type { ImportedImage } from '../contracts/debug';
import type { ReleaseEvidence, Verdict } from '../contracts/verification';

export function checkEvidence(before: ImportedImage, after: ImportedImage, release: ReleaseEvidence): string | undefined {
  if (!release.receipt.ok || release.receipt.neutral !== true || (release.receipt.status && release.receipt.status !== 'executed') || release.order !== 'release-ack-then-capture') return '输入释放未确认';
  const a = before.evidence, b = after.evidence;
  if (before.source !== 'window' || after.source !== 'window' || !a || !b) return '缺少窗口源证据';
  if (a.sourceId !== b.sourceId || b.sourceId !== release.sourceId || a.identity !== b.identity || b.identity !== release.identity
    || a.generation !== b.generation || b.generation !== release.captureGeneration) return '窗口身份或采集会话已改变';
  if (!Number.isInteger(b.frameSequence) || !Number.isInteger(b.presentedFrames) || after.id === before.id || b.frameSequence <= a.frameSequence || b.sourceMediaTime <= a.sourceMediaTime || b.presentedFrames <= a.presentedFrames) return '拒绝旧帧或重复证据';
  if (b.freshness !== 'after-source-barrier' || b.clock !== 'video-media-time' || !(b.sourceMediaTime > b.barrierMediaTime && b.presentedFrames > b.barrierPresentedFrames)) return '新帧未跨越源屏障';
  // Only compare timestamps within the capture renderer's clock domain.
  if (b.capturedAt === null || !Number.isFinite(b.capturedAt) || !Number.isFinite(b.barrierRequestedAt)) return '接口未提供可靠采集时钟，不能严格确认动作后证据';
  if (b.capturedAt < b.barrierRequestedAt) return '拒绝屏障之前采集的缓存帧';
}

export function parseVerdict(text: string): { verdict: Verdict; summary: string; facts: string[] } {
  const invalid = { verdict: 'inconclusive' as const, summary: '验证模型没有返回符合契约的可核对结论', facts: [] };
  try {
    const data = JSON.parse(text);
    if (!data || Array.isArray(data) || Object.keys(data).some(k => !['verdict', 'summary', 'facts'].includes(k))
      || !['passed', 'failed', 'inconclusive'].includes(data.verdict) || typeof data.summary !== 'string' || !data.summary.trim()
      || data.summary.length > 1500 || !Array.isArray(data.facts) || data.facts.length > 6
      || data.facts.some((fact: unknown) => typeof fact !== 'string' || !fact.trim() || fact.length > 1000)
      || (data.verdict !== 'inconclusive' && !data.facts.length)) return invalid;
    return { verdict: data.verdict, summary: data.summary, facts: data.facts };
  } catch { return invalid; }
}
