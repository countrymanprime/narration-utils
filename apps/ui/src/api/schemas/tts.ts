import { z } from 'zod';
import type { TtsInstallState, TtsVoice } from '../contracts/tts';

export const ttsInstallStateSchema = z.enum(['installed', 'not_installed', 'verification_failed']) satisfies z.ZodType<TtsInstallState>;

/** A voice as the host describes it before it is installed: everything but its install state and download size. */
export const ttsVoiceIdentitySchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  locale: z.string(),
  version: z.string(),
  publisher: z.string(),
  license: z.string(),
  licenseUrl: z.string(),
  modelCardUrl: z.string(),
  provenanceUrl: z.string(),
  attribution: z.string(),
}) satisfies z.ZodType<Omit<TtsVoice, 'downloadSize' | 'installState'>>;
