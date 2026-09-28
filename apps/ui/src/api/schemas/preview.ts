import { z } from 'zod';
import type { PinnedPreview, PreviewCandidate, PreviewOutcome, PreviewPinStaleReason, PreviewResult } from '../contracts/preview';
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

// The narrator's pinned window (Phase 8). The host shape is bindings_preview_pin.go's pinnedPreviewView.

const PREVIEW_PIN_STALE_REASONS = ['text_changed', 'paragraph_missing'] as const satisfies readonly PreviewPinStaleReason[];

export const pinnedPreviewSchema = z.object({
  present: z.boolean(),
  candidate: previewCandidateSchema.optional(),
  stale: z.boolean(),
  staleReason: z.enum(PREVIEW_PIN_STALE_REASONS).optional(),
  pinnedAt: z.string().optional(),
  canExtendStart: z.boolean(),
  canShrinkStart: z.boolean(),
  canExtendEnd: z.boolean(),
  canShrinkEnd: z.boolean(),
}) satisfies z.ZodType<PinnedPreview>;
