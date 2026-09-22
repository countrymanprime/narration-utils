import { z } from 'zod';
import type { PickupsImportReport, PickupsImportResult, PickupsMoment, PickupsStartResult, PickupsState } from '../contracts/pickups';
import { optionalFromNull } from './base';

const pickupsMomentSchema = z.object({
  position: z.number(),
  tag: z.string(),
  note: z.string(),
}) satisfies z.ZodType<PickupsMoment>;

const pickupsImportReportSchema = z.object({
  added: z.number(),
  existing: z.number(),
  invalid: z.number(),
}) satisfies z.ZodType<PickupsImportReport>;

export const pickupsStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'importing', 'exporting', 'jumping', 'resolving', 'counting', 'success', 'error']),
  message: z.string(),
  remaining: z.number(),
  total: z.number(),
  next: optionalFromNull(pickupsMomentSchema),
  resolved: optionalFromNull(pickupsMomentSchema),
  importReport: optionalFromNull(pickupsImportReportSchema),
  csv: z.string(),
}) satisfies z.ZodType<PickupsState>;

export const pickupsStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<PickupsStartResult>;

export const pickupsImportResultSchema = z.object({
  status: z.literal('started'),
  rowErrors: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
}) satisfies z.ZodType<PickupsImportResult>;
