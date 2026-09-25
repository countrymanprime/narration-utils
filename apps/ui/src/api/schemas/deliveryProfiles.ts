import { z } from 'zod';
import type {
  DeliveryAdvice,
  DeliveryProfile,
  DeliveryProfileRef,
  DeliveryProfilesState,
  DeliveryRule,
  DeliveryRuleResult,
  DeliverySource,
} from '../contracts/deliveryProfiles';
import { listFromNull } from './base';

const deliverySourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  requirement: z.string(),
  quoted: z.boolean(),
  readOn: z.string(),
}) satisfies z.ZodType<DeliverySource>;

const deliveryAdviceSchema = z.object({ metric: z.string(), max: z.number(), unit: z.string(), text: z.string() }) satisfies z.ZodType<DeliveryAdvice>;

const deliveryRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  scope: z.enum(['file', 'book']),
  metric: z.string(),
  unit: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  oneOf: listFromNull(z.number()),
  boundText: z.string().optional(),
  sameAcrossFiles: z.boolean(),
  advice: deliveryAdviceSchema.nullable(),
  level: z.enum(['required', 'advice']),
  checkedBy: z.enum(['measured', 'not_yet', 'listen']),
  notCheckedWhy: z.string().optional(),
  source: deliverySourceSchema,
  verification: z.enum(['verified', 'to_verify', 'conflicting']),
  verificationNote: z.string().optional(),
  off: z.boolean().optional(),
}) satisfies z.ZodType<DeliveryRule>;

export const deliveryProfileSchema = z.object({
  id: z.string(),
  version: z.string(),
  revision: z.number(),
  name: z.string(),
  platform: z.string(),
  builtIn: z.boolean(),
  basedOn: z.string().optional(),
  note: z.string().optional(),
  source: deliverySourceSchema,
  rules: listFromNull(deliveryRuleSchema),
}) satisfies z.ZodType<DeliveryProfile>;

const deliveryProfileRefSchema = z.object({ id: z.string(), version: z.string().optional() }) satisfies z.ZodType<DeliveryProfileRef>;

export const deliveryRuleResultSchema = z.object({
  ruleId: z.string(),
  status: z.enum(['met', 'not_met', 'not_measurable', 'not_checked', 'off']),
  value: z.number().nullable(),
  violation: z.enum(['above_max', 'below_min', 'not_one_of', 'differs_across_files', 'not_cbr']).optional(),
  why: z.string().optional(),
  advice: z.string().optional(),
}) satisfies z.ZodType<DeliveryRuleResult>;

export const deliveryProfilesStateSchema = z.object({
  profiles: listFromNull(deliveryProfileSchema),
  globalDefault: deliveryProfileRefSchema,
  hasProject: z.boolean(),
  projectChoice: deliveryProfileRefSchema.nullable(),
  projectProfile: z.string(),
  notice: z.string().optional(),
}) satisfies z.ZodType<DeliveryProfilesState>;
