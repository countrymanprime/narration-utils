// The golden payloads for the handshake, bootstrap, notices, job ends and the system bindings: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { dictionaryLookupResultSchema } from '../schemas/dictionary';
import { bootstrapSchema, copyDiagnosticsResultSchema, jobEndedSchema, noticeSchema } from '../schemas/system';

export const systemGoldens: Record<string, z.ZodType> = {
  'bootstrap-manuscript.json': bootstrapSchema,
  'bootstrap-candidate.json': bootstrapSchema,
  'bootstrap-standalone.json': bootstrapSchema,
  'system-lookup-found.json': dictionaryLookupResultSchema,
  'system-lookup-asset-required.json': dictionaryLookupResultSchema,
  'system-copy-diagnostics.json': copyDiagnosticsResultSchema,
  'system-notice.json': noticeSchema,
  'job-ended-success.json': jobEndedSchema,
  'job-ended-error.json': jobEndedSchema,
};
