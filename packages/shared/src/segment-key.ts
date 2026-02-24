import { createHash } from 'node:crypto';

export type SegmentKeyInput = {
  projectId: string;
  variantType: 'SHORT_15' | 'MASTER_30';
  segmentIndex: number;
  model: string;
  seconds: 4 | 8 | 12;
  size: string;
  prompt: string;
  inputReferenceHash?: string;
};

export function buildSegmentKey(input: SegmentKeyInput): string {
  const raw = [
    input.projectId,
    input.variantType,
    String(input.segmentIndex),
    input.model,
    String(input.seconds),
    input.size,
    input.prompt,
    input.inputReferenceHash ?? ''
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}
