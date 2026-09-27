import { z } from 'zod';
import type { DialogueCue } from '../../components/manuscript/dialogueCues';

// Not a wire contract (CLAUDE.md): nothing here crosses a Wails binding or a host-written file yet - Character
// Continuity Review's own dialogue-cue extractor is not exposed through any binding (see dialogueCues.ts).
// This schema exists so a fixture cue and the eventual real sidecar output can both be checked against the
// exact same shape (prep-depth.prd.md Phase 4's own contract-test requirement), the same discipline a real
// wire contract gets, applied one phase early. Zod is imported only under src/api/ (ADR 0069) - see
// .dependency-cruiser.mjs's zod-only-in-api rule.
export const dialogueCueSchema = z.object({
  id: z.string(),
  chapterId: z.string(),
  paragraphId: z.string(),
  quote_start: z.number(),
  quote_end: z.number(),
  quote_text: z.string(),
  speaker_entity_id: z.string().nullable(),
  speaker_source: z.enum(['tag', 'continuation', 'unknown', 'correction']),
  evidence: z.object({ chapterId: z.string(), paragraphId: z.string(), excerpt: z.string(), tag: z.string() }),
  corrected: z.boolean(),
}) satisfies z.ZodType<DialogueCue>;
