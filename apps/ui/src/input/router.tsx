import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { COMMAND_CATALOG, type CommandDescriptor, type CommandId } from './commands.catalog';
import { serializeGesture, type Gesture } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';
import { createKeyboardSource } from './KeyboardSource';
import { defaultKeymap, type Keymap } from './keymap';
import { SCOPE_PRIORITY, type Scope } from './scopes';
import { isGuardedTarget } from './targets';

export type CommandHandlerEvent = { target: EventTarget | null };
type CommandHandler = (event: CommandHandlerEvent) => void;

type Registry = { register(id: CommandId, handler: CommandHandler): () => void; catalog: readonly CommandDescriptor[] };
const RegistryContext = createContext<Registry | undefined>(undefined);

/** `useCommand.ts`'s access to the router it is mounted under. Not for features: they call `useCommand`. */
export function useCommandRegistry(): Registry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error('useCommand() called outside a <CommandRouter>.');
  return registry;
}

type PushScope = (kind: Scope) => () => void;
const ScopeStackContext = createContext<PushScope | undefined>(undefined);

/**
 * Which scopes are active for the current stack of mounted `CommandScope` boundaries (Solution Detail, "Router";
 * ADR 0361 decision 4). `dialog`, `booth` and `page` are the three ways a screen can claim the surface, and a screen
 * claims at most one of them: `booth` can sit on a dialog (the read-aloud dialog, both) or stand alone as a full
 * page (the Teleprompter page), and either way it takes the surface from `page` the same way `dialog` does
 * (`scopes.ts` explains why `page` and `booth` must stay mutually exclusive here for the default catalog to have
 * zero conflicts). `global` is active except behind a dialog, matching `App.tsx`'s modal-open rule today.
 */
export function activeScopes(stack: readonly Scope[]): ReadonlySet<Scope> {
  const dialogOpen = stack.includes('dialog');
  const boothOpen = stack.includes('booth');
  const pageOpen = stack.includes('page') && !dialogOpen && !boothOpen;
  const active = new Set<Scope>();
  if (dialogOpen) active.add('dialog');
  if (boothOpen) active.add('booth');
  if (pageOpen) active.add('page');
  if (!dialogOpen) active.add('global');
  return active;
}

/**
 * Marks a mounted boundary as one of the router's scopes: the read-aloud dialog and the Teleprompter page wrap
 * their content in `<CommandScope kind="booth">` (Phase 4), a dialog's own content in `kind="dialog"` (Phase 7), and
 * so on. Phase 1 builds the mechanism only; no feature uses it yet (Phases 2 to 4 migrate the three existing
 * listeners onto it).
 */
export function CommandScope({ kind, children }: { kind: Scope; children: ReactNode }) {
  const push = useContext(ScopeStackContext);
  useEffect(() => (push ? push(kind) : undefined), [push, kind]);
  if (!push) throw new Error('<CommandScope> used outside a <CommandRouter>.');
  return <>{children}</>;
}

function commandForGesture(catalog: readonly CommandDescriptor[], keymap: Keymap, scope: Scope, gesture: Gesture): CommandDescriptor | undefined {
  const wanted = serializeGesture(gesture);
  return catalog.find((command) => command.scope === scope && (keymap[command.id] ?? []).some((bound) => serializeGesture(bound) === wanted));
}

export type CommandRouterProps = {
  children: ReactNode;
  /** Defaults to `KeyboardSource` on `document`; a test passes a fake `InputSource` instead. */
  source?: InputSource;
  /** Defaults to the built-in catalog; a test passes a smaller one. */
  catalog?: readonly CommandDescriptor[];
  /** Defaults to the platform default keymap; a test passes a fixed one so it does not depend on `navigator`. */
  keymap?: Keymap;
  /** Phase 10's seam: while this returns true, a `noisy` command's handler does not run (PRD Q5). Defaults to never recording. */
  isRecording?: () => boolean;
};

/**
 * Mounted once at the root (`main.tsx`), replacing the three hand-written `keydown` listeners this PRD removes.
 * Per gesture (Solution Detail, "Router"):
 * 1. Resolves the active scopes from the mounted `CommandScope` boundaries (`activeScopes` above).
 * 2. For a gesture with no modifier held, applies the target guard (`targets.ts`) - a field or widget that owns the
 *    key keeps it, whatever scope is active.
 * 3. Looks up the keymap in scope-priority order (`SCOPE_PRIORITY`) and takes the first command bound to the
 *    gesture in an active scope.
 * 4. If a `noisy` command is found while `isRecording()` is true, the gesture is still consumed (so nothing else
 *    reacts to it) but the handler does not run.
 * 5. A gesture no command takes, and a command whose catalog row has nothing registered yet, are left untouched.
 */
export function CommandRouter({ children, source, catalog = COMMAND_CATALOG, keymap, isRecording = () => false }: CommandRouterProps) {
  const resolvedKeymap = useMemo(() => keymap ?? defaultKeymap(catalog), [keymap, catalog]);
  const catalogRef = useRef(catalog);
  const keymapRef = useRef(resolvedKeymap);
  const isRecordingRef = useRef(isRecording);
  catalogRef.current = catalog;
  keymapRef.current = resolvedKeymap;
  isRecordingRef.current = isRecording;

  const handlers = useRef(new Map<CommandId, CommandHandler>());
  const scopeStack = useRef<Scope[]>([]);

  const register = useCallback<Registry['register']>((id, handler) => {
    handlers.current.set(id, handler);
    return () => {
      if (handlers.current.get(id) === handler) handlers.current.delete(id);
    };
  }, []);

  const push = useCallback<PushScope>((kind) => {
    scopeStack.current = [...scopeStack.current, kind];
    return () => {
      const index = scopeStack.current.indexOf(kind);
      if (index !== -1) scopeStack.current = [...scopeStack.current.slice(0, index), ...scopeStack.current.slice(index + 1)];
    };
  }, []);

  useEffect(() => {
    const activeSource = source ?? createKeyboardSource();
    return activeSource.subscribe((event: GestureEvent) => {
      if (event.gesture.modifiers.length === 0 && isGuardedTarget(event.target)) return;

      const active = activeScopes(scopeStack.current);
      for (const scope of SCOPE_PRIORITY) {
        if (!active.has(scope)) continue;
        const command = commandForGesture(catalogRef.current, keymapRef.current, scope, event.gesture);
        if (!command) continue;
        const handler = handlers.current.get(command.id);
        if (!handler) return; // catalogued, but nothing registered yet (not migrated this phase, or its page isn't mounted): leave it alone
        event.preventDefault();
        if (!(command.noisy && isRecordingRef.current())) handler({ target: event.target });
        return;
      }
    });
  }, [source]);

  const registry = useMemo<Registry>(() => ({ register, catalog }), [register, catalog]);
  return (
    <ScopeStackContext.Provider value={push}>
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    </ScopeStackContext.Provider>
  );
}
