import type { CommandDescriptor, CommandId } from './commands.catalog';
import { serializeGesture } from './gestures';
import { scopesOverlap } from './scopes';
import type { Keymap } from './keymap';

/** Two commands bound to the same gesture in scopes that can be active together (Solution Detail, ADR 0361 decision
 * 6). `commands` is sorted, so the same conflict reads the same way regardless of which command was found first. */
export type Conflict = {
  gesture: string;
  commands: [CommandId, CommandId];
};

/**
 * A pure function over `scopesOverlap`: for every gesture two or more commands are bound to, reports every pair
 * whose scopes overlap. It has no notion of which page is actually mounted - a remap the narrator makes is checked
 * against the whole catalog, not just what happens to be on screen (Phase 6's recorder).
 */
export function findConflicts(catalog: readonly CommandDescriptor[], keymap: Keymap): Conflict[] {
  const scopeOf = new Map(catalog.map((command) => [command.id, command.scope] as const));
  const commandsByGesture = new Map<string, CommandId[]>();
  for (const [commandId, gestures] of Object.entries(keymap)) {
    if (!scopeOf.has(commandId)) continue;
    for (const bound of gestures) {
      const key = serializeGesture(bound);
      const existing = commandsByGesture.get(key);
      if (existing) {
        if (!existing.includes(commandId)) existing.push(commandId);
      } else {
        commandsByGesture.set(key, [commandId]);
      }
    }
  }

  const conflicts: Conflict[] = [];
  for (const [gestureKey, commandIds] of commandsByGesture) {
    for (let i = 0; i < commandIds.length; i++) {
      for (let j = i + 1; j < commandIds.length; j++) {
        const a = commandIds[i];
        const b = commandIds[j];
        if (scopesOverlap(scopeOf.get(a)!, scopeOf.get(b)!)) conflicts.push({ gesture: gestureKey, commands: [a, b].sort() as [CommandId, CommandId] });
      }
    }
  }
  return conflicts;
}
