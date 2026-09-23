import { z } from 'zod';
import type { CreditsProjectValuesResult, CreditsRenderResult, CreditTemplate, CreditValues } from '../contracts/credits';
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
export { creditValuesSchema };

export const creditsProjectValuesResultSchema = z.object({
  values: creditValuesSchema,
  narratorGlobal: z.string(),
  suggestions: z.record(z.string(), z.string()),
}) satisfies z.ZodType<CreditsProjectValuesResult>;
