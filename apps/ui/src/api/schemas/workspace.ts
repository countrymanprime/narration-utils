import { z } from 'zod';
import type {
  WorkspaceAlignmentResult,
  WorkspaceExtra,
  WorkspaceFXChainsResult,
  WorkspaceFXPluginsResult,
  WorkspaceFXResult,
  WorkspaceItem,
  WorkspaceParagraph,
  WorkspacePeaks,
  WorkspacePeaksEntry,
  WorkspacePeaksResult,
  WorkspaceToken,
} from '../contracts/workspace';
import { listFromNull, optionalFromNull } from './base';
import { COVERAGE_EVALUATOR_REASONS, COVERAGE_REFUSAL_REASONS } from './coverage';

// The workspace's stored word alignment (apps/ui/src/api/contracts/workspace.ts). Its reasons are the same list
// CoverageResult uses (tests/fixtures/contracts/coverage-reasons.json already pins it against the host).
const reasonSchema = z.union([z.enum(COVERAGE_REFUSAL_REASONS), z.enum(COVERAGE_EVALUATOR_REASONS)]);

const tokenSchema = z.object({
  i: z.number(),
  p: optionalFromNull(z.string()),
  w: z.number(),
  text: z.string(),
  status: z.enum(['read', 'misread', 'heading', 'head', 'tail', 'skip', 'short_read', 'different_text']),
  heard: optionalFromNull(z.string()),
  item: optionalFromNull(z.number()),
  start: optionalFromNull(z.number()),
  end: optionalFromNull(z.number()),
}) satisfies z.ZodType<WorkspaceToken>;

const audioPositionSchema = z.object({ itemIndex: z.number(), itemGuid: z.string(), sourceTime: z.number() });

const extraSchema = z.object({
  text: z.string(),
  tokens: z.number(),
  start: audioPositionSchema,
  end: audioPositionSchema,
  afterToken: optionalFromNull(z.number()),
}) satisfies z.ZodType<WorkspaceExtra>;

const paragraphSchema = z.object({ id: z.string(), text: z.string() }) satisfies z.ZodType<WorkspaceParagraph>;

const itemSchema = z.object({
  index: z.number(),
  itemGuid: z.string(),
  live: z.boolean(),
  takeGuid: optionalFromNull(z.string()),
  sourceStart: optionalFromNull(z.number()),
  playRate: optionalFromNull(z.number()),
  position: optionalFromNull(z.number()),
  length: optionalFromNull(z.number()),
}) satisfies z.ZodType<WorkspaceItem>;

export const workspaceAlignmentResultSchema = z.object({
  chapterId: z.string(),
  state: z.enum(['current', 'stale', 'never']),
  reasons: listFromNull(reasonSchema),
  basis: optionalFromNull(z.object({ label: z.string(), modifiedAt: z.string(), stale: z.boolean() })),
  needsAlignAgain: z.boolean(),
  paragraphs: listFromNull(paragraphSchema),
  tokens: listFromNull(tokenSchema),
  extras: listFromNull(extraSchema),
  items: listFromNull(itemSchema),
}) satisfies z.ZodType<WorkspaceAlignmentResult>;

export const workspaceFXChainsResultSchema = z.object({
  names: listFromNull(z.string()),
  truncated: z.boolean(),
}) satisfies z.ZodType<WorkspaceFXChainsResult>;

export const workspaceFXPluginsResultSchema = z.object({
  names: listFromNull(z.string()),
  truncated: z.boolean(),
}) satisfies z.ZodType<WorkspaceFXPluginsResult>;

// apps/desktop/bindings_workspace_fx_apply.go WorkspaceFXResult: omitempty drops a zero splits/added, so they default to 0.
const workspaceFXRefusalReasons = [
  'standalone',
  'not_running',
  'no_item',
  'no_source_time',
  'stale',
  'recording',
  'script_outdated',
  'failed',
  'crosses_items',
  'bad_range',
  'bad_name',
  'no_track',
] as const;

export const workspaceFXResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('added'), plugin: z.string(), itemGuid: z.string(), takeGuid: z.string(), splits: z.number().default(0) }),
  z.object({ outcome: z.literal('applied'), chain: z.string(), track: z.string(), added: z.number().default(0) }),
  z.object({ outcome: z.literal('refused'), reason: z.enum(workspaceFXRefusalReasons), message: z.string() }),
]) satisfies z.ZodType<WorkspaceFXResult>;

// The waveform strip's peaks (edit-and-proof-workspace PRD Phase 5, ADR 0520): apps/desktop/bindings_workspace_peaks.go.
const peaksSchema = z.object({
  startSeconds: z.number(),
  bucketsPerSecond: z.number(),
  buckets: z.number(),
  minMax: z.string(),
  sampleRate: z.number(),
  channels: z.number(),
}) satisfies z.ZodType<WorkspacePeaks>;

const peaksEntrySchema = z.object({
  index: z.number(),
  peaks: optionalFromNull(peaksSchema),
  reason: optionalFromNull(z.string()),
}) satisfies z.ZodType<WorkspacePeaksEntry>;

export const workspacePeaksResultSchema = z.object({
  chapterId: z.string(),
  items: listFromNull(peaksEntrySchema),
}) satisfies z.ZodType<WorkspacePeaksResult>;
