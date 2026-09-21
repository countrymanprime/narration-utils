import { z } from 'zod';

// Helpers shared by the per-domain schema files (ADR 0069). Schemas describe what the host really sends, and the host
// (Go) sends `null` for an unset value where the TypeScript contracts say `?:`. That mismatch is closed here, in one
// place, and not by hand in each consumer.

/** A field the contract declares `?: T` but the host may send as `null`: both become `undefined`. */
export const optionalFromNull = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? undefined);

/** A list the host may send as `null` (a nil Go slice, or an older sidecar record): both become an empty list. */
export const listFromNull = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((value): Array<z.output<T>> => value ?? []);

/** The result of a binding that returns nothing: the host marshals `nil` to `null`. */
export const voidResult = z.null().transform((): void => undefined);
