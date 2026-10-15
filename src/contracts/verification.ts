import type { ImportedImage } from './debug';
import type { InputReply } from './input';

export type Verdict = 'passed' | 'failed' | 'inconclusive';
export interface SuccessCriterion { readonly id: string; readonly description: string; readonly required: boolean }
export interface GoalSpec { id: string; successCondition: string; targetId?: string; criteria?: readonly SuccessCriterion[] }
export interface ReleaseEvidence {
  id: string; receipt: InputReply; sourceId: string; identity: string; captureGeneration: number;
  receivedAt: number; order: 'release-ack-then-capture';
}
export interface VerificationResult {
  id: string; goalId: string; verdict: Verdict; summary: string; evidenceIds: string[];
  facts: string[]; method: 'vlm' | 'evidence-check'; releaseId: string; durationMs?: number;
  // Optional only for legacy records; GameVerifier always supplies these fields.
  taskId?: string; targetId?: string; criteria?: CriterionResult[]; observationId?: string; observedAt?: number;
}
export interface CriterionResult { id: string; verdict: Verdict; evidenceIds: string[]; reason: string }
export interface KeyObservation { image: ImportedImage; phase: 'before' | 'after'; release?: ReleaseEvidence; relativePath: string }
export interface ExecutionPacket {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  details: { simulated: false; receipt?: InputReply; verification?: VerificationResult; observationId?: string; execution: string };
}
export interface ToolPacket extends ExecutionPacket { details: ExecutionPacket['details'] & { verification: VerificationResult } }
