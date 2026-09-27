import { z } from 'zod';
import type {
  ExportFileResult,
  ExportItem,
  ExportJob,
  ExportRequest,
  MasteringSummary,
  PackageChecklistItem,
  PackageItem,
  PackageJob,
  PackageManifestFile,
  PackageRequest,
} from '../contracts/renderEncodeMaster';
import { listFromNull } from './base';

const nullableNumber = z.number().nullable();

const packageItemKindSchema = z.enum(['chapter', 'credits_opening', 'credits_closing', 'retail_sample']);

export const exportItemSchema = z.object({ kind: packageItemKindSchema, title: z.string(), path: z.string() }) satisfies z.ZodType<ExportItem>;

export const exportRequestSchema = z.object({
  items: z.array(exportItemSchema),
  master: z.boolean(),
  format: z.string(),
}) satisfies z.ZodType<ExportRequest>;

const masteringTargetsSchema = z.object({ rms: z.number(), rmsMin: nullableNumber, rmsMax: nullableNumber, peakMax: z.number(), ceiling: z.number() });

export const masteringSummarySchema = z.object({
  targets: masteringTargetsSchema,
  highPassHz: z.number(),
  gainDb: z.number(),
  beforeRmsDbfs: nullableNumber,
  afterRmsDbfs: nullableNumber,
  afterPeakDbfs: nullableNumber,
}) satisfies z.ZodType<MasteringSummary>;

const exportFileResultSchema = z.object({
  kind: packageItemKindSchema,
  title: z.string(),
  path: z.string(),
  status: z.enum(['pending', 'mastering', 'encoding', 'done', 'failed', 'cancelled']),
  masteredPath: z.string().optional(),
  encodedPath: z.string().optional(),
  mastering: masteringSummarySchema.optional(),
  error: z.string().optional(),
}) satisfies z.ZodType<ExportFileResult>;

export const exportJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('render_export'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  master: z.boolean(),
  format: z.string(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  files: listFromNull(exportFileResultSchema),
}) satisfies z.ZodType<ExportJob>;

export const packageItemSchema = z.object({ kind: packageItemKindSchema, title: z.string(), path: z.string() }) satisfies z.ZodType<PackageItem>;

export const packageRequestSchema = z.object({
  profileId: z.string(),
  profileVersion: z.string(),
  items: z.array(packageItemSchema),
}) satisfies z.ZodType<PackageRequest>;

const packageManifestFileSchema = z.object({
  kind: packageItemKindSchema,
  name: z.string(),
  destPath: z.string(),
  tagged: z.boolean(),
}) satisfies z.ZodType<PackageManifestFile>;

const packageChecklistItemSchema = z.object({
  ruleId: z.string(),
  label: z.string(),
  status: z.enum(['included', 'missing', 'off', 'not_applicable']),
  detail: z.string(),
}) satisfies z.ZodType<PackageChecklistItem>;

export const packageJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('render_package'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  profile: z.string(),
  outputDir: z.string(),
  files: listFromNull(packageManifestFileSchema),
  checklist: listFromNull(packageChecklistItemSchema),
  elapsed: z.number(),
  error: z.string().optional(),
}) satisfies z.ZodType<PackageJob>;
