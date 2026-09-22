import { z } from 'zod';
import type { WhisperCatalog, WhisperInstallJob, WhisperInstallState, WhisperModel } from '../contracts/whisper';
import type { TranscriptStartResult } from '../contracts/transcript';
import type { TeleprompterStartResult } from '../contracts/teleprompter';
import { assetInstallJobShape } from './assets';
import { listFromNull } from './base';

const whisperInstallStateSchema = z.enum(['installed', 'not_installed', 'verification_failed']) satisfies z.ZodType<WhisperInstallState>;

const modelIdentityShape = {
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  version: z.string(),
  publisher: z.string(),
  license: z.string(),
  licenseUrl: z.string(),
  modelCardUrl: z.string(),
  provenanceUrl: z.string(),
  attribution: z.string(),
};

/** A model as the host describes it before it is installed: everything but its install state and download size. */
const whisperModelIdentitySchema = z.object(modelIdentityShape) satisfies z.ZodType<Omit<WhisperModel, 'downloadSize' | 'installState'>>;

export const whisperCatalogSchema = z.object({
  catalogVersion: z.number(),
  model: z.object({ id: z.string(), effectiveSource: z.string() }),
  models: listFromNull(z.object({ ...modelIdentityShape, downloadSize: z.number(), installState: whisperInstallStateSchema })),
}) satisfies z.ZodType<WhisperCatalog>;

export const whisperInstallJobSchema = z.object({ ...assetInstallJobShape, modelId: z.string() }) satisfies z.ZodType<WhisperInstallJob>;

/**
 * The answer to starting a Transcript Compare run or a teleprompter session: it started, or the Whisper model it needs is not
 * installed yet (the first-use gate) and the narrator is asked to download it.
 */
export const startResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('started') }),
  z.object({
    status: z.literal('asset_required'),
    model: whisperModelIdentitySchema,
    installState: whisperInstallStateSchema,
    downloadSize: z.number(),
    diskSize: z.number(),
    installPath: z.string(),
  }),
]) satisfies z.ZodType<TranscriptStartResult> & z.ZodType<TeleprompterStartResult>;
