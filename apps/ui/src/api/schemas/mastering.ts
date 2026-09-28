import { z } from 'zod';
import type { MasteringProvider, MasteringProviders } from '../contracts/mastering';
import { listFromNull, optionalFromNull } from './base';
import { dawCapabilitySupportSchema } from './daw';

const masteringProviderSchema = z.object({
  name: z.string(),
  label: z.string(),
  default: z.boolean(),
  modes: listFromNull(z.string()),
  needsApproval: z.boolean(),
  needs: listFromNull(z.string()),
  support: dawCapabilitySupportSchema,
}) satisfies z.ZodType<MasteringProvider>;

export const masteringProvidersSchema = z.object({
  hasProject: z.boolean(),
  choice: z.string().nullable(),
  effective: z.string(),
  providers: z.array(masteringProviderSchema),
  notice: optionalFromNull(z.string()),
}) satisfies z.ZodType<MasteringProviders>;
