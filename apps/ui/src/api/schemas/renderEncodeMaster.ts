import { z } from 'zod';
import type {
  ExportFileResult,
  ExportJob,
  MasteringSummary,
  MultiPackageJob,
  MultiPackageResult,
  PackageChecklistItem,
  PackageJob,
  PackageManifestFile,
  PackagePreview,
  PackagePreviewFile,
} from '../contracts/renderEncodeMaster';
import { listFromNull } from './base';

const nullableNumber = z.number().nullable();

const packageItemKindSchema = z.enum(['chapter', 'credits_opening', 'credits_closing', 'retail_sample']);

const masteringTargetsSchema = z.object({ rms: z.number(), rmsMin: nullableNumber, rmsMax: nullableNumber, peakMax: z.number(), ceiling: z.number() });

const masteringSummarySchema = z.object({
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

const multiPackageResultSchema = z.object({
  profile: z.string(),
  platform: z.string(),
  phase: z.enum(['pending', 'running', 'success', 'error']),
  message: z.string(),
  outputDir: z.string(),
  files: listFromNull(packageManifestFileSchema),
  checklist: listFromNull(packageChecklistItemSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<MultiPackageResult>;

export const multiPackageJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('render_package_multi'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  results: listFromNull(multiPackageResultSchema),
  elapsed: z.number(),
  error: z.string().optional(),
}) satisfies z.ZodType<MultiPackageJob>;

const packagePreviewFileSchema = z.object({
  kind: packageItemKindSchema,
  title: z.string(),
  name: z.string(),
  problem: z.string(),
}) satisfies z.ZodType<PackagePreviewFile>;

export const packagePreviewSchema = z.object({
  profile: z.string(),
  platform: z.string(),
  format: z.string(),
  files: listFromNull(packagePreviewFileSchema),
  problem: z.string(),
}) satisfies z.ZodType<PackagePreview>;
