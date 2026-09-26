import { useEffect, useRef } from 'react';
import type { CommandId } from './commands.catalog';
import { useCommandRegistry, type CommandHandlerEvent } from './router';

/**
 * Attaches behaviour to a catalog command (Solution Detail, ADR 0361 decision 1): a feature calls this instead of
 * adding its own `keydown` listener. `enabled` mirrors the old per-listener conditions (`playPauseDisabled`, and so
 * on) without the feature ever touching the event itself. Throws for an id its `<CommandRouter>` does not carry - a
 * typo here is a bug, not a shortcut that silently never fires. Checked against the enclosing router's own catalog
 * (not a fixed import), so `main.tsx`'s real `<CommandRouter>` checks against `COMMAND_CATALOG` while a test's
 * `<CommandRouter catalog={...}>` checks against its own fixture.
 */
export function useCommand(id: CommandId, handler: (event: CommandHandlerEvent) => void, enabled = true): void {
  const registry = useCommandRegistry();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const known = registry.catalog.some((command) => command.id === id);
  useEffect(() => {
    if (!enabled || !known) return undefined;
    return registry.register(id, (event) => handlerRef.current(event));
  }, [registry, id, enabled, known]);
  if (!known) throw new Error(`useCommand("${id}"): no such command in commands.catalog.ts.`);
}
