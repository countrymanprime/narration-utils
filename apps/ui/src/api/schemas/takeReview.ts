import { z } from 'zod';
import type { TakeReviewCreateTakeResult, TakeReviewEvidence, TakeReviewMember, TakeReviewScanJob, TakeReviewScanScope } from '../contracts/takeReview';
import { listFromNull } from './base';

const takeReviewMemberSchema = z.object({
  item_index: z.number(),
  item_guid: z.string(),
  take_guid: z.string(),
  source_file: z.string(),
  source_start: z.number(),
  source_length: z.number(),
  coverage: z.number(),
  quality: z.number(),
  exact_copy_group: z.string(),
}) satisfies z.ZodType<TakeReviewMember>;

/**
 * A take-review finding's `evidence`. The findings contract types evidence as an open record, so the Review page checks it
 * against this before it shows or acts on a finding's reads: a finding whose evidence does not match is shown with the
 * generic evidence only, never cast.
 */
export const takeReviewEvidenceSchema = z.object({
  kind: z.string(),
  matched_span_first: z.number(),
  matched_span_last: z.number(),
  members: listFromNull(takeReviewMemberSchema),
}) satisfies z.ZodType<TakeReviewEvidence>;

const takeReviewScanScopeSchema = z.object({
  chapterTrackName: z.string(),
  pickupTrackName: z.string().optional(),
  pickupRangeStart: z.number().optional(),
  pickupRangeEnd: z.number().optional(),
}) satisfies z.ZodType<TakeReviewScanScope>;

export const takeReviewScanJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('take_review'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  scope: takeReviewScanScopeSchema,
  found: z.number(),
}) satisfies z.ZodType<TakeReviewScanJob>;

export const takeReviewCreateTakeResultSchema = z.object({
  targetItemGuid: z.string(),
  newTakeGuid: z.string(),
}) satisfies z.ZodType<TakeReviewCreateTakeResult>;
