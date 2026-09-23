import { z } from 'zod';
import type { DawCatalogEntry } from '../contracts/dawCatalog';
import { listFromNull } from './base';

const dawCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  publisher: z.string(),
  licenseNote: z.string(),
  installed: z.boolean(),
  path: z.string().optional(),
  source: z.string().optional(),
}) satisfies z.ZodType<DawCatalogEntry>;
export const dawCatalogListSchema = listFromNull(dawCatalogEntrySchema);
