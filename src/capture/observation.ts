import { randomUUID } from 'node:crypto';
import type { CaptureFrame, GameObservation } from '../contracts/capture';
export function toObservation(frame: CaptureFrame): GameObservation {
  const { dataUrl, width: _width, height: _height, ...evidence } = frame;
  return { observationId: randomUUID(), image: Buffer.from(dataUrl.split(',')[1], 'base64'), capturedAt: frame.capturedAt, mode: 'unknown', evidence };
}
