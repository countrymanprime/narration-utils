import { z } from 'zod';
import type { AssetCatalog, AssetInstallJob, AssetInstallState, AssetJobPhase, AssetVerifyResult } from '../contracts/assets';
import { listFromNull } from './base';

const assetJobPhaseSchema = z.enum(['downloading', 'verifying', 'success', 'cancelled', 'error']) satisfies z.ZodType<AssetJobPhase>;

/**
 * What every asset install reports: the same fields for a voice and a model, so one hook and one dialog serve both. Each binding's schema
 * adds the name of its asset (`voiceId`, `modelId`) and is checked against `AssetInstallJob` there.
 */
export const assetInstallJobShape = {
  id: z.string(),
  kind: z.string(),
  assetId: z.string(),
  phase: assetJobPhaseSchema,
  message: z.string(),
  percent: z.number(),
  bytesDone: z.number(),
  bytesTotal: z.number(),
  error: z.string(),
};

export const assetInstallStateSchema = z.enum(['installed', 'not_installed', 'verification_failed']) satisfies z.ZodType<AssetInstallState>;

export const assetCatalogSchema = z.object({
  cacheRoot: z.string(),
  totalInstalledBytes: z.number(),
  assets: listFromNull(
    z.object({
      kind: z.string(),
      kindLabel: z.string(),
      id: z.string(),
      displayName: z.string(),
      version: z.string(),
      publisher: z.string(),
      license: z.string(),
      licenseUrl: z.string(),
      modelCardUrl: z.string(),
      provenanceUrl: z.string(),
      attribution: z.string(),
      downloadSize: z.number(),
      diskSize: z.number(),
      installState: assetInstallStateSchema,
      path: z.string(),
      installedAt: z.string(),
      verifiedAt: z.string(),
      activeJobId: z.string(),
    }),
  ),
}) satisfies z.ZodType<AssetCatalog>;

export const assetVerifyResultSchema = z.object({
  kind: z.string(),
  id: z.string(),
  installState: assetInstallStateSchema,
}) satisfies z.ZodType<AssetVerifyResult>;

export const assetInstallJobSchema = z.object(assetInstallJobShape) satisfies z.ZodType<AssetInstallJob>;
