// The golden payloads for the online pronunciation lookup (prep-depth P9): which schema owns each file in
// tests/fixtures/contracts/ (see index.ts). The Go test bindings_pronunciationonline_test.go writes them from the fake
// dictionary (D67).
import type { z } from 'zod';
import { pronunciationOnlineBatchResultSchema, pronunciationOnlineKeyStatusSchema, pronunciationOnlineResultSchema } from '../schemas/pronunciationOnline';

export const pronunciationOnlineGoldens: Record<string, z.ZodType> = {
  'pronunciation-online-key-absent.json': pronunciationOnlineKeyStatusSchema,
  'pronunciation-online-key-present.json': pronunciationOnlineKeyStatusSchema,
  'pronunciation-online-lookup-found.json': pronunciationOnlineResultSchema,
  'pronunciation-online-lookup-cached.json': pronunciationOnlineResultSchema,
  'pronunciation-online-lookup-not-found.json': pronunciationOnlineResultSchema,
  'pronunciation-online-batch.json': pronunciationOnlineBatchResultSchema,
};
