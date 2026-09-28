import { z } from 'zod';
import type {
  PronunciationOnlineBatchResult,
  PronunciationOnlineKeyStatus,
  PronunciationOnlineResult,
  PronunciationOnlineSpelling,
} from '../contracts/pronunciationOnline';
import { listFromNull } from './base';

// The key status carries no key: a payload that ever grows a field holding one fails here (strict), not in a screen.
export const pronunciationOnlineKeyStatusSchema = z
  .object({
    source: z.string(),
    label: z.string(),
    present: z.boolean(),
    protectedAtRest: z.boolean(),
  })
  .strict() satisfies z.ZodType<PronunciationOnlineKeyStatus>;

const spellingSchema = z.object({ headword: z.string(), spelling: z.string() }) satisfies z.ZodType<PronunciationOnlineSpelling>;

export const pronunciationOnlineResultSchema = z.object({
  word: z.string(),
  source: z.string(),
  label: z.string(),
  notation: z.string(),
  found: z.boolean(),
  pronunciations: listFromNull(spellingSchema),
  suggestions: listFromNull(z.string()),
  cached: z.boolean(),
  fetchedAt: z.string(),
}) satisfies z.ZodType<PronunciationOnlineResult>;

const count = z.number().int().nonnegative();

export const pronunciationOnlineBatchResultSchema = z.object({
  words: count,
  fetched: count,
  fromCache: count,
  notFound: count,
  failed: count,
  stopped: z.boolean(),
  stopReason: z.string(),
}) satisfies z.ZodType<PronunciationOnlineBatchResult>;
