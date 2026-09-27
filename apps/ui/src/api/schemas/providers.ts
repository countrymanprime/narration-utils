import { z } from 'zod';
import type { ProviderAsset, ProviderCapabilities, ProviderEntry } from '../contracts/providers';
import { listFromNull, optionalFromNull } from './base';
import { dawCapabilitySupportSchema } from './daw';

const providerAssetSchema = z.object({
  kind: z.string(),
  installed: optionalFromNull(z.number().int().nonnegative()),
}) satisfies z.ZodType<ProviderAsset>;

const providerEntrySchema = z.object({
  label: z.string(),
  default: z.boolean(),
  platforms: listFromNull(z.string()),
  modes: listFromNull(z.string()),
  asset: optionalFromNull(providerAssetSchema),
  // The DAW port's Support schema (provider-ports PRD Phase 14): one way to say "not supported, and why" for every port.
  support: dawCapabilitySupportSchema,
}) satisfies z.ZodType<ProviderEntry>;

const providerRowsSchema = z.record(z.string(), providerEntrySchema);

export const providerCapabilitiesSchema = z.object({
  platform: z.string(),
  asr: providerRowsSchema,
  tts: providerRowsSchema,
  pronunciation: providerRowsSchema,
  capture: providerRowsSchema,
}) satisfies z.ZodType<ProviderCapabilities>;
