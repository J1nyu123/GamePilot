import type { ImportedImage } from './debug';
import type { InputReply } from './input';

export type Verdict = 'passed' | 'failed' | 'inconclusive';
export interface GoalSpec { id: string; successCondition: string }
export interface ReleaseEvidence {
  id: string; receipt: InputReply; sourceId: string; identity: string; captureGeneration: number;
  receivedAt: number; order: 'release-ack-then-capture';
}
export interface VerificationResult {
  id: string; goalId: string; verdict: Verdict; summary: string; evidenceIds: string[];
  facts: string[]; method: 'vlm' | 'evidence-check'; releaseId: string; durationMs?: number;
}
export interface KeyObservation { image: ImportedImage; phase: 'before' | 'after'; release?: ReleaseEvidence; relativePath: string }
export interface VerificationRequest { goal: GoalSpec; before: ImportedImage; after: ImportedImage; release: ReleaseEvidence; signal: AbortSignal }
export interface ToolPacket {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  details: { simulated: false; receipt?: InputReply; verification: VerificationResult; observationId?: string; execution: string };
}
