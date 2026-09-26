// The golden payloads for delivery: measurement, profiles and diagnostics: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { deliveryProfileSchema, deliveryProfilesStateSchema } from '../schemas/deliveryProfiles';
import { diagnosticsJobSchema } from '../schemas/diagnostics';
import { deliveryReportExportSchema, measureJobSchema, measurePickResultSchema } from '../schemas/measure';

export const deliveryGoldens: Record<string, z.ZodType> = {
  'measure-pick.json': measurePickResultSchema,
  'measure-pick-cancelled.json': measurePickResultSchema,
  'measure-idle.json': measureJobSchema,
  'measure-running.json': measureJobSchema,
  'measure-success.json': measureJobSchema,
  'measure-mp3.json': measureJobSchema,
  'measure-cancelled.json': measureJobSchema,
  'measure-error.json': measureJobSchema,
  'delivery-report-export.json': deliveryReportExportSchema,
  'delivery-profiles.json': deliveryProfilesStateSchema,
  'delivery-profiles-no-project.json': deliveryProfilesStateSchema,
  'delivery-profile-saved.json': deliveryProfileSchema,
  'diagnostics-idle.json': diagnosticsJobSchema,
  'diagnostics-running.json': diagnosticsJobSchema,
  'diagnostics-success.json': diagnosticsJobSchema,
  'diagnostics-cancelled.json': diagnosticsJobSchema,
  'diagnostics-error.json': diagnosticsJobSchema,
};
