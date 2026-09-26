import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from './commands.catalog';
import { resolveGesture, type Gesture } from './gestures';

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
