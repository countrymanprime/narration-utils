import { z } from 'zod';
import type {
  WorkspaceAlignmentResult,
  WorkspaceExtra,
  WorkspaceFXChainsResult,
  WorkspaceItem,
  WorkspaceParagraph,
  WorkspacePeaks,
  WorkspacePeaksEntry,
  WorkspacePeaksResult,
  PassageTake,
  WorkspaceTakesResult,
  WorkspaceToken,
  WorkspaceUseTakeResult,
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

// The Takes panel (edit-and-proof-workspace PRD Phase 6, ADR 0700): apps/desktop/internal/passagetakes.
const passageTakeSchema = z.object({
  id: z.string(),
  source: z.enum(['item_take', 'lane_retake', 'take_review']),
  action: z.enum(['make_active', 'pick_lane', 'add_and_activate']),
  confirm: z.boolean(),
  label: z.string(),
  detail: z.string(),
  active: z.boolean(),
  itemGuid: z.string(),
  takeGuid: z.string(),
  sourceFile: z.string(),
  sourceStart: z.number(),
  sourceLength: z.number(),
  usable: z.boolean(),
  reason: z.string().optional(),
  compared: z.boolean(),
  fidelity: z.number().optional(),
  notComparedReason: z.string().optional(),
}) satisfies z.ZodType<PassageTake>;

export const workspaceTakesResultSchema = z.object({
  chapterId: z.string(),
  firstToken: z.number(),
  lastToken: z.number(),
  firstParagraph: z.number(),
  lastParagraph: z.number(),
  words: z.number(),
  passageId: z.string(),
  itemGuid: z.string(),
  message: z.string().optional(),
  comparisonId: z.string().optional(),
  candidates: listFromNull(passageTakeSchema),
}) satisfies z.ZodType<WorkspaceTakesResult>;

export const workspaceUseTakeResultSchema = z.object({
  outcome: z.enum(['done', 'started', 'refused']),
  reason: z.enum(['not_offered', 'unusable', 'stale', 'recording', 'script_outdated', 'standalone', 'not_running', 'experimental_off', 'failed']).optional(),
  message: z.string(),
  changed: z.boolean(),
}) satisfies z.ZodType<WorkspaceUseTakeResult>;
