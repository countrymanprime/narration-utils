import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from './commands.catalog';
import { deserializeGesture, resolveGesture, serializeGesture, type Gesture } from './gestures';

/** The gestures currently bound to each command id. Phase 1 only ever builds the default keymap in code (Solution
 * Detail); the narrator's overrides, stored through the host settings (Phase 5, PRD Q2), are layered on top later. */
export type Keymap = Record<CommandId, Gesture[]>;

/** `navigator`-based, so `defaultKeymap`'s own default stays real without every caller passing a platform flag;
 * `resolveGesture` itself takes a plain boolean and needs no `navigator` at all. */
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

/** Resolves every command's default gestures (`Mod` included) against a platform, so the same catalog reads right on
 * macOS and elsewhere. `catalog` and `isMac` default to the real catalog and the real platform; tests pass both. */
export function defaultKeymap(catalog: readonly CommandDescriptor[] = COMMAND_CATALOG, isMac: boolean = isMacPlatform()): Keymap {
  const keymap: Keymap = {};
  for (const command of catalog) keymap[command.id] = command.defaults.map((def) => resolveGesture(def, isMac));
  return keymap;
}

/** A `Keymap.overrides` document's `bindings` (Phase 5, PRD Q2): only the commands that differ from their default, each
 * as its serialised gestures. The wire shape itself lives in `api/schemas/keymap.ts` (ADR 0069's boundary); this stays
 * a plain `Record` so `src/input/` never depends on `src/api/` (ADR 0062: input is a lower layer than the API client). */
export type KeymapBindings = Record<CommandId, string[]>;

/**
 * The effective keymap once the narrator's overrides (Phase 6's recorder) are layered on the defaults. A binding for
 * a command id the catalog no longer has, or a gesture string this build cannot parse (a hand-edited settings file,
 * or an older app's own bug), is skipped rather than thrown - one bad entry falls back to that command's default
 * instead of failing the whole panel to load.
 */
export function keymapFromBindings(
  bindings: KeymapBindings,
  catalog: readonly CommandDescriptor[] = COMMAND_CATALOG,
  isMac: boolean = isMacPlatform(),
): Keymap {
  const keymap = defaultKeymap(catalog, isMac);
  for (const [id, gestures] of Object.entries(bindings)) {
    if (!(id in keymap)) continue;
    try {
      keymap[id] = gestures.map(deserializeGesture);
    } catch {
      // Malformed for this one command only; it keeps the default set defaultKeymap already gave it above.
    }
  }
  return keymap;
}

/** The inverse of `keymapFromBindings`: what to save after a remap, keeping the document to only what actually
 * differs from the catalog defaults (Q2: "a versioned document of only the gestures that differ from the defaults"). */
export function bindingsFromKeymap(keymap: Keymap, catalog: readonly CommandDescriptor[] = COMMAND_CATALOG, isMac: boolean = isMacPlatform()): KeymapBindings {
  const defaults = defaultKeymap(catalog, isMac);
  const bindings: KeymapBindings = {};
  for (const command of catalog) {
    const current = (keymap[command.id] ?? []).map(serializeGesture);
    const base = (defaults[command.id] ?? []).map(serializeGesture);
    const same = current.length === base.length && [...current].sort().every((value, index) => value === [...base].sort()[index]);
    if (!same) bindings[command.id] = current;
  }
  return bindings;
}
