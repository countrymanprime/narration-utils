import { z } from 'zod';
import type { ProofingChooseRenderResult, ProofingRender } from '../contracts/proofingRender';
import { optionalFromNull } from './base';
import { measureReportSchema } from './measure';
import { STAGE_UNKNOWN_CAUSES } from './stages';

// apps/desktop/bindings_proofing_render.go's ProofingRenderView and ProofingChooseRender's two wrappers around it
// (proofing-readiness-signals.prd.md Phase 6). The cause list is the stage recommendations one (schemas/stages.ts).

const causeSchema = z.enum(STAGE_UNKNOWN_CAUSES);

export const proofingRenderSchema = z.object({
  state: z.enum(['none', 'current', 'stale', 'missing', 'unsupported']),
  cause: optionalFromNull(causeSchema),
  reason: z.string(),
  path: optionalFromNull(z.string()),
  format: optionalFromNull(z.string()),
  attestedAt: optionalFromNull(z.string()),
  measurement: optionalFromNull(measureReportSchema),
  measuredAt: optionalFromNull(z.string()),
  measurementFailed: z.boolean(),
}) satisfies z.ZodType<ProofingRender>;

export const proofingChooseRenderResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('refused'), message: z.string() }),
  z.object({ status: z.literal('ok'), render: proofingRenderSchema }),
]) satisfies z.ZodType<ProofingChooseRenderResult>;
