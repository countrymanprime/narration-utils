// The golden payloads for downloaded assets (voice, Whisper, the asset list): which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from '../schemas/assets';
import { ttsCatalogSchema, ttsInstallJobSchema } from '../schemas/tts';
import { whisperCatalogSchema, whisperInstallJobSchema } from '../schemas/whisper';

export const assetsGoldens: Record<string, z.ZodType> = {
  'tts-catalog.json': ttsCatalogSchema,
  'tts-install-downloading.json': ttsInstallJobSchema,
  'tts-install-success.json': ttsInstallJobSchema,
  'tts-install-error.json': ttsInstallJobSchema,
  'tts-install-cancelled.json': ttsInstallJobSchema,
  'asset-install-downloading.json': assetInstallJobSchema,
  'assets-list.json': assetCatalogSchema,
  'assets-verify.json': assetVerifyResultSchema,
  'whisper-catalog.json': whisperCatalogSchema,
  'whisper-install-downloading.json': whisperInstallJobSchema,
  'tts-install-verifying.json': ttsInstallJobSchema,
  'whisper-install-success.json': whisperInstallJobSchema,
};
