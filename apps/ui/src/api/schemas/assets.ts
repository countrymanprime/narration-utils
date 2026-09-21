import { z } from 'zod';
import type { AssetJobPhase } from '../contracts/assets';

const assetJobPhaseSchema = z.enum(['downloading', 'verifying', 'success', 'cancelled', 'error']) satisfies z.ZodType<AssetJobPhase>;

/**
 * What every asset install reports: the same fields for a voice and a model, so one hook and one dialog serve both. Each binding's schema
 * adds the name of its asset (`voiceId`, `modelId`) and is checked against `AssetInstallJob` there.
 */
export const assetInstallJobShape = {
  id: z.string(),
  phase: assetJobPhaseSchema,
  message: z.string(),
  percent: z.number(),
  bytesDone: z.number(),
  bytesTotal: z.number(),
  error: z.string(),
};
