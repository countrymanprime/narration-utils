import { z } from 'zod';
import type { Bootstrap, CopyDiagnosticsResult, HostReady, JobEnded, ProjectAttachState } from '../contracts/system';
import { transcriptStateSchema } from './transcript';

/**
 * Deliberately minimal: `Ready` is checked before anything else so a host from another release is reported as
 * "incompatible version" (App.tsx) and never as "invalid payload". Anything more here would turn that message around.
 */
export const readySchema = z.object({ apiVersion: z.number(), diagnosticId: z.string().default('') }) satisfies z.ZodType<HostReady>;

const importedManuscriptSchema = z.object({
  id: z.string(),
  format: z.string(),
  sourceName: z.string(),
  importedAt: z.string(),
  narratableWordCount: z.number(),
  narratableChapterCount: z.number(),
});

export const bootstrapSchema = z.object({
  apiVersion: z.number(),
  diagnosticId: z.string(),
  version: z.string(),
  projectFolder: z.string(),
  projectName: z.string(),
  daw: z.string(),
  // Defaulted to false so a Bootstrap from a host that predates these fields (W13) still parses instead of failing the whole payload;
  // false reads as "not linked" / "unknown", which is the safe fallback for each.
  dawFileLinked: z.boolean().default(false),
  dawReachable: z.boolean().default(false),
  dawProjectMatches: z.boolean().default(false),
  manuscript: importedManuscriptSchema.nullable(),
  manuscriptCandidate: z.object({ path: z.string(), name: z.string() }).nullish(),
  runtime: z.record(z.string(), z.record(z.string(), z.string())),
  transcript: transcriptStateSchema,
}) satisfies z.ZodType<Bootstrap>;

/** The `system:attached` event: a second REAPER launch attached, or was refused with a reason for the narrator. */
export const projectAttachStateSchema = z.object({ attached: z.boolean(), reason: z.string().optional() }) satisfies z.ZodType<ProjectAttachState>;

/** The `system:notice` event: something the app did for the narrator that they should read, such as keeping a file it could not read. */
export const noticeSchema = z.object({ text: z.string() });

/** The `job:ended` event: a host job ended (ADR 0076). The kind stays a string so a job kind a newer host adds is still delivered. */
export const jobEndedSchema = z.object({
  id: z.string(),
  kind: z.string(),
  outcome: z.enum(['success', 'error', 'cancelled']),
  message: z.string(),
  durationMs: z.number(),
}) satisfies z.ZodType<JobEnded>;

/** SystemCopyDiagnostics's answer (docs/prds/tool-run-logging.prd.md phase 7). */
export const copyDiagnosticsResultSchema = z.object({ path: z.string() }) satisfies z.ZodType<CopyDiagnosticsResult>;
