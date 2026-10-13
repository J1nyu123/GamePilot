export interface FrameStamp { mediaTime: number; presentedFrames: number; captureTime?: number; presentationTime: number }
export interface FrameBarrier { mediaTime: number; presentedFrames: number; requestedAt: number }
// Same stream clock only; callback arrival alone cannot make a cached frame fresh.
export function isAfterBarrier(frame: FrameStamp, barrier: FrameBarrier): boolean {
  return Number.isFinite(frame.mediaTime) && Number.isFinite(frame.presentationTime)
    && frame.mediaTime > barrier.mediaTime && frame.presentedFrames > barrier.presentedFrames
    && frame.presentationTime >= barrier.requestedAt
    && (frame.captureTime === undefined || frame.captureTime >= barrier.requestedAt);
}
