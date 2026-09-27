import { z } from 'zod';
import type { DawCapabilities, DawCapabilityLevel, DawCapabilityReason, DawCapabilitySupport, DawKind, DawTransport } from '../contracts/daw';
import { optionalFromNull } from './base';

const DAW_KINDS = ['REAPER', 'Audacity', 'none'] as const satisfies readonly DawKind[];
const DAW_CAPABILITY_LEVELS = ['unsupported', 'not_yet_available', 'experimental', 'supported'] as const satisfies readonly DawCapabilityLevel[];
const DAW_CAPABILITY_REASONS = [
  'standalone',
  'not_running',
  'experimental_off',
  'failed',
  'turned_off',
  'not_yet',
  'unsupported',
] as const satisfies readonly DawCapabilityReason[];

export const dawCapabilitySupportSchema = z.object({
  level: z.enum(DAW_CAPABILITY_LEVELS),
  available: z.boolean(),
  reason: optionalFromNull(z.enum(DAW_CAPABILITY_REASONS)),
  message: optionalFromNull(z.string()),
}) satisfies z.ZodType<DawCapabilitySupport>;

export const dawCapabilitiesSchema = z.object({
  daw: z.enum(DAW_KINDS),
  reachable: z.boolean(),
  capabilities: z.record(z.string(), dawCapabilitySupportSchema),
}) satisfies z.ZodType<DawCapabilities>;

/** daw_transport_changed (DAW port PRD Phase 9): position is absent while stopped. */
export const dawTransportSchema = z.object({
  playing: z.boolean(),
  recording: z.boolean(),
  position: optionalFromNull(z.number()),
}) satisfies z.ZodType<DawTransport>;
