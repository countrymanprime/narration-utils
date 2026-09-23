import { z } from 'zod';
import type { Track, TrackItem, TracksDiscovery, TracksProject } from '../contracts/tracks';
import { listFromNull } from './base';

const trackItemSchema = z.object({
  guid: z.string(),
  position: z.number(),
  length: z.number(),
  name: z.string(),
  sourceKind: z.string(),
  sourceFile: z.string(),
  sourceAvailable: z.boolean(),
  supported: z.boolean(),
}) satisfies z.ZodType<TrackItem>;

const trackSchema = z.object({
  guid: z.string(),
  index: z.number(),
  name: z.string(),
  color: z.string(),
  muted: z.boolean(),
  soloed: z.boolean(),
  items: listFromNull(trackItemSchema),
}) satisfies z.ZodType<Track>;

export const tracksProjectSchema = z.object({ path: z.string(), tracks: listFromNull(trackSchema) }) satisfies z.ZodType<TracksProject>;

/** No REAPER project file found is a null list on the wire; `selected` is empty while the choice is still to be made. */
export const tracksDiscoverySchema = z.object({ candidates: listFromNull(z.string()), selected: z.string() }) satisfies z.ZodType<TracksDiscovery>;
