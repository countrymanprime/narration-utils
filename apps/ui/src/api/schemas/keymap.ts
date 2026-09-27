import { z } from 'zod';

/**
 * The narrator's remap changes from the input registry's default keymap (docs/prds/input-commands-and-pedals.prd.md,
 * Open Question Q2), stored as the `Keymap.overrides` setting's JSON text: a versioned document of only the
 * gestures that differ from the defaults, keyed by command id. Read with `parseWireJson`, never a bare
 * `JSON.parse` (ADR 0069) - a malformed document falls back to no overrides rather than failing to load Settings.
 */
export const keymapOverridesSchema = z.object({
  version: z.literal(1),
  bindings: z.record(z.string(), z.array(z.string())),
});

export type KeymapOverrides = z.infer<typeof keymapOverridesSchema>;

/** What a fresh install starts from: no overrides, so every command keeps its catalog default gesture. */
export const EMPTY_KEYMAP_OVERRIDES: KeymapOverrides = { version: 1, bindings: {} };
