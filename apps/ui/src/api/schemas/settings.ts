import { z } from 'zod';
import type { ScopedSettingField } from '../contracts/system';
import { listFromNull } from './base';

const settingFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['text', 'choice', 'color', 'bool']),
  // A text or colour field has no choices, which the host sends as null.
  choices: listFromNull(z.string()),
  value: z.string(),
  isSet: z.boolean(),
  effectiveValue: z.string(),
  effectiveSource: z.string(),
}) satisfies z.ZodType<ScopedSettingField>;

/** The Settings page's fields of one scope, grouped by tool. Every value is a string; a `bool` is "true" or "false". */
export const settingsForScopeSchema = z.record(z.string(), listFromNull(settingFieldSchema));
