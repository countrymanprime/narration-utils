import { z } from 'zod';
import type { DictionaryLookupResult } from '../contracts/dictionary';
import { assetInstallStateSchema } from './assets';

const dictionaryInfoSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  description: z.string(),
  version: z.string(),
  publisher: z.string(),
  license: z.string(),
  licenseUrl: z.string(),
  modelCardUrl: z.string(),
  provenanceUrl: z.string(),
  attribution: z.string(),
});

const dictionarySenseSchema = z.object({
  definition: z.string(),
  examples: z.array(z.string()),
  synonyms: z.array(z.string()),
  antonyms: z.array(z.string()),
});

const dictionaryEntrySchema = z.object({ headword: z.string(), partOfSpeech: z.string(), senses: z.array(dictionarySenseSchema) });

/** What SystemLookup answers: the entries the installed dictionary has for the word, or the first-use gate for the dictionary. */
export const dictionaryLookupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), query: z.string(), entries: z.array(dictionaryEntrySchema), dictionary: dictionaryInfoSchema }),
  z.object({
    status: z.literal('asset_required'),
    dictionary: dictionaryInfoSchema,
    installState: assetInstallStateSchema,
    downloadSize: z.number(),
    diskSize: z.number(),
    installPath: z.string(),
  }),
]) satisfies z.ZodType<DictionaryLookupResult>;
