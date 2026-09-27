import { z } from 'zod';
import type {
  CleanupApplyResult,
  CleanupPreviewResult,
  GainCandidate,
  GainChange,
  LevelMatchApplyResult,
  LevelMatchPreviewResult,
  StaleCleanupCandidate,
  StaleGainCandidate,
} from '../contracts/cleanup';

const staleCleanupCandidateSchema = z.object({
  findingId: z.string(),
  itemGuid: z.string(),
  reason: z.string(),
}) satisfies z.ZodType<StaleCleanupCandidate>;

export const cleanupPreviewResultSchema = z.object({
  candidates: z.number(),
  added: z.number(),
  existing: z.number(),
  stale: z.array(staleCleanupCandidateSchema),
}) satisfies z.ZodType<CleanupPreviewResult>;

export const cleanupApplyResultSchema = z.object({
  candidates: z.number(),
  applied: z.number(),
  stale: z.array(staleCleanupCandidateSchema),
}) satisfies z.ZodType<CleanupApplyResult>;

const gainCandidateSchema = z.object({
  itemGuid: z.string(),
  deltaDb: z.number(),
}) satisfies z.ZodType<GainCandidate>;

export const levelMatchPreviewResultSchema = z.object({
  candidates: z.array(gainCandidateSchema),
}) satisfies z.ZodType<LevelMatchPreviewResult>;

const gainChangeSchema = z.object({
  itemGuid: z.string(),
  beforeVolume: z.number(),
  afterVolume: z.number(),
}) satisfies z.ZodType<GainChange>;

const staleGainCandidateSchema = z.object({
  findingId: z.string(),
  itemGuid: z.string(),
  reason: z.string(),
}) satisfies z.ZodType<StaleGainCandidate>;

export const levelMatchApplyResultSchema = z.object({
  changed: z.array(gainChangeSchema),
  stale: z.array(staleGainCandidateSchema),
}) satisfies z.ZodType<LevelMatchApplyResult>;
