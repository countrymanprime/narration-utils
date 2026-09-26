import { z } from 'zod';
import type { WorkspaceAlignmentResult, WorkspaceExtra, WorkspaceItem, WorkspaceParagraph, WorkspaceToken } from '../contracts/workspace';
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
