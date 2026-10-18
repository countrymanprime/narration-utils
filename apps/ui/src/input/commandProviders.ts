import { useEffect } from 'react';
import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from './commands.catalog';

/**
 * A command whose existence depends on live data, such as "Go to chapter 3" (docs/architecture/studio-shell-and-registries.md#command-providers-and-go-to). It shows in the jump
 * menu only and carries no key: `defaults?: never` forbids a gesture, and `providedCommands` rejects one at runtime.
 */
export type ProvidedCommand = {
  id: CommandId;
  /** The jump menu heading. */
  group: string;
  label: string;
  hint?: string;
  /** Why the command cannot run now. The jump menu lists it off with this reason and running it does nothing. */
  disabledReason?: string;
  run: () => void;
  defaults?: never;
};

/** Returns the current commands. Called each time the jump menu opens, never at registration. */
export type CommandProvider = () => ProvidedCommand[];

const providers = new Set<CommandProvider>();

/** Registers a provider and returns the function that removes it. */
export function registerCommandProvider(provider: CommandProvider): () => void {
  // A wrapper keeps two registrations of one function distinct, so each unregister removes only its own.
  const entry: CommandProvider = () => provider();
  providers.add(entry);
  return () => {
    providers.delete(entry);
  };
}

/**
 * Every registered provider's current results, in registration order. Throws for a result that carries `defaults` or whose
 * id equals a static catalogue id, since either would put a command outside the catalogue's keymap rules.
 */
export function providedCommands(catalog: readonly CommandDescriptor[] = COMMAND_CATALOG): ProvidedCommand[] {
  const out: ProvidedCommand[] = [];
  for (const provider of providers) {
    for (const command of provider()) {
      if ('defaults' in command && command.defaults !== undefined) {
        throw new Error(
          `Provided command "${command.id}" has defaults: a provided command carries no key (docs/architecture/studio-shell-and-registries.md#command-providers-and-go-to).`,
        );
      }
      const clash = catalog.find((row) => row.id === command.id);
      if (clash) {
        throw new Error(`Provided command "${command.id}" ("${command.label}") has the id of the catalogue row "${clash.id}" ("${clash.label}").`);
      }
      out.push(command);
    }
  }
  return out;
}

/** Registers `provider` while the component is mounted; a new function replaces the old one. */
export function useCommandProvider(provider: CommandProvider): void {
  useEffect(() => registerCommandProvider(provider), [provider]);
}
