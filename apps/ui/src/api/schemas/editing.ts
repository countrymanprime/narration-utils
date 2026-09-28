import { z } from 'zod';
import type { EditingRefusalReason, EditingSourceChoice, EditingState, EditingStartResult } from '../contracts/editing';
import { listFromNull, optionalFromNull } from './base';
import { findingSchema } from './findings';

// The editing-readiness check payloads (editing-readiness-analysis.prd.md Phase 5). The reason list is pinned
// against the host by tests/fixtures/contracts/editing-start-refused-unmapped.json.

export const EDITING_REFUSAL_REASONS = [
  'unmapped',
  'multiple_tracks',
  'mapped_track_missing',
  'no_project',
  'no_project_file',
  'project_unreadable',
  'busy',
  'no_render',
] as const satisfies readonly EditingRefusalReason[];

const refusalReasonSchema = z.enum(EDITING_REFUSAL_REASONS);

export const editingStateSchema = z.object({
  runId: z.string().optional(),
  chapterId: z.string().optional(),
  phase: z.enum(['idle', 'running', 'complete', 'cancelled', 'failed']),
  percent: z.number().min(0).max(100),
  message: z.string(),
  itemsTotal: z.number(),
  itemsDone: z.number(),
  cacheHits: z.number(),
  decoded: z.number(),
  failed: z.number(),
  startedAt: optionalFromNull(z.string()),
  completedAt: optionalFromNull(z.string()),
}) satisfies z.ZodType<EditingState>;

export const editingStartResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('started'), state: editingStateSchema }),
  z.object({ status: z.literal('refused'), reason: refusalReasonSchema, message: z.string() }),
]) satisfies z.ZodType<EditingStartResult>;

export const editingCandidatesSchema = listFromNull(findingSchema);

// Q6's per-chapter source choice (Phase 8): a bare wire string, "items" or "render" (bindings_editing.go's
// EditingSourceChoice/EditingSetSourceChoice both encode a plain Go string, never an object). Unlike
// EDITING_REFUSAL_REASONS above, nothing outside this schema needs the raw list, so it stays unexported.
const EDITING_SOURCE_CHOICES = ['items', 'render'] as const satisfies readonly EditingSourceChoice[];
export const editingSourceChoiceSchema = z.enum(EDITING_SOURCE_CHOICES) satisfies z.ZodType<EditingSourceChoice>;
