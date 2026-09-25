import { z } from 'zod';
import type {
  CreditsAnnouncement,
  CreditsProjectValuesResult,
  CreditsRenderResult,
  CreditsSetupField,
  CreditsSetupState,
  CreditsStatuses,
  CreditTemplate,
  CreditValues,
  DetectedCandidate,
  RetailSample,
  RetailSampleAnswer,
} from '../contracts/credits';
import { listFromNull } from './base';

export const creditTemplateSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  body: z.string(),
  builtIn: z.boolean().optional(),
}) satisfies z.ZodType<CreditTemplate>;
export const creditTemplatesSchema = listFromNull(creditTemplateSchema);

export const creditsRenderResultSchema = z.object({
  text: z.string(),
  words: z.number(),
  unresolved: listFromNull(z.string()),
}) satisfies z.ZodType<CreditsRenderResult>;

const creditValuesSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  series: z.string().optional(),
  bookNumber: z.string().optional(),
  copyright: z.string().optional(),
  year: z.string().optional(),
  copyrightHolder: z.string().optional(),
  publisher: z.string().optional(),
  narrator: z.string().optional(),
}) satisfies z.ZodType<CreditValues>;

const detectedCandidateSchema = z.object({
  token: z.string(),
  value: z.string(),
  source: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  lines: z.array(z.string()).optional(),
}) satisfies z.ZodType<DetectedCandidate>;

export const creditsProjectValuesResultSchema = z.object({
  values: creditValuesSchema,
  narratorGlobal: z.string(),
  suggestions: z.record(z.string(), z.string()),
  detected: listFromNull(detectedCandidateSchema),
}) satisfies z.ZodType<CreditsProjectValuesResult>;

export const creditsAnnouncementsSchema = listFromNull(
  z.object({
    chapterId: z.string(),
    chapter: z.string(),
    result: creditsRenderResultSchema,
  }) satisfies z.ZodType<CreditsAnnouncement>,
);

const retailSampleSchema = z.object({
  startParagraphId: z.string(),
  endParagraphId: z.string(),
  startChapterId: z.string(),
  startLine: z.number(),
  endChapterId: z.string(),
  endLine: z.number(),
  words: z.number(),
  seconds: z.number(),
}) satisfies z.ZodType<RetailSample>;

export const retailSampleAnswerSchema = z.object({
  sample: retailSampleSchema.nullable(),
  problem: z.string(),
}) satisfies z.ZodType<RetailSampleAnswer>;

// The same five statuses a manuscript chapter's own status has (apps/ui/src/api/schemas/manuscript.ts's chapterSchema).
const creditsStatusSchema = z.enum(['not_started', 'recording', 'editing', 'proofing', 'finalized']);

export const creditsStatusesSchema = z.record(z.string(), creditsStatusSchema) satisfies z.ZodType<CreditsStatuses>;

const setupFieldSchema = z.object({
  token: z.string(),
  field: creditValuesSchema.keyof(),
  candidate: detectedCandidateSchema.nullable(),
}) satisfies z.ZodType<CreditsSetupField>;

/** `CreditsSetupState`, `CreditsSetupDismiss` and `CreditsSetupSave` (`apps/desktop/creditsetup.go`, ADR 0208). */
export const creditsSetupStateSchema = z
  .object({
    needed: z.boolean(),
    banner: z.boolean(),
    dismissed: z.enum(['', 'session', 'project']),
    dismissedAt: z.string().nullable(),
    documentId: z.string(),
    narratorGlobal: z.string(),
    fields: listFromNull(setupFieldSchema),
    candidates: listFromNull(detectedCandidateSchema),
  })
  .refine((state) => !state.needed || (state.dismissed === '' && state.fields.length > 0), {
    message: 'the dialog is needed only with fields to ask for and no dismissal',
    path: ['needed'],
  }) satisfies z.ZodType<CreditsSetupState>;
