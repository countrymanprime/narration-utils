import { z } from 'zod';
import type { PreviewCandidate, PreviewOutcome, PreviewResult } from '../contracts/preview';
import { listFromNull } from './base';

// The preview candidates payload (apps/ui/src/api/contracts/preview.ts). The host shape is
// apps/desktop/bindings_preview.go's PreviewCandidates.

const PREVIEW_OUTCOMES = ['ok', 'no_manuscript', 'nothing_eligible'] as const satisfies readonly PreviewOutcome[];

const previewCandidateSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  paragraphIds: listFromNull(z.string()),
  wordCount: z.number(),
  estimatedSeconds: z.number(),
  shorter: z.boolean(),
  reasons: listFromNull(z.string()),
  warnings: listFromNull(z.string()),
}) satisfies z.ZodType<PreviewCandidate>;

export const previewResultSchema = z.object({
  outcome: z.enum(PREVIEW_OUTCOMES),
  candidates: listFromNull(previewCandidateSchema),
}) satisfies z.ZodType<PreviewResult>;
